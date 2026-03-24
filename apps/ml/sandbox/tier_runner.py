#!/usr/bin/env python3
"""
Tier runner — long-lived process inside test / prod-cpu / prod-gpu sandbox containers.

Reads from env:
  SANDBOX_TIER_QUEUE      Redis list to blpop jobs from  (required)
  SANDBOX_TIER            tier name: test | prod_cpu | prod_gpu  (required)
  SANDBOX_REDIS_URL       Redis URL visible inside the container  (required)
  SANDBOX_DATA_MODE       fixture | real  (default: fixture)
  SANDBOX_TIER_TIMEOUT    hard kill timeout in seconds  (default: 60)
  SANDBOX_TIER_MAX_CONCURRENT  max parallel jobs  (default: 5)
  TRAINER_SANDBOX_WORKSPACE  workspace mount path  (default: /sandbox_workspace)

For prod tiers (SANDBOX_DATA_MODE=real), data.pkl is written by the Celery worker
before pushing the job to the queue.  The tier_runner just executes runner.py.

For the test tier (SANDBOX_DATA_MODE=fixture), tier_runner generates synthetic
fixture data and writes it to the workspace before executing runner.py.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import shutil
from pathlib import Path

TIER_QUEUE: str = os.environ["SANDBOX_TIER_QUEUE"]
TIER: str = os.environ["SANDBOX_TIER"]
REDIS_URL: str = os.environ["SANDBOX_REDIS_URL"]
DATA_MODE: str = os.environ.get("SANDBOX_DATA_MODE", "fixture")
WORKSPACE = Path(os.environ.get("TRAINER_SANDBOX_WORKSPACE", "/sandbox_workspace"))
JOB_TIMEOUT: int = int(os.environ.get("SANDBOX_TIER_TIMEOUT", "60"))
MAX_CONCURRENT: int = int(os.environ.get("SANDBOX_TIER_MAX_CONCURRENT", "5"))

# Safe env vars forwarded into each runner subprocess (no secrets)
_SAFE_ENV_KEYS = {
    "PATH", "HOME", "LANG", "LC_ALL", "TMPDIR",
    "PYTHONPATH", "PYTHONUNBUFFERED",
    "TRAINING_WORKERS", "TRAINING_BATCH_SIZE", "TRAINING_MAX_EPOCHS",
    "MLFLOW_ENABLE_SYSTEM_METRICS_LOGGING",
    # Trainer ServiceClient uses this to reach the ML service API
    "ML_SERVICE_URL",
}

# Read-only data credentials forwarded ONLY in prod mode
_PROD_CREDENTIAL_KEYS = {
    "MONGO_READONLY_URL",
    "MLFLOW_TRACKING_URI",
    "MLFLOW_S3_ENDPOINT_URL",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "S3_ENDPOINT_URL",
    "S3_BUCKET",
    "S3_REGION",
}

_semaphore: asyncio.Semaphore

# Writable package target inside the container (/tmp is always writable)
_PIP_TARGET = Path("/tmp/pip_user_pkgs")

# Constraints file pinning pre-installed system packages so user pip installs
# cannot upgrade (e.g.) numpy 1.x → 2.x and break scikit-learn C extensions.
_PIP_CONSTRAINTS = Path("/tmp/sandbox_pip_constraints.txt")

# Packages whose system-installed versions must never be overridden.
_PINNED_SYSTEM_PKGS = [
    "numpy", "scipy", "pandas", "scikit-learn",
    "torch", "torchvision", "torchaudio",
    "Pillow", "opencv-python", "opencv-python-headless",
    "matplotlib", "cloudpickle", "joblib",
]


def _write_pip_constraints() -> None:
    """
    Write a pip constraints file pinning critical system packages at their
    installed versions.  Called once at startup; no-op if file already exists.
    """
    if _PIP_CONSTRAINTS.exists():
        return
    import importlib.metadata
    lines: list[str] = []
    for pkg in _PINNED_SYSTEM_PKGS:
        try:
            dist = importlib.metadata.distribution(pkg)
            lines.append(f"{dist.metadata['Name']}=={dist.version}")
        except importlib.metadata.PackageNotFoundError:
            pass
    _PIP_CONSTRAINTS.write_text("\n".join(lines) + "\n")


# S3 configuration (read from env; same keys as the ML service)
_S3_ENDPOINT    = os.environ.get("S3_ENDPOINT_URL", "")
_S3_PUB_ENDPOINT = os.environ.get("S3_PUBLIC_ENDPOINT_URL", "")
_S3_ACCESS_KEY  = os.environ.get("AWS_ACCESS_KEY_ID", "")
_S3_SECRET_KEY  = os.environ.get("AWS_SECRET_ACCESS_KEY", "")
_S3_BUCKET      = os.environ.get("S3_BUCKET", "pms-ml")
_S3_REGION      = os.environ.get("S3_REGION", "us-east-1")
# Track what's already been installed this session to avoid redundant pip calls
_installed_pkgs: set[str] = set()


def _parse_requirements(source: str) -> list[str]:
    """
    Extract packages from either:
      A) Trainer comment header:  # Requirements: scikit-learn, xgboost>=1.5
      B) Class attribute:         requirements = ["scikit-learn", "xgboost>=1.5"]
    Returns deduplicated list; empty list when nothing found.
    """
    import re
    import ast

    pkgs: list[str] = []

    # A) comment header (stops at first non-comment line)
    for line in source.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if not stripped.startswith("#"):
            break
        m = re.match(r"#\s*[Rr]equirements?\s*:\s*(.+)", stripped)
        if m:
            pkgs = [p.strip() for p in m.group(1).split(",") if p.strip()]
            break

    # B) class-level `requirements = [...]` attribute (parsed via AST, no imports)
    if not pkgs:
        try:
            tree = ast.parse(source)
            for node in ast.walk(tree):
                if isinstance(node, ast.ClassDef):
                    for item in node.body:
                        if (
                            isinstance(item, ast.Assign)
                            and any(
                                isinstance(t, ast.Name) and t.id == "requirements"
                                for t in item.targets
                            )
                            and isinstance(item.value, ast.List)
                        ):
                            pkgs = [
                                elt.value
                                for elt in item.value.elts
                                if isinstance(elt, ast.Constant)
                                and isinstance(elt.value, str)
                            ]
                            break
                if pkgs:
                    break
        except Exception:
            pass

    # deduplicate while preserving order
    seen: set[str] = set()
    result: list[str] = []
    for p in pkgs:
        if p not in seen:
            seen.add(p)
            result.append(p)
    return result


async def _install_requirements(packages: list[str], r, job_id: str) -> None:
    """
    pip install packages into _PIP_TARGET using the same Python interpreter.
    Skips packages already installed this container session.
    Publishes progress log lines to Redis so the user sees them in the console.
    """
    new_pkgs = [p for p in packages if p not in _installed_pkgs]
    if not new_pkgs:
        return

    _PIP_TARGET.mkdir(parents=True, exist_ok=True)

    await _pub(r, job_id, {
        "event": "log", "job_id": job_id,
        "line": f"[sandbox] Installing requirements: {', '.join(new_pkgs)}",
    })

    cmd = [
        sys.executable, "-m", "pip", "install",
        "--target", str(_PIP_TARGET),
        "--no-cache-dir", "--quiet",
        "--disable-pip-version-check",
        *(["--constraint", str(_PIP_CONSTRAINTS)] if _PIP_CONSTRAINTS.exists() else []),
        *new_pkgs,
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    stdout_bytes, _ = await proc.communicate()

    if proc.returncode == 0:
        _installed_pkgs.update(packages)
        await _pub(r, job_id, {
            "event": "log", "job_id": job_id,
            "line": f"[sandbox] Requirements installed: {', '.join(new_pkgs)}",
        })
    else:
        err = stdout_bytes.decode("utf-8", errors="replace").strip()
        await _pub(r, job_id, {
            "event": "log", "job_id": job_id,
            "line": f"[sandbox] WARNING: pip install failed — {err[:300]}",
        })


async def _main() -> None:
    global _semaphore
    _semaphore = asyncio.Semaphore(MAX_CONCURRENT)

    _write_pip_constraints()

    import redis.asyncio as aioredis
    r = await aioredis.from_url(REDIS_URL, encoding="utf-8", decode_responses=True)

    print(f"[tier_runner:{TIER}] ready — queue={TIER_QUEUE} data_mode={DATA_MODE} "
          f"timeout={JOB_TIMEOUT}s concurrency={MAX_CONCURRENT}", flush=True)

    while True:
        try:
            item = await r.blpop(TIER_QUEUE, timeout=5)
        except Exception as exc:
            print(f"[tier_runner:{TIER}] redis error: {exc}", flush=True)
            await asyncio.sleep(2)
            continue

        if item is None:
            continue  # blpop timeout — loop

        _, raw = item
        try:
            job = json.loads(raw)
        except json.JSONDecodeError:
            print(f"[tier_runner:{TIER}] bad job payload: {raw!r}", flush=True)
            continue

        asyncio.create_task(_handle_job(r, job))


async def _handle_job(r, job: dict) -> None:
    job_id: str = job["job_id"]
    org_id: str = job.get("org_id", "")
    trainer_source: str = job.get("trainer_source", "")
    config_overrides: dict = job.get("config_overrides") or {}

    async with _semaphore:
        base = WORKSPACE / job_id
        input_dir = base / "input"
        output_dir = base / "output"
        input_dir.mkdir(parents=True, exist_ok=True)
        output_dir.mkdir(parents=True, exist_ok=True)

        # Write trainer source
        (base / "trainer.py").write_text(trainer_source, encoding="utf-8")

        # Write config
        cfg = {
            "batch_size": 32,
            "epochs": 3 if DATA_MODE == "fixture" else 100,
            "data_mode": DATA_MODE,
        }
        cfg.update(config_overrides)

        # Inject test API credentials into config (test mode only).
        # Trainers access these as config.api_key — never via os.environ.
        # Prod credentials are NOT forwarded regardless of DATA_MODE.
        if DATA_MODE == "fixture":
            _test_key = os.environ.get("SANDBOX_TEST_API_KEY", "")
            if _test_key:
                cfg["api_key"] = _test_key
            _test_base = os.environ.get("SANDBOX_TEST_API_BASE_URL", "")
            if _test_base:
                cfg["api_base_url"] = _test_base
            _test_model = os.environ.get("SANDBOX_TEST_API_MODEL", "")
            if _test_model:
                cfg["api_model"] = _test_model

        (input_dir / "config.json").write_text(json.dumps(cfg), encoding="utf-8")

        # Fixture mode: generate synthetic data.pkl so runner.py has something to load
        if DATA_MODE == "fixture":
            _write_fixture_data(input_dir)

        # Parse and install any extra packages declared in the trainer header
        requirements = _parse_requirements(trainer_source)
        if requirements:
            await _install_requirements(requirements, r, job_id)

        # Build safe subprocess environment
        safe_env = {k: os.environ[k] for k in _SAFE_ENV_KEYS if k in os.environ}

        # Prepend the pip target dir to PYTHONPATH so installed packages are importable
        base_pythonpath = safe_env.get("PYTHONPATH", "")
        pip_path = str(_PIP_TARGET)
        safe_env["PYTHONPATH"] = f"{pip_path}:{base_pythonpath}" if base_pythonpath else pip_path

        safe_env.update({
            "SANDBOX_JOB_ID": job_id,
            "SANDBOX_MODE": "train",
            "SANDBOX_DATA_MODE": DATA_MODE,
            "HOME": "/tmp",
            "TMPDIR": "/tmp",
            "PYTHONUNBUFFERED": "1",
        })

        # Forward read-only credentials only for prod tiers
        if DATA_MODE == "real":
            for k in _PROD_CREDENTIAL_KEYS:
                if k in os.environ:
                    safe_env[k] = os.environ[k]

        # Spawn runner.py subprocess
        # limit=20MB: artifact lines (base64 PNG) can easily exceed the 64 KB default.
        _STDOUT_LIMIT = 20 * 1024 * 1024
        runner_path = Path(__file__).parent / "runner.py"
        try:
            proc = await asyncio.create_subprocess_exec(
                sys.executable, str(runner_path),
                env=safe_env,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                limit=_STDOUT_LIMIT,
            )
        except Exception as exc:
            await _pub_error(r, job_id, f"Failed to spawn runner: {exc}")
            _cleanup(base)
            return

        # Stream stdout lines to Redis pub/sub
        timed_out = False
        try:
            async with asyncio.timeout(JOB_TIMEOUT):
                async for line in _iter_lines(proc):
                    try:
                        data = json.loads(line)
                        raw_event = data.get("event")

                        # artifact_file: runner wrote PNG to workspace → upload to S3
                        if raw_event == "artifact_file":
                            local_path = Path(data.get("path", ""))
                            art_name   = data.get("name", "plot.png")
                            if local_path.exists():
                                url = await _upload_artifact_to_s3(job_id, org_id, art_name, local_path)
                                if url:
                                    await _pub(r, job_id, {
                                        "event": "artifact", "job_id": job_id,
                                        "name": art_name, "mime": "image/png", "url": url,
                                    })
                                else:
                                    # S3 unavailable — fall back to base64 inline
                                    import base64 as _b64
                                    await _pub(r, job_id, {
                                        "event": "artifact", "job_id": job_id,
                                        "name": art_name, "mime": "image/png",
                                        "data_b64": _b64.b64encode(local_path.read_bytes()).decode("ascii"),
                                    })
                            continue

                        # Determine event type from payload
                        if raw_event in ("artifact", "log", "metric", "error"):
                            event = raw_event
                        elif "metric" in data:
                            event = "metric"
                        else:
                            event = "log"
                    except (json.JSONDecodeError, TypeError):
                        data = {"line": line}
                        event = "log"
                    await _pub(r, job_id, {"event": event, "job_id": job_id, **data})
        except asyncio.TimeoutError:
            timed_out = True
            try:
                proc.kill()
            except ProcessLookupError:
                pass

        await proc.wait()

        if timed_out:
            await _pub_error(r, job_id, f"Job timed out after {JOB_TIMEOUT}s")
            _cleanup(base)
            return

        # Read result.json written by runner.py
        result_path = output_dir / "result.json"
        if result_path.exists():
            try:
                result = json.loads(result_path.read_text())
            except Exception:
                result = {"status": "error", "error": "Malformed result.json"}
        else:
            result = {"status": "error", "error": "runner.py produced no result.json"}

        # Collect plot artifact paths from output/plots/ (prod tier only).
        # training_service reads these paths from the shared workspace volume
        # and logs them to MLflow as artifacts.
        if DATA_MODE == "real" and result.get("status") == "ok":
            plots_dir = output_dir / "plots"
            if plots_dir.exists():
                result["artifact_paths"] = sorted(
                    str(p) for p in plots_dir.iterdir()
                    if p.suffix.lower() in (".png", ".jpg", ".jpeg", ".svg", ".html")
                )

        # For test tier: store model bytes temporarily in Redis (1 hr TTL, per-org latest)
        if DATA_MODE == "fixture":
            model_path = output_dir / "model.pkl"
            if model_path.exists():
                try:
                    # Store raw bytes under a binary-safe key
                    import redis.asyncio as aioredis
                    rb = await aioredis.from_url(REDIS_URL, decode_responses=False)
                    await rb.setex(
                        f"sandbox:test:model:{org_id}:latest",
                        3600,
                        model_path.read_bytes(),
                    )
                    await rb.aclose()
                except Exception:
                    pass  # model storage failure is non-fatal for test runs

        # Publish result and done event
        ttl = 3600 if DATA_MODE == "fixture" else 86400
        await r.setex(f"sandbox:result:{job_id}", ttl, json.dumps(result))
        await _pub(r, job_id, {
            "event": "done",
            "job_id": job_id,
            "status": result.get("status", "error"),
            "metrics": result.get("metrics", {}),
            "exit_code": proc.returncode,
            "data_mode": DATA_MODE,
            "tier": TIER,
        })

        # In prod (real) mode the workspace must stay on disk until training_service
        # has read model.pkl from the shared volume.  training_service cleans up.
        if DATA_MODE != "real":
            _cleanup(base)


async def _iter_lines(proc):
    """Yield decoded stdout lines from a subprocess."""
    while True:
        line = await proc.stdout.readline()
        if not line:
            break
        yield line.decode("utf-8", errors="replace").rstrip()


async def _pub(r, job_id: str, data: dict) -> None:
    try:
        await r.publish(f"sandbox:logs:{job_id}", json.dumps(data))
    except Exception:
        pass


async def _pub_error(r, job_id: str, error: str) -> None:
    await _pub(r, job_id, {"event": "error", "job_id": job_id, "error": error})
    await r.setex(f"sandbox:result:{job_id}", 3600, json.dumps(
        {"status": "error", "error": error}
    ))


def _write_fixture_data(input_dir: Path) -> None:
    """
    Write a synthetic data.pkl in the standardized sandbox row format.

    Emits:
      {
        "rows": [{"features": {"type": "text", "value": "..."}, "label": {"type": "text", "value": "0"}}],
        "meta": {"dataset_slug": "_fixture", "row_count": 200, "fields": [...]},
        # Legacy flat keys kept so trainers that do raw["features"] / raw["labels"] still work
        "features": [[...], ...],
        "labels": [0, ...],
        "_fixture": True,
      }
    """
    try:
        import pickle
        try:
            import numpy as np
            rng = np.random.default_rng(42)
            features = rng.standard_normal((200, 10)).tolist()
            labels = rng.integers(0, 2, 200).tolist()
        except ImportError:
            import random
            random.seed(42)
            features = [[random.gauss(0, 1) for _ in range(10)] for _ in range(200)]
            labels = [random.randint(0, 1) for _ in range(200)]

        rows = [
            {
                "features": {"type": "text", "value": ",".join(f"{x:.6f}" for x in feat)},
                "label":    {"type": "text", "value": str(lbl)},
            }
            for feat, lbl in zip(features, labels)
        ]
        data = {
            "rows": rows,
            "meta": {
                "dataset_slug": "_fixture",
                "row_count": len(rows),
                "fields": [
                    {"name": "features", "type": "text"},
                    {"name": "label",    "type": "text"},
                ],
            },
            # Legacy flat keys — trainers using raw["features"] / raw["labels"] still work
            "features": features,
            "labels":   labels,
            "_fixture": True,
            "_rows":    len(rows),
        }
        with open(input_dir / "data.pkl", "wb") as f:
            pickle.dump(data, f)
    except Exception as exc:
        print(f"[tier_runner] fixture data generation failed: {exc}", flush=True)


async def _upload_artifact_to_s3(job_id: str, org_id: str, name: str, local_path: Path) -> str | None:
    """Upload a plot PNG to S3 and return a presigned URL (1-hour TTL), or None on failure."""
    if not (_S3_ENDPOINT and _S3_ACCESS_KEY and _S3_SECRET_KEY and _S3_BUCKET):
        return None
    try:
        import aioboto3 as _aio  # type: ignore[import]
        s3_key = f"sandbox/artifacts/{org_id}/{job_id}/{name}"
        session = _aio.Session()
        async with session.client(
            "s3",
            endpoint_url=_S3_ENDPOINT,
            aws_access_key_id=_S3_ACCESS_KEY,
            aws_secret_access_key=_S3_SECRET_KEY,
            region_name=_S3_REGION,
        ) as s3:
            data = local_path.read_bytes()
            await s3.put_object(Bucket=_S3_BUCKET, Key=s3_key, Body=data, ContentType="image/png")
            url: str = await s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": _S3_BUCKET, "Key": s3_key},
                ExpiresIn=3600,
            )
        # If a public endpoint is configured, replace the internal host in the URL
        if _S3_PUB_ENDPOINT and _S3_ENDPOINT and _S3_ENDPOINT in url:
            url = url.replace(_S3_ENDPOINT, _S3_PUB_ENDPOINT, 1)
        return url
    except Exception as exc:
        print(f"[tier_runner] S3 artifact upload failed: {exc}", flush=True)
        return None


def _cleanup(base: Path) -> None:
    try:
        shutil.rmtree(base, ignore_errors=True)
    except Exception:
        pass


if __name__ == "__main__":
    asyncio.run(_main())
