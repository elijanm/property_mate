"""
Code editor API — file browser, read/write, direct-run, stream logs, dataset autofill.

Run mechanism (no Celery):
  POST /editor/run  → starts asyncio background task, returns {job_id}
  GET  /editor/run/{job_id}/stream → SSE, reads from in-memory asyncio.Queue

Security scanner rejects:
  - subprocess, socket imports
  - os.system / os.popen / os.exec* / os.fork calls
  - open() in write mode outside /tmp
  - eval / exec with dynamic content
  - __import__, ctypes, pickle.loads
"""
from __future__ import annotations

import ast
import asyncio
import json
import os
import shutil
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

import aiofiles
import structlog
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from app.core.config import settings
from app.dependencies.auth import get_current_user, require_roles
from app.models.dataset import DatasetProfile

# In-process run queues: job_id → asyncio.Queue of SSE event dicts (None = sentinel)
_RUN_QUEUES: Dict[str, asyncio.Queue] = {}

router = APIRouter(prefix="/editor", tags=["editor"])
logger = structlog.get_logger(__name__)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _plugin_dir() -> Path:
    p = Path(settings.TRAINER_PLUGIN_DIR)
    p.mkdir(parents=True, exist_ok=True)
    return p


def _safe_path(rel: str) -> Path:
    """Resolve a relative path inside the plugin dir; reject traversal."""
    base = _plugin_dir().resolve()
    full = (base / rel).resolve()
    if not str(full).startswith(str(base)):
        raise HTTPException(status_code=400, detail="Path traversal not allowed")
    return full


def _file_node(p: Path, base: Path) -> Dict[str, Any]:
    rel = str(p.relative_to(base))
    if p.is_dir():
        children = sorted(p.iterdir(), key=lambda x: (x.is_file(), x.name.lower()))
        return {
            "type": "dir",
            "name": p.name,
            "path": rel,
            "children": [_file_node(c, base) for c in children],
        }
    return {
        "type": "file",
        "name": p.name,
        "path": rel,
        "size": p.stat().st_size,
        "ext": p.suffix.lstrip("."),
    }


# ── File tree ─────────────────────────────────────────────────────────────────

@router.get("/files")
async def list_files(user=Depends(get_current_user)):
    """Return the full file tree of the trainer plugin directory."""
    base = _plugin_dir()
    children: List[Path] = sorted(base.iterdir(), key=lambda x: (x.is_file(), x.name.lower())) if base.exists() else []
    return {"tree": [_file_node(c, base) for c in children], "root": str(base)}


# ── Read file ─────────────────────────────────────────────────────────────────

@router.get("/files/content")
async def get_file_content(path: str = Query(...), user=Depends(get_current_user)):
    full = _safe_path(path)
    if not full.exists():
        raise HTTPException(status_code=404, detail="File not found")
    if full.is_dir():
        raise HTTPException(status_code=400, detail="Path is a directory")
    async with aiofiles.open(full, "r", errors="replace") as f:
        content = await f.read()
    return {"path": path, "content": content}


# ── Save file ─────────────────────────────────────────────────────────────────

class SaveFileRequest(BaseModel):
    path: str
    content: str


@router.post("/files")
async def save_file(body: SaveFileRequest, user=Depends(require_roles("engineer", "admin"))):
    full = _safe_path(body.path)
    full.parent.mkdir(parents=True, exist_ok=True)
    async with aiofiles.open(full, "w") as f:
        await f.write(body.content)
    try:
        await scan_and_register_plugins(owner_email=user.email)
    except Exception:
        pass
    return {"saved": True, "path": body.path}


# ── Delete file ───────────────────────────────────────────────────────────────

@router.delete("/files")
async def delete_file(path: str = Query(...), user=Depends(require_roles("engineer", "admin"))):
    full = _safe_path(path)
    if not full.exists():
        raise HTTPException(status_code=404, detail="File not found")
    if full.is_dir():
        shutil.rmtree(full)
    else:
        full.unlink()
    return {"deleted": True, "path": path}


# ── New file ──────────────────────────────────────────────────────────────────

class NewFileRequest(BaseModel):
    path: str
    template: str = "blank"   # blank | trainer


