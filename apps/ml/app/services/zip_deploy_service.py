"""
Deploy a model from a structured ZIP archive.

The ZIP is extracted to a persistent folder on the shared trainer-plugins volume
so all file references remain valid when the Celery worker runs.

ZIP structure
-------------
my-model.zip
├── manifest.json          ← required: name, version, entry_point, model_file, …
├── inference.py           ← entry point (PythonModel subclass) — path set in manifest
├── model.pt               ← model artifact — path set in manifest
└── artifacts/             ← optional extra artifacts (scalers, configs, vocabs …)
    ├── scaler.pkl
    └── label_map.json

Both layouts are accepted:
  Flat:   manifest.json at ZIP root
  Nested: my-model/manifest.json  (most common when zipping a folder)

manifest.json schema
--------------------
{
    "name":         "meter-ocr",
    "version":      "1.0.0",
    "description":  "YOLO meter reader",
    "tags":         {"domain": "iot"},
    "model_file":   "model.pt",
    "entry_point":  "inference.py",
    "set_as_default": true
}
"""
from __future__ import annotations

import json
import os
import shutil
import zipfile
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import structlog

from app.core.config import settings

logger = structlog.get_logger(__name__)

MANIFEST_FILE = "manifest.json"
ARTIFACTS_DIR = "artifacts"


class ZipManifestError(ValueError):
    pass


# ── ZIP helpers ────────────────────────────────────────────────────────────────

# Folders injected by OS or tools that should never be treated as the model root
_SKIP_DIRS = {"__MACOSX", ".DS_Store", "__pycache__", ".git"}


def _resolve_root(extract_dir: str) -> str:
    """
    Return the directory that contains manifest.json.
    Handles flat ZIPs, single-parent-folder ZIPs, and macOS ZIPs (__MACOSX noise).
    """
    # 1. Flat layout — manifest at extraction root
    if os.path.exists(os.path.join(extract_dir, MANIFEST_FILE)):
        return extract_dir

    # 2. Nested layout — filter out OS noise directories
    entries = [
        e for e in os.listdir(extract_dir)
        if not e.startswith(".")
        and e not in _SKIP_DIRS
        and os.path.isdir(os.path.join(extract_dir, e))
    ]

    # Check each candidate (usually just one)
    for entry in entries:
        candidate = os.path.join(extract_dir, entry)
        if os.path.exists(os.path.join(candidate, MANIFEST_FILE)):
            return candidate

    # 3. Nothing found — list what IS in the ZIP for a useful error message
    all_files = [
        str(p.relative_to(extract_dir))
        for p in Path(extract_dir).rglob("*")
        if p.is_file() and not any(s in p.parts for s in _SKIP_DIRS)
    ]
    raise ZipManifestError(
        f"'{MANIFEST_FILE}' not found in ZIP. "
        "ZIP must contain manifest.json at the root or inside a single top-level folder.\n"
        f"Files found: {all_files[:20]}"
    )


def _read_manifest(root_dir: str) -> Dict[str, Any]:
    with open(os.path.join(root_dir, MANIFEST_FILE)) as f:
        data = json.load(f)
    if "name" not in data:
        raise ZipManifestError("manifest.json must include 'name'")
    if "model_file" not in data:
        raise ZipManifestError("manifest.json must include 'model_file'")
    return data


def _collect_extra_artifacts(root_dir: str) -> Dict[str, str]:
    """Return {key: abs_path} for every file under artifacts/."""
    arts_dir = os.path.join(root_dir, ARTIFACTS_DIR)
    if not os.path.isdir(arts_dir):
        return {}
    result: Dict[str, str] = {}
    for f in sorted(Path(arts_dir).rglob("*")):
        if f.is_file() and not f.name.startswith("."):
            rel = f.relative_to(arts_dir)
            key = str(rel.with_suffix("")).replace(os.sep, "/")
            result[key] = str(f)
    return result


# ── persistent extraction ──────────────────────────────────────────────────────

def _persistent_dest(name: str) -> str:
    """
    Return a stable directory path on the shared trainer-plugins volume.
    Both ml-service and ml-worker mount the same volume so paths are identical.
    Previous extraction for the same model name is replaced.
    """
    dest = os.path.join(settings.TRAINER_PLUGIN_DIR, "zip_models", name)
    if os.path.exists(dest):
        shutil.rmtree(dest)          # replace previous version
    os.makedirs(dest, exist_ok=True)
    return dest