def _trainer_template(class_name: str) -> str:
    return f'''"""
{class_name} — custom trainer plugin.

The service auto-discovers and registers this file on save.
"""
from app.abstract.base_trainer import BaseTrainer, TrainingConfig
from app.abstract.data_source import InMemoryDataSource


class {class_name}(BaseTrainer):
    name = "{class_name.lower()}"
    version = "1.0.0"
    description = "A custom trainer — edit me!"
    framework = "sklearn"

    # ── Data source ──────────────────────────────────────────────────────────
    # Replace InMemoryDataSource with your preferred source. Examples:
    #   S3DataSource(bucket="pms-ml", key="data/train.csv")
    #   MongoDBDataSource(database="pms_ml", collection="my_data")
    #   DatasetDataSource(dataset_id="<paste-dataset-id>")
    data_source = InMemoryDataSource()

    def preprocess(self, raw):
        # Transform raw data from data_source.load() into training-ready form
        return raw

    def train(self, preprocessed, config: TrainingConfig):
        # Return the trained model.
        # For tabular DataFrames use the built-in auto-trainer:
        #   return self.auto_train_tabular(preprocessed, "label_col", config)
        raise NotImplementedError("Implement train()")

    def predict(self, model, inputs):
        raise NotImplementedError("Implement predict()")
'''


@router.post("/files/new")
async def new_file(body: NewFileRequest, user=Depends(require_roles("engineer", "admin"))):
    full = _safe_path(body.path)
    if full.exists():
        raise HTTPException(status_code=409, detail="File already exists")
    full.parent.mkdir(parents=True, exist_ok=True)

    stem = Path(body.path).stem
    class_name = "".join(w.title() for w in stem.replace("-", "_").split("_"))
    content = _trainer_template(class_name) if body.template == "trainer" else ""

    async with aiofiles.open(full, "w") as f:
        await f.write(content)
    return {"created": True, "path": body.path, "content": content}


# ── Security scanner ──────────────────────────────────────────────────────────

# Modules that are entirely blocked
_BLOCKED_MODULES = frozenset([
    "subprocess", "socket", "ctypes", "cffi", "multiprocessing",
    "pty", "tty", "termios",
])

# os.* methods that are blocked
_BLOCKED_OS_ATTRS = frozenset([
    "system", "popen", "popen2", "popen3", "popen4",
    "execl", "execle", "execlp", "execv", "execve", "execvp", "execvpe",
    "fork", "forkpty", "spawnl", "spawnle", "spawnlp",
    "spawnv", "spawnve", "spawnvp", "kill", "killpg",
    "unlink", "rmdir", "removedirs", "remove",
])

# Builtins that are blocked when called with dynamic (non-constant) args
_BLOCKED_BUILTINS = frozenset(["eval", "exec", "compile", "__import__"])


def _security_check(code: str) -> Optional[str]:
    """
    Walk the AST and return a violation message, or None if code is clean.
    Rejects known-dangerous patterns but does NOT guarantee full sandboxing.
    """
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return f"SyntaxError line {e.lineno}: {e.msg}"

    for node in ast.walk(tree):
        # Block certain imports
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            names = (
                [a.name for a in node.names]
                if isinstance(node, ast.Import)
                else [node.module or ""]
            )
            for name in names:
                top = (name or "").split(".")[0]
                if top in _BLOCKED_MODULES:
                    return f"Restricted import: '{top}' is not allowed in trainer code"

        # Block os.<dangerous_attr> calls
        if isinstance(node, ast.Call):
            func = node.func
            if (
                isinstance(func, ast.Attribute)
                and isinstance(func.value, ast.Name)
                and func.value.id == "os"
                and func.attr in _BLOCKED_OS_ATTRS
            ):
                return f"Restricted call: os.{func.attr}() is not allowed"

            # Block eval/exec/compile/__import__ with non-constant args
            if isinstance(func, ast.Name) and func.id in _BLOCKED_BUILTINS:
                if node.args and not isinstance(node.args[0], ast.Constant):
                    return f"Restricted call: {func.id}() with dynamic arguments is not allowed"

        # Block open() for write outside /tmp
        if isinstance(node, ast.Call):
            func = node.func
            if isinstance(func, ast.Name) and func.id == "open":
                # Check mode arg (2nd positional or 'mode' keyword)
                mode_val: Optional[str] = None
                if len(node.args) >= 2 and isinstance(node.args[1], ast.Constant):
                    mode_val = node.args[1].value
                for kw in node.keywords:
                    if kw.arg == "mode" and isinstance(kw.value, ast.Constant):
                        mode_val = kw.value.value
                if mode_val and any(c in mode_val for c in ("w", "a", "x", "+")):
                    # Allow writes only if the path starts with /tmp
                    path_val: Optional[str] = None
                    if node.args and isinstance(node.args[0], ast.Constant):
                        path_val = str(node.args[0].value)
                    if path_val and not path_val.startswith("/tmp"):
                        return f"Restricted call: open({path_val!r}, {mode_val!r}) — write access outside /tmp is not allowed"

        # Block pickle.loads (arbitrary code execution)
        if isinstance(node, ast.Call):
            func = node.func
            if (
                isinstance(func, ast.Attribute)
                and func.attr in ("loads", "load")
                and isinstance(func.value, ast.Name)
                and func.value.id == "pickle"
            ):
                return "Restricted call: pickle.loads() is not allowed — use joblib or safetensors instead"

    return None


# ── Validate file ────────────────────────────────────────────────────────────

class ValidateRequest(BaseModel):
    path: str
    content: str


@router.post("/validate")
async def validate_file(body: ValidateRequest, user=Depends(get_current_user)):
    """
    1. Security scan (AST)
    2. Syntax check
    3. Detect trainer names from class name = "..." attributes
    Returns {valid, trainers, error, warnings}
    """
    violation = _security_check(body.content)
    if violation:
        return {"valid": False, "trainers": [], "error": violation, "warnings": []}

    try:
        tree = ast.parse(body.content)
    except SyntaxError as e:
        return {"valid": False, "trainers": [], "error": f"SyntaxError line {e.lineno}: {e.msg}", "warnings": []}

    trainer_names: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            for stmt in node.body:
                if (
                    isinstance(stmt, ast.Assign)
                    and any(isinstance(t, ast.Name) and t.id == "name" for t in stmt.targets)
                ):
                    val = stmt.value
                    if isinstance(val, ast.Constant) and isinstance(val.value, str):
                        trainer_names.append(val.value)

    warnings: list[str] = []
    if not trainer_names:
        warnings.append("No BaseTrainer subclass found — add name = '...' class attribute")

    return {"valid": True, "trainers": trainer_names, "error": None, "warnings": warnings}


# ── Direct run (no Celery) ────────────────────────────────────────────────────

class RunRequest(BaseModel):
    trainer_name: str
    content: str             # current editor content (will be saved + run)
    path: str                # relative file path inside plugin dir
    config_overrides: Optional[dict] = None


_RUNNER_TEMPLATE = """
import sys, asyncio, traceback
sys.path.insert(0, '/app')
import os
os.environ.setdefault('PYTHONUNBUFFERED', '1')

async def _main():
    from app.core.database import init_db
    from app.services.registry_service import scan_and_register_plugins, get_trainer_class
    from app.abstract.base_trainer import TrainingConfig

    await init_db()
    print("[editor] Scanning plugins...", flush=True)
    await scan_and_register_plugins()

    cls = get_trainer_class({trainer_name!r})
    if not cls:
        raise RuntimeError(f"Trainer {trainer_name!r} not found after scan — check name attribute")

    trainer = cls()
    config = TrainingConfig()
{overrides_snippet}
    print(f"[editor] Loading data from {{type(trainer.data_source).__name__}}...", flush=True)
    raw = await trainer.data_source.load()

    print("[editor] Preprocessing...", flush=True)
    preprocessed = trainer.preprocess(raw)

    print(f"[editor] Training {{cls.trainer_name()!r}}...", flush=True)
    result = trainer.train(preprocessed, config)
    print(f"[editor] train() returned {{type(result).__name__}}", flush=True)
    print("[editor] ✓ Run complete", flush=True)

try:
    asyncio.run(_main())
except Exception as _e:
    print(f"[editor] ✗ {{type(_e).__name__}}: {{_e}}", flush=True)
    traceback.print_exc()
    sys.exit(1)
"""