def _extract_to_persistent(zip_bytes: bytes, name: str) -> str:
    """
    Extract ZIP into a persistent directory and return the root dir
    (the folder that contains manifest.json).
    """
    import tempfile

    dest = _persistent_dest(name)

    # Write to a temp file first so we can open with zipfile
    with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tf:
        tf.write(zip_bytes)
        tmp_zip = tf.name

    try:
        with zipfile.ZipFile(tmp_zip, "r") as zf:
            for member in zf.namelist():
                if ".." in member or member.startswith("/"):
                    raise ZipManifestError(f"Unsafe path in ZIP: {member}")
            zf.extractall(dest)
    finally:
        os.unlink(tmp_zip)

    return _resolve_root(dest)


# ── public entry point ─────────────────────────────────────────────────────────

async def deploy_from_zip(zip_bytes: bytes, owner_email: Optional[str] = None, org_id: str = "") -> Tuple[str, str]:
    """
    Extract ZIP to persistent storage, validate manifest, enqueue Celery task.
    Returns (job_id, model_name).
    """
    from app.tasks.train_task import enqueue_pretrained_deploy

    # Quick peek to read name from manifest before full extraction
    import io
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        names = zf.namelist()
        manifest_candidates = [n for n in names if n.endswith("manifest.json")]
        logger.info("zip_peek", total_entries=len(names), manifest_candidates=manifest_candidates, entries_preview=names[:30])
        if not manifest_candidates:
            raise ZipManifestError(
                f"'{MANIFEST_FILE}' not found in ZIP. "
                "ZIP must contain manifest.json at the root or inside a single top-level folder.\n"
                f"ZIP entries found: {names[:30]}"
            )
        with zf.open(manifest_candidates[0]) as mf:
            manifest_preview = json.load(mf)

    if "name" not in manifest_preview:
        raise ZipManifestError("manifest.json must include 'name'")
    if "model_file" not in manifest_preview:
        raise ZipManifestError("manifest.json must include 'model_file'")

    model_name = manifest_preview["name"]

    # Extract to persistent folder (replaces any previous extraction for this name)
    root_dir = _extract_to_persistent(zip_bytes, model_name)
    manifest = _read_manifest(root_dir)   # full validated read from extracted copy

    # Log what was actually extracted for easier debugging
    try:
        extracted_files = [
            str(p.relative_to(root_dir))
            for p in Path(root_dir).rglob("*")
            if p.is_file() and not any(s in p.parts for s in _SKIP_DIRS)
        ]
    except Exception:
        extracted_files = []
    logger.info("zip_extracted", root_dir=root_dir, files=extracted_files[:30])

    model_file_rel = manifest["model_file"]
    model_path = os.path.join(root_dir, model_file_rel)
    if not os.path.exists(model_path):
        raise ZipManifestError(
            f"model_file '{model_file_rel}' listed in manifest not found in ZIP.\n"
            f"Files found under root '{root_dir}': {extracted_files[:20]}"
        )

    entry_point = manifest.get("entry_point")
    if entry_point:
        script_path = os.path.join(root_dir, entry_point)
        if not os.path.exists(script_path):
            raise ZipManifestError(
                f"entry_point '{entry_point}' listed in manifest not found in ZIP"
            )
    else:
        # Auto-detect inference.py when not declared in manifest.
        # A ZIP that ships inference.py without explicitly naming it as entry_point
        # is the most common mistake; treat inference.py as the implicit entry point.
        auto_script = os.path.join(root_dir, "inference.py")
        if os.path.exists(auto_script):
            entry_point = "inference.py"
            logger.info(
                "zip_entry_point_auto_detected",
                name=manifest["name"],
                entry_point=entry_point,
            )

    extra_artifacts = _collect_extra_artifacts(root_dir)

    # Pass file paths (not bytes) — the worker reads from the same persistent volume
    deploy_kwargs: Dict[str, Any] = {
        "name":            manifest["name"],
        "version":         manifest.get("version", "1.0.0"),
        "description":     manifest.get("description", ""),
        "tags":            manifest.get("tags", {}),
        "input_schema":    manifest.get("input_schema", {}),
        "output_schema":   manifest.get("output_schema", {}),
        "category":        manifest.get("category", {}),
        "file_name":       Path(model_file_rel).name,
        "set_as_default":  manifest.get("set_as_default", True),
        "extra_artifacts": extra_artifacts,
        # Paths on the shared volume — valid in both api and worker containers
        "_model_path":     model_path,
        "_script_path":    os.path.join(root_dir, entry_point) if entry_point else None,
        # Include the extraction root so sibling .py files are bundled in code_paths
        "_zip_root":       root_dir,
    }

    logger.info(
        "zip_deploy_enqueued",
        name=manifest["name"],
        version=deploy_kwargs["version"],
        root_dir=root_dir,
        model_file=model_file_rel,
        entry_point=entry_point,
        extra_artifacts=list(extra_artifacts.keys()),
    )

    job_id = await enqueue_pretrained_deploy(deploy_kwargs, owner_email=owner_email, org_id=org_id)
    return job_id, manifest["name"]