async def _execute_trainer(job_id: str, trainer_name: str, plugin_path: Path, overrides: Optional[dict]) -> None:
    """Run the trainer in a subprocess and push output lines to the in-memory queue."""
    queue = _RUN_QUEUES.get(job_id)
    if not queue:
        return

    async def emit(event: str, data: dict) -> None:
        await queue.put({"event": event, "data": data})

    overrides_snippet = ""
    if overrides:
        for k, v in overrides.items():
            if isinstance(v, (int, float, str, bool)):
                overrides_snippet += f"    config.{k} = {v!r}\n"

    runner_code = _RUNNER_TEMPLATE.format(
        trainer_name=trainer_name,
        overrides_snippet=overrides_snippet or "    pass  # no overrides",
    )

    env = {**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONPATH": "/app"}

    await emit("log", {"line": f"[editor] Executing {plugin_path.name} directly (no queue)..."})

    try:
        proc = await asyncio.create_subprocess_exec(
            sys.executable, "-c", runner_code,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env=env,
            cwd="/app",
        )

        assert proc.stdout is not None
        async for raw_line in proc.stdout:
            line = raw_line.decode("utf-8", errors="replace").rstrip()
            await emit("log", {"line": line})

        rc = await asyncio.wait_for(proc.wait(), timeout=5)
        status = "completed" if rc == 0 else "failed"
        await emit("done", {"status": status, "exit_code": rc, "metrics": {}, "error": None if rc == 0 else f"Process exited with code {rc}"})

    except asyncio.TimeoutError:
        await emit("done", {"status": "failed", "error": "Timeout waiting for process to exit"})
    except Exception as exc:
        await emit("done", {"status": "failed", "error": str(exc)})
    finally:
        await queue.put(None)   # sentinel — generator knows to stop
        # NOTE: do NOT pop here; SSE generator owns the queue lifecycle


@router.post("/run")
async def run_trainer(body: RunRequest, user=Depends(require_roles("engineer", "admin"))):
    """
    1. Security-scan the code
    2. Save the file to the plugin dir
    3. Spawn an asyncio background task that runs the trainer directly (no Celery)
    4. Return {job_id} — client opens SSE stream on /editor/run/{job_id}/stream
    """
    # Security gate
    violation = _security_check(body.content)
    if violation:
        raise HTTPException(status_code=400, detail=f"Security violation: {violation}")

    # Syntax check
    try:
        ast.parse(body.content)
    except SyntaxError as e:
        raise HTTPException(status_code=400, detail=f"SyntaxError line {e.lineno}: {e.msg}")

    # Save file
    full = _safe_path(body.path)
    full.parent.mkdir(parents=True, exist_ok=True)
    async with aiofiles.open(full, "w") as f:
        await f.write(body.content)

    # Register job
    job_id = str(uuid.uuid4())
    queue: asyncio.Queue = asyncio.Queue(maxsize=10_000)
    _RUN_QUEUES[job_id] = queue

    # Fire background task
    asyncio.create_task(_execute_trainer(job_id, body.trainer_name, full, body.config_overrides))

    return {"job_id": job_id, "status": "running"}


# ── Stream run logs (SSE) ─────────────────────────────────────────────────────

@router.get("/run/{job_id}/stream")
async def stream_run_logs(job_id: str, user=Depends(get_current_user)):
    """SSE — drains the in-memory queue produced by the background run task."""

    async def generator():
        # Wait up to 3 s for the queue to appear (handles fast-failing subprocesses
        # where the background task may finish before the SSE client connects)
        queue = None
        for _ in range(30):
            queue = _RUN_QUEUES.get(job_id)
            if queue is not None:
                break
            await asyncio.sleep(0.1)

        if queue is None:
            yield {"event": "error", "data": json.dumps({"msg": "Run not found or already finished"})}
            return

        yield {"event": "connected", "data": json.dumps({"job_id": job_id})}
        try:
            while True:
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=120)
                except asyncio.TimeoutError:
                    yield {"event": "ping", "data": "{}"}
                    continue

                if item is None:   # sentinel
                    break

                yield {"event": item["event"], "data": json.dumps(item["data"])}

                if item["event"] == "done":
                    break
        except asyncio.CancelledError:
            pass
        finally:
            _RUN_QUEUES.pop(job_id, None)  # clean up after consumer is done

    return EventSourceResponse(generator())


# ── Datasets list ─────────────────────────────────────────────────────────────

@router.get("/datasets")
async def list_datasets(user=Depends(get_current_user)):
    """List datasets owned by this org for the datasource picker."""
    datasets = await DatasetProfile.find(DatasetProfile.org_id == user.org_id).to_list()
    return {
        "items": [
            {
                "id": str(d.id),
                "name": d.name,
                "description": d.description,
                "category": d.category,
                "status": d.status,
                "fields": [
                    {"id": f.id, "label": f.label, "type": f.type, "required": f.required}
                    for f in (d.fields or [])
                ],
            }
            for d in datasets
        ],
        "total": len(datasets),
    }


# ── Dataset autofill ──────────────────────────────────────────────────────────

@router.get("/datasets/{dataset_id}/autofill")
async def dataset_autofill(dataset_id: str, user=Depends(get_current_user)):
    """Generate a trainer boilerplate pre-wired to a dataset."""
    from beanie import PydanticObjectId
    try:
        oid = PydanticObjectId(dataset_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid dataset ID")

    ds = await DatasetProfile.find_one(DatasetProfile.id == oid)
    if not ds or ds.org_id != user.org_id:
        raise HTTPException(status_code=404, detail="Dataset not found")

    fields = [{"id": f.id, "label": f.label, "type": f.type, "required": f.required} for f in (ds.fields or [])]
    class_name = "".join(w.title() for w in ds.name.replace("-", " ").replace("_", " ").split()) + "Trainer"
    filename = class_name.lower() + ".py"

    code = _generate_dataset_trainer(str(ds.id), ds.name, class_name, fields)
    return {
        "code": code,
        "filename": filename,
        "trainer_name": class_name.lower(),
        "dataset": {"id": str(ds.id), "name": ds.name, "fields": fields},
    }


def _generate_dataset_trainer(dataset_id: str, dataset_name: str, class_name: str, fields: list) -> str:
    # Build human-readable field map: id -> label
    field_id_to_label = {f.get("id", ""): f.get("label", f.get("id", "?")) for f in fields}
    field_comments = "\n".join(
        f"    #   [{f.get('id', '?')}]  {f.get('label', '?')} ({f.get('type', 'text')})"
        for f in fields
    )
    field_schema_lines = "\n".join(
        f'        "{f.get("id", "field")}": {{"type": "{"image" if f.get("type") == "image" else "string"}", '
        f'"label": "{f.get("label", f.get("id", "?"))}"}}, '
        for f in fields[:5]
    )
    # Pick the last field as default label (usually the "target" field added last)
    default_label_id = fields[-1].get("id", "label") if fields else "label"
    default_label_name = field_id_to_label.get(default_label_id, default_label_id)

    return f'''"""
{class_name} — auto-generated trainer for dataset "{dataset_name}".

Dataset ID: {dataset_id}

Fields (id → label):
{field_comments}

How the data is structured:
  Each DatasetEntry is ONE field value submitted by ONE collector.
  preprocess() pivots by collector_id so each row = one collector's full submission.
  Collectors who didn't submit every field will have NaN for those columns.

  IMPORTANT: set label_col to the field ID of the column you want to predict.
  Current default: "{default_label_id}"  ({default_label_name})
"""
from app.abstract.base_trainer import BaseTrainer, TrainingConfig
from app.abstract.data_source import DatasetDataSource
import pandas as pd


class {class_name}(BaseTrainer):
    name = "{class_name.lower()}"
    version = "1.0.0"
    description = "Trained on dataset: {dataset_name}"
    framework = "sklearn"

    # Loads all entries from the "{dataset_name}" dataset
    data_source = DatasetDataSource(dataset_id="{dataset_id}")

    input_schema = {{
{field_schema_lines}
    }}
    output_schema = {{
        "label": {{"type": "text", "label": "Predicted Label"}},
        "confidence": {{"type": "number", "label": "Confidence", "format": "percent"}},
    }}

    def preprocess(self, raw):
        """
        Pivots entries so each row = one collector_id, columns = field_ids.
        If the same collector submitted a field multiple times the last value wins.
        """
        if not raw:
            raise ValueError("Dataset is empty — collect some entries first.")

        rows: dict = {{}}
        for entry in raw:
            # Group by collector_id: all fields submitted by the same collector → one row
            key = entry.get("collector_id") or entry.get("entry_id", "unknown")
            if key not in rows:
                rows[key] = {{}}
            field_id = entry.get("field_id", "unknown")
            rows[key][field_id] = (
                entry.get("text_value")
                or entry.get("description")
                or entry.get("file_url")
            )

        df = pd.DataFrame(list(rows.values()))
        print(f"[preprocess] {{len(df)}} rows, {{len(df.columns)}} fields. Columns: {{list(df.columns)}}")
        return df

    def train(self, preprocessed: pd.DataFrame, config: TrainingConfig):
        """
        Set label_col to the field ID you want to predict.
        Available field IDs are printed by preprocess() above.
        auto_train_tabular tries RandomForest, GBM, and LogReg then picks the best.
        """
        # ↓ Change this to the field_id of your target/label column
        label_col = "{default_label_id}"

        if label_col not in preprocessed.columns:
            raise ValueError(
                f"Label column {{label_col!r}} not found. "
                f"Available columns: {{list(preprocessed.columns)}}\\n"
                f"Edit label_col in train() to one of those field IDs."
            )
        preprocessed = preprocessed.dropna(subset=[label_col])
        if len(preprocessed) < 2:
            raise ValueError(
                f"Only {{len(preprocessed)}} row(s) remain after dropping NaN labels — "
                "need at least 2 to train. Collect more data or choose a different label column."
            )
        return self.auto_train_tabular(preprocessed, label_col, config)

    def predict(self, model, inputs):
        features = self.get_feature_names()
        arr = [[inputs.get(f, "") for f in features]] if features else [[str(v) for v in inputs.values()]]
        pred = model.predict(arr)[0]
        proba = model.predict_proba(arr)[0].tolist() if hasattr(model, "predict_proba") else [1.0]
        return {{"label": str(pred), "confidence": round(max(proba), 4)}}
'''
