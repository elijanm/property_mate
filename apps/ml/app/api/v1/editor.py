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
import time
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

# Simple in-memory rate limiter for AI endpoints (per user email, sliding window)
_AI_RATE_WINDOW_S = 3600  # 1 hour
_AI_RATE_LIMIT    = 20    # max requests per window
_AI_RATE_STORE: Dict[str, list] = {}  # email -> [timestamp, ...]


def _ai_rate_check(email: str) -> None:
    """Raise HTTPException 429 if the user has exceeded 20 AI chat requests/hour."""
    import time as _time
    now = _time.monotonic()
    cutoff = now - _AI_RATE_WINDOW_S
    stamps = _AI_RATE_STORE.setdefault(email, [])
    # Evict old entries
    _AI_RATE_STORE[email] = [t for t in stamps if t > cutoff]
    if len(_AI_RATE_STORE[email]) >= _AI_RATE_LIMIT:
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded: AI chat is limited to {_AI_RATE_LIMIT} requests per hour.",
        )
    _AI_RATE_STORE[email].append(now)

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
    # Add os.sep suffix to prevent prefix collision (e.g. /tmp/plugin vs /tmp/plugin_evil)
    if not str(full).startswith(str(base) + os.sep) and full != base:
        raise HTTPException(status_code=400, detail="Path traversal not allowed")
    return full


def _should_hide(name: str) -> bool:
    """Return True for system/cache entries that should not appear in the editor."""
    return (
        (name.startswith("__") and name.endswith("__"))  # __pycache__, __init__ dirs, etc.
        or name.startswith(".")                          # .git, .DS_Store, hidden files
    )


def _file_node(p: Path, base: Path) -> Dict[str, Any]:
    rel = str(p.relative_to(base))
    if p.is_dir():
        children = sorted(
            (c for c in p.iterdir() if not _should_hide(c.name)),
            key=lambda x: (x.is_file(), x.name.lower()),
        )
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
    children: List[Path] = (
        sorted(
            (c for c in base.iterdir() if not _should_hide(c.name)),
            key=lambda x: (x.is_file(), x.name.lower()),
        )
        if base.exists() else []
    )
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

    # Security scan Python files before writing
    if body.path.endswith(".py"):
        violation = _security_check(body.content)
        if violation:
            raise HTTPException(status_code=400, detail=f"Security violation: {violation}")
        # AST compile check — catches syntax errors before writing
        try:
            compile(body.content, body.path, "exec")
        except SyntaxError as e:
            raise HTTPException(
                status_code=400,
                detail=f"SyntaxError at line {e.lineno}: {e.msg}",
            )

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
from app.abstract.base_trainer import BaseTrainer, TrainingConfig, EvaluationResult, TrainerBundle
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
    # Process / shell execution
    "subprocess", "multiprocessing", "pty", "tty", "termios",
    # Network I/O (trainers must use SafeHttpClient, not raw sockets/HTTP)
    "socket", "urllib", "requests", "httpx", "aiohttp",
    # Dynamic import / native code
    "ctypes", "cffi", "importlib",
    # Database drivers (no direct DB access in trainer code)
    "motor", "pymongo", "beanie", "sqlalchemy", "asyncpg",
    "psycopg2", "redis",
])

# os.* methods that are blocked
_BLOCKED_OS_ATTRS = frozenset([
    "system", "popen", "popen2", "popen3", "popen4",
    "execl", "execle", "execlp", "execv", "execve", "execvp", "execvpe",
    "fork", "forkpty", "spawnl", "spawnle", "spawnlp",
    "spawnv", "spawnve", "spawnvp", "kill", "killpg",
    "unlink", "rmdir", "removedirs", "remove",
    # Environment variable access
    "environ", "getenv", "putenv", "environb",
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

        # Block os.environ / os.getenv direct attribute access (not inside a Call)
        if (
            isinstance(node, ast.Attribute)
            and isinstance(node.value, ast.Name)
            and node.value.id == "os"
            and node.attr in _BLOCKED_OS_ATTRS
        ):
            return f"Restricted access: os.{node.attr} is not allowed in trainer code"

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


# ── AI trainer generation ─────────────────────────────────────────────────────

_TRAINER_SYSTEM_PROMPT = """\
You are an expert ML engineer who writes clean, production-ready Python trainer plugins for MLDock.
You MUST output ONLY valid Python code — no prose, no markdown fences, no explanations.
The code must follow the BaseTrainer pattern exactly as documented below.

━━ BaseTrainer CONTRACT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
from app.abstract.base_trainer import BaseTrainer, TrainingConfig, EvaluationResult, TrainerBundle
from app.abstract.data_source import (
    DatasetDataSource, InMemoryDataSource, UploadedFileDataSource,
    S3DataSource, URLDataSource, MongoDBDataSource, HuggingFaceDataSource,
)

class MyTrainer(BaseTrainer):
    name        = "my_trainer"          # unique slug — used as inference endpoint path
    version     = "1.0.0"
    description = "..."
    framework   = "sklearn"             # sklearn | pytorch | tensorflow | custom
    category    = {"key": "...", "label": "..."}
    schedule    = None                  # None = manual only; cron e.g. "0 3 * * 0"

    data_source = DatasetDataSource(
        slug="my-dataset",
        auto_create_spec={
            "name": "My Dataset",
            "description": "...",
            "fields": [
                {"label": "...", "type": "file", "instruction": "...", "capture_mode": "upload_only"},
            ],
        },
    )

    input_schema  = { "field": {"type": "...", "label": "...", "required": True} }
    output_schema = { "field": {"type": "...", "label": "..."} }

    def preprocess(self, raw):  ...  # transform raw data_source output → training-ready form
    def train(self, preprocessed, config: TrainingConfig):  ...  # MUST return (model, test_data) tuple
    def predict(self, model, inputs: dict) -> dict:  ...  # return JSON-serialisable dict
    def evaluate(self, model, test_data) -> EvaluationResult:  ...  # REQUIRED — always implement
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DataSource options the user may choose:
  DatasetDataSource(slug=..., auto_create_spec={...})   — MLDock dataset (preferred)
  UploadedFileDataSource()                               — file uploaded per run
  S3DataSource(bucket=..., key=...)                      — S3/MinIO path
  URLDataSource(url=...)                                 — HTTP/HTTPS download
  MongoDBDataSource(database=..., collection=..., query={}) — MongoDB query
  HuggingFaceDataSource(dataset_name=..., split="train") — HF Hub
  InMemoryDataSource()                                   — preprocess() fetches data itself

Built-in helpers inside train():
  self.auto_train_tabular(df, "label_col", config)   → (best_model, (X_test, y_test))
  self.auto_train_torch(model, train_loader, config, val_loader) → trained_model
  self.split_data(X, y, config)      → (X_tr, X_val, X_te, y_tr, y_val, y_te)
  self.build_dataloader(dataset, config)
  self.get_amp_context(config)
  self.build_optimizer(params, config)
  self.build_scheduler(opt, config, n_steps)
  self.log_device_info(config)

Rules:
- Class name must be PascalCase; name attribute must be snake_case derived from the class name.
  CRITICAL: name = "image_similarity_trainer" must match EXACTLY what was set.
  The scanner imports your file — if it crashes on import, the trainer is lost.
- ALL imports (torch, torchvision, sklearn, PIL, numpy, scipy, etc.) MUST be placed INSIDE
  the method bodies (preprocess, train, predict), NEVER at module level.
  Module-level imports of optional packages cause ImportError during trainer scan → trainer not found.
  ✅ CORRECT: def train(self, preprocessed, config):
                  import torch, torchvision.models as tvm
                  ...
  ❌ WRONG: import torch  ← at top of file — breaks scanner on machines without torch
- All S3 writes go to /tmp/. Never write outside /tmp in trainer code.
- Docstring at top of file: explain what the trainer does, dataset format, inference I/O.
- input_schema and output_schema MUST be defined for the UI to render forms correctly.
- evaluate() is REQUIRED in every trainer — always implement it and always return (model, test_data)
  from train() so it gets called. Pattern per task type:
    classification/regression → from sklearn.metrics import accuracy_score, mean_squared_error
      return EvaluationResult(extra_metrics={"accuracy": accuracy_score(y_true, y_pred)})
    clustering → return EvaluationResult(extra_metrics={"silhouette": silhouette_score(X, labels)})
    image_similarity/embedding → return EvaluationResult(extra_metrics={"reference_count": len(test_data)})
    NLP → return EvaluationResult(extra_metrics={"f1": f1_score(y_true, y_pred, average='weighted')})
  train() MUST always return (model, test_data) — not just model — so evaluate() is invoked.
- If data_source uses DatasetDataSource, always set auto_create_spec so the dataset is
  auto-created on first run without manual setup.
- FORBIDDEN: Never use pd.read_excel('/path'), pd.read_csv('/path'), open('/path'), or any
  hard-coded file paths inside the trainer. ALL data access MUST go through the raw dict
  returned by data_source.load() — e.g. df = pd.read_csv(raw['data_file']).
"""


class GenerateTrainerRequest(BaseModel):
    description: str                 # what the trainer should do
    data_source_type: str = "dataset" # dataset | upload | s3 | url | mongodb | huggingface | memory
    framework: str = "auto"          # auto | sklearn | pytorch | tensorflow | custom
    class_name: Optional[str] = None # e.g. "MyClassifier" — inferred from description if absent
    extra_notes: str = ""            # any extra instructions


# ── LLM config helpers ────────────────────────────────────────────────────────

# OpenAI GPT-4o baseline rates (USD per token)
_OPENAI_INPUT_RATE  = 5.00  / 1_000_000   # $5  per 1M input tokens
_OPENAI_OUTPUT_RATE = 15.00 / 1_000_000   # $15 per 1M output tokens
_OLLAMA_DISCOUNT    = 0.40                 # Ollama / openai_compatible: 40% of OpenAI rate


def _get_llm_config() -> tuple[str, str, str, str]:
    """Return (base_url, api_key, model_name, provider).

    Reads:
      LLM_PROVIDER  — openai | ollama | openai_compatible   (default: openai)
      LLM_API_KEY   — API key (for Ollama any non-empty string works; defaults to "ollama")
      LLM_MODEL     — model name                            (default: gpt-4o)
      LLM_BASE_URL  — only required for openai_compatible; optional override for ollama
      LLM_TEMPERATURE  — sampling temperature               (default: 0.3)
      LLM_MAX_TOKENS   — max response tokens                (default: 16000)
    """
    provider   = os.environ.get("LLM_PROVIDER", "openai").lower()
    api_key    = os.environ.get("LLM_API_KEY", "")
    model_name = os.environ.get("LLM_MODEL", "gpt-4o")

    if provider == "ollama":
        base_url = os.environ.get("LLM_BASE_URL", "http://localhost:11434/v1")
        if not api_key:
            api_key = "ollama"          # Ollama accepts any non-empty string
    elif provider == "openai":
        base_url = "https://api.openai.com/v1"
    else:                               # openai_compatible
        base_url = os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1")
        if not api_key:
            api_key = "key"

    return base_url, api_key, model_name, provider


def _calc_token_cost(provider: str, input_tokens: int, output_tokens: int) -> float:
    """Return USD cost for the given token counts based on provider pricing."""
    if provider in ("ollama", "openai_compatible"):
        rate_in  = _OPENAI_INPUT_RATE  * _OLLAMA_DISCOUNT
        rate_out = _OPENAI_OUTPUT_RATE * _OLLAMA_DISCOUNT
    else:                               # openai — pass through at cost, no markup
        rate_in  = _OPENAI_INPUT_RATE
        rate_out = _OPENAI_OUTPUT_RATE
    return round(rate_in * input_tokens + rate_out * output_tokens, 8)


def _estimate_tokens(text: str) -> int:
    """Rough token estimate when the API doesn't return usage (e.g. local Ollama)."""
    return max(1, int(len(text.split()) * 1.35))


@router.post("/ai-generate")
async def ai_generate_trainer(
    body: GenerateTrainerRequest,
    user=Depends(require_roles("engineer", "admin")),
):
    """
    Generate a complete trainer plugin from a natural-language description using the
    configured LLM. Returns the Python source that can be pasted directly into the editor.
    """
    base_url, api_key, model_name, provider = _get_llm_config()

    if not api_key or api_key == "key":
        raise HTTPException(
            status_code=503,
            detail="LLM not configured. Set LLM_PROVIDER, LLM_API_KEY, and LLM_MODEL.",
        )

    # ── Billing: check + reserve ─────────────────────────────────────────────
    job_id = str(uuid.uuid4())
    reservation = _calc_token_cost(provider, 3_000, 4_096)   # ~7k tokens max
    try:
        from app.services import wallet_service as _ws
        _wallet = await _ws.get_or_create(user.email, user.org_id or "")
        if _ws.available(_wallet) < reservation:
            raise HTTPException(
                status_code=402,
                detail=(
                    f"Insufficient wallet balance to use AI features. "
                    f"Need ~${reservation:.4f} USD. Top up your wallet."
                ),
            )
        await _ws.reserve(_wallet, reservation, job_id, "AI Generate reservation")
    except HTTPException:
        raise
    except Exception:
        pass   # billing unavailable — allow through (safe fallback)

    ds_hints: dict[str, str] = {
        "dataset":    "Use DatasetDataSource(slug=..., auto_create_spec={...}) so the dataset is auto-created.",
        "upload":     "Use UploadedFileDataSource() — data is uploaded per training run.",
        "s3":         "Use S3DataSource(bucket=..., key=...) — fill in bucket/key from user config.",
        "url":        "Use URLDataSource(url=...) — replace URL with the actual download endpoint.",
        "mongodb":    "Use MongoDBDataSource(database=..., collection=...) — fill in DB/collection.",
        "huggingface":"Use HuggingFaceDataSource(dataset_name=..., split='train').",
        "memory":     "Use InMemoryDataSource() and fetch/generate data inside preprocess().",
    }
    ds_hint = ds_hints.get(body.data_source_type, ds_hints["dataset"])

    fw_hint = ""
    if body.framework not in ("auto", "custom"):
        fw_hint = f"Use {body.framework} as the primary framework."

    class_hint = f"Name the class '{body.class_name}'." if body.class_name else ""

    user_prompt = (
        f"Build a complete MLDock trainer plugin for the following task:\n\n"
        f"{body.description}\n\n"
        f"Data source: {ds_hint}\n"
        + (f"Framework: {fw_hint}\n" if fw_hint else "")
        + (f"Class name: {class_hint}\n" if class_hint else "")
        + (f"Additional notes: {body.extra_notes}\n" if body.extra_notes else "")
        + "\nOutput ONLY the Python source code."
    )

    temperature = float(os.environ.get("LLM_TEMPERATURE", "0.3"))
    max_tokens  = int(os.environ.get("LLM_MAX_TOKENS", "16000"))

    try:
        import httpx
        _num_ctx_g = int(os.environ.get("LLM_NUM_CTX", "0"))
        _gen_body: dict = {
            "model": model_name,
            "messages": [
                {"role": "system", "content": _TRAINER_SYSTEM_PROMPT},
                {"role": "user",   "content": user_prompt},
            ],
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if _num_ctx_g > 0:
            _gen_body["options"] = {"num_ctx": _num_ctx_g}
        print(f"[ai_generate] {provider}/{model_name} max_tokens={max_tokens} num_ctx={_num_ctx_g or 'default'} sys~{len(_TRAINER_SYSTEM_PROMPT)//4}tok user~{len(user_prompt)//4}tok", flush=True)
        async with httpx.AsyncClient(timeout=120) as http:
            resp = await http.post(
                f"{base_url.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=_gen_body,
            )
        resp.raise_for_status()
        data = resp.json()
        raw = data["choices"][0]["message"]["content"].strip()
        code = raw

        # ── Charge wallet for actual tokens used ─────────────────────────────
        usage = data.get("usage", {})
        in_tok  = usage.get("prompt_tokens")    or _estimate_tokens(user_prompt)
        out_tok = usage.get("completion_tokens") or _estimate_tokens(code)
        actual_cost = _calc_token_cost(provider, int(in_tok), int(out_tok))
        try:
            from app.services import wallet_service as _ws
            _wallet2 = await _ws.get_or_create(user.email, user.org_id or "")
            await _ws.release_and_charge(_wallet2, job_id, actual_cost)
        except Exception:
            pass

        # Strip markdown fences if the model wrapped the code anyway
        if code.startswith("```"):
            code = "\n".join(l for l in code.splitlines() if not l.strip().startswith("```")).strip()

        print(f"[ai_generate] final_lines={len(code.splitlines())} in_tok={in_tok} out_tok={out_tok}", flush=True)
        return {
            "code": code,
            "model": model_name,
            "tokens": {"input": in_tok, "output": out_tok},
            "cost_usd": actual_cost,
            "debug": {
                "provider": provider,
                "max_tokens": max_tokens,
                "num_ctx": _num_ctx_g or None,
                "system_prompt_tokens_est": len(_TRAINER_SYSTEM_PROMPT) // 4,
                "final_line_count": len(code.splitlines()) if code else 0,
                "raw_llm_reply": raw,
            },
        }

    except HTTPException:
        raise
    except Exception as exc:
        # Release reservation on failure
        try:
            from app.services import wallet_service as _ws
            _wallet3 = await _ws.get_or_create(user.email, user.org_id or "")
            await _ws.release_and_charge(_wallet3, job_id, 0.0)
        except Exception:
            pass
        if hasattr(exc, "response"):
            logger.error("ai_generate_failed", status=getattr(exc.response, "status_code", "?"), body=str(exc)[:400])
            raise HTTPException(status_code=502, detail=f"LLM API error: {getattr(exc.response, 'status_code', exc)}")
        logger.error("ai_generate_error", error=str(exc))
        raise HTTPException(status_code=502, detail=f"LLM request failed: {exc}")


# ── AI Chat (multi-turn interactive trainer design) ───────────────────────────

_CHAT_SYSTEM_PROMPT = """\
You are an expert ML engineer assistant helping a user design and build a trainer plugin for MLDock.
Engage in focused, practical conversation to understand requirements, then generate production-ready code.

━━ SCOPE EVALUATION (always assess this) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Before diving into requirements, mentally assess:

1. CAN A TRAINER BE BUILT FOR THIS?
   → Identify the model type: classification / regression / clustering / anomaly /
     NLP / image / time-series / image-embedding / image-similarity / custom
   → Identify what the model should return per inference: the output fields and their types
   → If feasible — say so briefly and proceed
   → If not feasible (e.g. user asks for real-time video processing, live audio, web scraping) —
     explain why it's outside a trainer's scope and suggest what IS possible

2. DATA REQUIREMENT ASSESSMENT — critical gate before asking for CSV:
   Some tasks are SELF-CONTAINED — the description alone tells you the data structure AND task.
   For these, NEVER ask for a CSV upload — generate immediately.

   SELF-CONTAINED TASK PATTERNS (detect any of these → proceed to CASE E):
   a) IMAGE SIMILARITY / EMBEDDING / REFERENCE MATCHING:
      "store images in dataset and compare/score at inference"
      "check how similar an image is to stored originals"
      "find nearest match", "similarity score", "feature distance", "image fingerprint"
      → Training data: images stored in platform dataset (field_type = 'image')
      → No CSV needed. Generate the trainer immediately.

   b) IMAGE ANOMALY / DEFECT DETECTION:
      "flag unusual images", "detect defects", "compare to good samples"
      → Same pattern as image similarity. Generate immediately.

   c) FULLY-SPECIFIED TASK:
      User has described: (i) what input the model receives at inference,
      (ii) what output/score it returns, and (iii) what data trains it.
      → That is sufficient. Generate immediately without asking for more.

3. SCOPE NOTE — informational ONLY (never use to delay generation):
   For image tasks it is fine to say in 1 sentence:
   "More reference images → better accuracy; GPU speeds up feature extraction."
   Then IMMEDIATELY generate the code. Never use scope concerns as a reason to ask for data.

4. DEFAULT DEFENSE MECHANISM (non-negotiable):
   Every trainer you generate MUST begin with this comment block:
   # ⚠ AI-GENERATED TRAINER
   # Review by a qualified data scientist or ML engineer before production use.
   # Validate output quality on your specific dataset. For complex tasks
   # (image segmentation, object detection, NLP at scale), expert review is essential.

━━ FIRST RESPONSE RULES (critical) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Check what data context you have BEFORE asking any technical questions:

CASE A — No CSV uploaded AND no dataset selected AND task clearly needs tabular data:
  ONLY for: financial prediction, customer segmentation, sales forecasting, tabular regression/
  classification where column names and row counts affect model design.
  → DO NOT ask about column names. You don't know what data they have yet.
  → Acknowledge the idea warmly (1 sentence), briefly state what model type would suit it
    and what outputs it would produce, then say:
    "To get started, could you either:
     • Upload a CSV or Excel file using the Upload Data button below, or
     • Describe your data — what fields/columns you typically have and roughly how many rows?"
  → Nothing else. One clear ask.
  ⚠ NEVER apply CASE A to image/embedding tasks or any self-contained description → use CASE E.

CASE B — CSV schema IS available (shown in CONTEXT section):
  → Acknowledge the idea (1 sentence).
  → State the recommended model type and expected outputs.
  → Immediately analyze the schema: identify likely features, target column, and unique ID field.
  → Ask ONE focused question about anything ambiguous.

CASE C — Platform dataset IS selected:
  → Acknowledge the idea (1 sentence).
  → State the recommended model type and expected outputs.
  → Reference the dataset fields shown in CONTEXT.
  → Ask ONE question to clarify the task goal if needed, or proceed to generate.

CASE D — Data inspection summary received (user just cleaned/uploaded data):
  → Act like a senior data scientist receiving a brief.
  → State clearly: what model type fits, what the target variable likely is, what features
    to use, what algorithm to start with, and what output fields the trainer should produce.
  → If anything is ambiguous, ask ONE focused question. Otherwise generate.

CASE E — Self-contained description (image similarity / embedding / fully-specified):
  → The user has given you everything needed. NEVER ask for CSV or more info.
  → In 2–3 sentences confirm: the approach (e.g. MobileNetV2 embeddings + cosine similarity),
    how training works (store embeddings per reference image), what inference returns
    (top-N matches with similarity scores 0–1).
  → Then IMMEDIATELY generate the full trainer code.

━━ SUBSEQUENT RESPONSES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- Give a helpful answer and ask at most ONE follow-up question per turn.
- If user describes columns in text: treat that as the schema — analyze and proceed.
- Multi-dataset merging: identify the shared join key, explain how preprocess() will merge them.
- Suggest output_schema with derived metrics: segment labels, scores, feature importances,
  cluster counts, probabilities, confidence intervals, etc.
- When you have enough information OR generate_now=True: generate the FULL trainer code.

━━ CODE GENERATION FORMAT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

When you generate trainer code you MUST use EXACTLY this wrapper — no markdown fences inside it:

<CODE_START filename="descriptive_snake_case.py">
# paste raw Python here — no ```python, no backticks
</CODE_START>

CRITICAL: Do NOT wrap the code block in backticks. Do NOT put ```python inside <CODE_START>.
The filename attribute must be snake_case.py derived from the class name.

After the closing tag, optionally add ONE line:
SUGGESTIONS: Refine the algorithm | Add more features | Explain output fields | Test with sample data

━━ STYLE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- Max 2 short paragraphs of text (outside code blocks)
- Never ask multiple questions at once
- Never ask about column names when you have no data context yet — ask for the file first
"""

_TRAINER_SYSTEM_PROMPT_BRIEF = """\
Rules (copy exactly):
- name = snake_case, version, description, framework, category required
- ALL imports INSIDE method bodies (never at module level) — scanner crashes on top-level imports
- data_source uses DatasetDataSource with auto_create_spec so dataset auto-creates
- input_schema and output_schema MUST be defined
- train() returns (model, test_data); evaluate() returns EvaluationResult
- No hard-coded file paths; no writes outside /tmp
- Docstring at top of file
"""

_CHAT_CODE_INSTRUCTIONS = '''
━━ COMPLETE CANONICAL TRAINER PSEUDOCODE (tabular / CSV tasks) ━━━━━━━━━━━━━━━━
This is the COMPLETE file structure every trainer must follow.
Replace every <…> placeholder with a real value suited to the task.
Do NOT omit any section — all attributes and all four methods are required.

"""
<ClassName> — <one-line description: what it predicts and from what data>.
Dataset: upload a CSV file. Each row is one labelled sample.
Inference input: <describe each input field the user provides at prediction time>.
Inference output: <describe each key returned by predict()>.
Requirements: <list pip packages used, e.g. scikit-learn, xgboost, pandas, numpy>.
"""
import base64
import io
import os
import re
import shutil
import zipfile
from pathlib import Path
from typing import Optional

from app.abstract.base_trainer import BaseTrainer, TrainingConfig, EvaluationResult, TrainerBundle, OutputFieldSpec, DerivedMetricSpec
from app.abstract.data_source import DatasetDataSource   # swap for S3DataSource / HuggingFaceDataSource / etc. if needed


class <ClassName>(BaseTrainer):
    # ── Identity ──────────────────────────────────────────────────────────────
    name        = "<snake_case_name>"        # unique slug — used as API endpoint path
    version     = "1.0.0"
    description = "<one-line description>"
    framework   = "<sklearn | pytorch | tensorflow | custom>"
    category    = {"key": "<category-key>", "label": "<Category Label>"}
    #              common keys: classification, regression, clustering, anomaly,
    #              nlp, image-classification, image-similarity, object-detection,
    #              ocr, embedding, time-series, recommendation, custom
    schedule    = None                       # or cron string e.g. "0 3 * * 0" (Sun 3am)
    tags        = {"domain": "<domain>", "task": "<task>"}  # arbitrary MLflow tags

    # ── Packages required at runtime ──────────────────────────────────────────
    requirements = [
        "<package1>",     # e.g. "scikit-learn>=1.3"
        "<package2>",     # e.g. "xgboost", "torch", "transformers", "sentence-transformers"
    ]

    # ── Data source ───────────────────────────────────────────────────────────
    data_source = DatasetDataSource(
        slug="<unique-dataset-slug>",
        auto_create_spec={
            "name":        "<Human-readable dataset name>",
            "description": "<What the user should upload / what each entry contains>",
            "fields": [
                {"label": "Original Upload", "type": "file",  "required": True,
                 "instruction": "Upload a CSV with labelled rows"},
                # add more fields if the dataset needs multiple uploads or text annotations:
                # {"label": "Label",          "type": "text",  "required": False},
                # {"label": "Reference Image","type": "image", "required": False},
            ],
        },
    )

    # ── Inference UI schemas ───────────────────────────────────────────────────
    input_schema = {
        "<field_key>": {"type": "<number | text | file | image>", "label": "<Field Label>", "required": True},
        # add one entry per user-facing input field
    }
    output_schema = {
        "<output_key>": {"type": "<str | float | int | bool | list | dict>", "label": "<Output Label>"},
        # add one entry per key returned by predict()
    }

    # ── How predict() output is rendered in the UI ─────────────────────────────
    output_display = [
        OutputFieldSpec("<primary_output_key>", "<label | reading | confidence | text | image | json>",
                        "<Display Name>", primary=True, hint="<placeholder for feedback input>"),
        OutputFieldSpec("<secondary_key>",      "confidence", "<Display Name>"),
        # types: image | reading | label | confidence | ranked_list | bbox_list | table_list | text | json
        # primary=True → this field is the main prediction used for feedback tracking
    ]

    # ── Derived metrics computed from user feedback (optional) ────────────────
    derived_metrics = [
        DerivedMetricSpec("exact_match",  "Exact Match Rate", unit="%",    higher_is_better=True,  category="accuracy"),
        # DerivedMetricSpec("edit_distance","Edit Distance",   unit="chars", higher_is_better=False, category="error"),
    ]

    # ── Methods ───────────────────────────────────────────────────────────────

    def preprocess(self, raw):
        """Load and clean training data. raw is a list of dataset entries;
        each entry is itself a list of field dicts with keys:
        field_type, field_label, file_key, file_url, file_mime, text_value, id."""
        import io, pandas as pd
        # Flatten all field dicts across all entries
        all_fields = [f for entry in raw for f in (entry if isinstance(entry, list) else [entry])]
        # Find the file field (prefer 'Original Upload', fall back to any file)
        file_field = (
            next((f for f in all_fields if f.get('field_label') == 'Original Upload'
                  and (f.get('file_key') or f.get('file_url'))), None)
            or next((f for f in all_fields if f.get('field_type') == 'file'
                     and (f.get('file_key') or f.get('file_url'))), None)
        )
        if not file_field:
            raise ValueError("No file found in dataset — upload a CSV via the Datasets page.")
        content = self._fetch_bytes(file_field.get('file_key'), file_field.get('file_url'))
        fname = (file_field.get('file_key') or '').split('/')[-1].lower()
        if fname.endswith(('.xlsx', '.xls')):
            df = pd.read_excel(io.BytesIO(content))
        else:
            try:
                df = pd.read_csv(io.BytesIO(content))
            except Exception:
                df = pd.read_csv(io.BytesIO(content), on_bad_lines='skip', engine='python')
        df = df.dropna()
        # <add any feature engineering, encoding, or filtering here>
        return df

    def train(self, preprocessed, config: TrainingConfig):
        """Train the model. MUST return (artifact, test_data) so evaluate() is called.
        All imports go inside this method body — never at module level."""
        # import the libraries needed (all inside the method):
        # from sklearn.ensemble import RandomForestClassifier
        # from sklearn.pipeline import Pipeline
        # from sklearn.preprocessing import StandardScaler, LabelEncoder
        # import numpy as np

        df = preprocessed
        label_col = "<target_column_name>"   # column to predict
        df_tr, df_te = self.split_dataframe(df, label_col, config)
        X_tr = df_tr.drop(columns=[label_col])
        y_tr = df_tr[label_col]
        X_te = df_te.drop(columns=[label_col])
        y_te = df_te[label_col]

        # Option A — supervised with sklearn Pipeline (scaler + model in one artifact):
        # pipeline = Pipeline([('scaler', StandardScaler()), ('clf', <Estimator>(...))])
        # pipeline.fit(X_tr, y_tr)
        # return pipeline, (X_te, y_te)

        # Option B — multi-artifact with TrainerBundle (needed for encoders, feature names, etc.):
        # <fit scaler, encoder, model separately>
        # return TrainerBundle(
        #     model=<fitted_model>,
        #     scaler=<fitted_scaler>,          # optional
        #     encoder=<fitted_label_encoder>,  # optional
        #     feature_names=list(X_tr.columns),
        #     label_map={0: "class_a", 1: "class_b"},
        #     extra={"<any_other_artifact>": <value>},
        # ), (X_te, y_te)

        raise NotImplementedError("Replace this with real training logic")

    def predict(self, model, inputs: dict) -> dict:
        """Run inference. model is the artifact returned by train() — a Pipeline or TrainerBundle.
        inputs is a flat dict matching input_schema keys.
        All imports go inside this method body.
        NEVER access self.scaler / self.encoder here — use model.scaler / model.encoder."""
        # import pandas as pd  (if needed)

        # For Pipeline:
        # row = pd.DataFrame([[inputs.get(f, 0) for f in <feature_list>]], columns=<feature_list>)
        # pred = model.predict(row)[0]
        # proba = model.predict_proba(row)[0]
        # return {"<output_key>": <value>, ...}

        # For TrainerBundle:
        # row = pd.DataFrame([[inputs.get(f, 0) for f in model.feature_names]], columns=model.feature_names)
        # X_scaled = model.scaler.transform(row)
        # pred_idx = int(model.model.predict(X_scaled)[0])
        # label = model.label_map.get(pred_idx, str(pred_idx))
        # return {"label": label, "confidence": round(float(model.model.predict_proba(X_scaled)[0][pred_idx]), 4)}

        raise NotImplementedError("Replace this with real inference logic")

    def evaluate(self, model, test_data) -> EvaluationResult:
        """Evaluate on the held-out test split returned by train().
        All imports go inside this method body."""
        # from sklearn.metrics import accuracy_score, f1_score, mean_squared_error
        X_te, y_te = test_data
        # y_pred = model.predict(X_te)  # or model.model.predict(...) for TrainerBundle
        # return EvaluationResult(
        #     accuracy=float(accuracy_score(y_te, y_pred)),        # classification
        #     f1=float(f1_score(y_te, y_pred, average="weighted")),# classification
        #     # mse=float(mean_squared_error(y_te, y_pred)),        # regression
        #     # r2=float(r2_score(y_te, y_pred)),                   # regression
        #     y_true=list(y_te), y_pred=list(y_pred),              # for confusion matrix
        #     extra_metrics={"<custom_metric>": <float_value>},
        # )
        raise NotImplementedError("Replace this with real evaluation logic")

━━ END CANONICAL PSEUDOCODE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ABSOLUTE RULES — any violation causes a registration crash or runtime error:

IMPORTS
  ✅ Standard library imports are ALWAYS at module level (top of file):
       import base64, io, os, re, shutil, zipfile
       from pathlib import Path
       from typing import Optional
  ✅ Then the two mandatory framework imports:
       from app.abstract.base_trainer import BaseTrainer, TrainingConfig, EvaluationResult, TrainerBundle, OutputFieldSpec, DerivedMetricSpec
       from app.abstract.data_source import DatasetDataSource  (add S3DataSource, HuggingFaceDataSource, etc. as needed)
  ✅ Optional/heavy packages (torch, sklearn, PIL, numpy, cv2, transformers, etc.) go INSIDE method bodies
  ❌ NEVER:  from mldock.trainers import ...   ← package does not exist
  ❌ NEVER:  from mldock import ...            ← package does not exist
  ❌ NEVER:  import torch / import sklearn at module level — breaks scanner on machines without that package

data_source
  ✅ data_source = DatasetDataSource(slug="...", auto_create_spec={"name":...,"description":...,"fields":[...]})
  ❌ data_source = "DatasetDataSource(...)"    ← string — AttributeError on startup, whole service crashes
  ❌ data_source = DatasetDataSource(auto_create_spec=True)  ← True is not a dict

category
  ✅ category = {"key": "classification", "label": "Classification"}
  ❌ category = "classification"              ← string — UI breaks

TrainerBundle — all valid kwargs (anything else crashes):
  TrainerBundle(
      model         = <fitted estimator or neural net>,   # required
      scaler        = <fitted StandardScaler/MinMaxScaler/RobustScaler>,  # optional
      encoder       = <fitted LabelEncoder/OrdinalEncoder>,               # optional
      vectorizer    = <fitted TfidfVectorizer/CountVectorizer>,           # optional
      feature_names = ["col1", "col2", ...],              # optional — column order for predict()
      label_map     = {0: "cat", 1: "dog"},               # optional — int index → human label
      threshold     = 0.75,                               # optional — anomaly/decision threshold
      extra         = {"key": <any serialisable value>},  # optional — anything else
  )
  ❌ TrainerBundle(model=m, embeddings=arr, transform=t)  ← unknown kwargs, crashes at save time

EvaluationResult — all available fields (use whichever apply to the task):
  EvaluationResult(
      accuracy    = float,          # classification
      precision   = float,          # classification
      recall      = float,          # classification
      f1          = float,          # classification
      roc_auc     = float,          # binary classification
      mse         = float,          # regression
      mae         = float,          # regression
      r2          = float,          # regression
      y_true      = list,           # raw labels — enables confusion matrix in UI
      y_pred      = list,           # raw predictions — enables confusion matrix in UI
      extra_metrics = {"key": float, ...},  # any custom metric
  )
  ❌ EvaluationResult(metrics={"accuracy": 0.95})   ← field does not exist, use extra_metrics

predict() receives a TrainerBundle (or sklearn Pipeline) — NOT self state from train():
  ✅ model.feature_names, model.label_map, model.encoder, model.extra["key"]
  ❌ self.feature_names  ← self is a fresh instance, train() state is gone

EMBEDDING / SIMILARITY TRAINERS (image, text, audio, product, face, etc.):
  Pattern: build a reference library at train time, compare a query at inference time.
  Choose the backbone appropriate to the modality and task:
    image similarity / face recognition → MobileNetV2, EfficientNet, ResNet, FaceNet, ArcFace, CLIP, …
    text / semantic search              → sentence-transformers, SBERT, TF-IDF + cosine, BM25, …
    audio fingerprinting                → MFCC + cosine, PANNs, wav2vec, …
    product / e-commerce matching       → CLIP, ResNet + metric learning, …

  Complete pseudocode — use this exact file structure, replace <...> with real implementation:

"""
<ClassName> — <one-line description: what it matches and why, e.g. face recognition, product search>.
Dataset: <describe each dataset field, e.g. one image per entry + optional label text>.
Inference input: <describe the query, e.g. a single query image uploaded by the user>.
Inference output: {"best_score": float, "best_match_id": str, "top_matches": list-of-dicts}.
Requirements: <list pip packages, e.g. torch, torchvision, Pillow, sentence-transformers, numpy>.
"""
import base64
import io
import os
import re
import shutil
import zipfile
from pathlib import Path
from typing import Optional

from app.abstract.base_trainer import BaseTrainer, TrainingConfig, EvaluationResult, TrainerBundle, OutputFieldSpec
from app.abstract.data_source import DatasetDataSource   # swap if data lives elsewhere


class <ClassName>(BaseTrainer):
    # ── Identity ──────────────────────────────────────────────────────────────
    name        = "<snake_case_name>"
    version     = "1.0.0"
    description = "<what this trainer matches>"
    framework   = "<torch | sklearn | custom>"
    category    = {"key": "<image-similarity | embedding | nlp | custom>", "label": "<Label>"}
    schedule    = None
    tags        = {"domain": "<domain>", "task": "similarity"}

    # ── Packages required at runtime ──────────────────────────────────────────
    requirements = [
        "<package1>",   # e.g. "torch", "torchvision", "Pillow", "sentence-transformers"
        "<package2>",
    ]

    # ── Data source ───────────────────────────────────────────────────────────
    data_source = DatasetDataSource(
        slug="<unique-dataset-slug>",
        auto_create_spec={
            "name":        "<Dataset Name>",
            "description": "<What the user uploads, e.g. one reference image per entry>",
            "fields": [
                {"label": "<Image | Document | Audio>", "type": "<image | file | text>",
                 "required": True, "instruction": "<what to upload>"},
                # optional label field:
                # {"label": "Label", "type": "text", "required": False},
            ],
        },
    )

    # ── Inference UI schemas ───────────────────────────────────────────────────
    input_schema = {
        "<query_field>": {"type": "<file | image | text>", "label": "<Query Label>", "required": True},
    }
    output_schema = {
        "best_score":    {"type": "float", "label": "Best Match Score"},
        "best_match_id": {"type": "str",   "label": "Best Match ID"},
        "top_matches":   {"type": "list",  "label": "Top Matches"},
    }

    # ── How predict() output is rendered in the UI ─────────────────────────────
    output_display = [
        OutputFieldSpec("best_score",    "confidence", "Best Match Score", primary=True),
        OutputFieldSpec("best_match_id", "label",      "Best Match ID"),
        OutputFieldSpec("top_matches",   "ranked_list","Top Matches",       span=2),
    ]

    # ── Methods ───────────────────────────────────────────────────────────────

    def preprocess(self, raw):
        """Fetch and return all reference items from the dataset.
        raw is a list of entries; each entry is a list of field dicts with keys:
        field_type, field_label, file_key, file_url, file_mime, text_value, id."""
        items = []
        for entry in raw:
            fields = entry if isinstance(entry, list) else [entry]
            # pick the field that holds the content for this modality:
            f = next(
                (f for f in fields
                 if f.get('field_type') in ('<image | file | text | audio>')
                 and (f.get('file_key') or f.get('file_url') or f.get('text_value'))),
                None,
            )
            if not f:
                continue
            content = self._fetch_bytes(f.get('file_key'), f.get('file_url'))
            # for text fields use instead: content = f.get('text_value', '')
            label = f.get('text_value') or f.get('field_label') or 'reference'
            items.append({'id': f.get('id', str(len(items))), 'label': label, 'content': content})
        if not items:
            raise ValueError("Dataset has no valid entries — upload reference items first.")
        return items

    def train(self, preprocessed, config: TrainingConfig):
        """Build the reference embedding library. All imports inside this method.
        MUST return (TrainerBundle, test_data) so evaluate() is called."""
        import numpy as np
        # import the backbone suited to the modality — all inside this method:
        # import torch, torchvision.models as tvm, torchvision.transforms as T  (images)
        # from sentence_transformers import SentenceTransformer                   (text)
        # import librosa                                                          (audio)

        # 1. Load / instantiate the encoder (no gradient updates needed):
        encoder = <load_or_instantiate_backbone>
        # e.g. backbone = tvm.mobilenet_v2(weights=tvm.MobileNet_V2_Weights.IMAGENET1K_V1)
        #      backbone.classifier = torch.nn.Identity(); backbone.eval()

        # 2. Encode every reference item to a fixed-length numpy vector:
        embeddings = np.stack([<encode(item['content'], encoder)> for item in preprocessed])
        # e.g. backbone(transform(img).unsqueeze(0)).squeeze().cpu().numpy()
        # e.g. encoder.encode(item['content'])

        bundle = TrainerBundle(
            model=encoder,
            extra={
                "embeddings": embeddings,                           # shape (N, D) — required
                "labels":     [i['label'] for i in preprocessed],  # required
                "ids":        [i['id']    for i in preprocessed],   # required
                # store any other artifact needed at predict time:
                # "transform": transform,     # torchvision transform pipeline
                # "tokenizer": tokenizer,     # text tokenizer
            },
        )
        return bundle, preprocessed   # preprocessed passed as test_data to evaluate()

    def predict(self, model: TrainerBundle, inputs: dict) -> dict:
        """Embed query and return cosine-ranked top matches.
        model is the TrainerBundle from train(). All imports inside this method."""
        import numpy as np
        # import the same library used in train()

        raw_input = inputs.get('<query_field>') or next(iter(inputs.values()), '')
        # for file/image: import base64; query_content = base64.b64decode(raw_input)
        # for text:       query_content = raw_input

        q_emb = <encode(query_content, model.model)>   # shape (D,)

        ref   = model.extra['embeddings']              # shape (N, D)
        ref_n = ref   / np.maximum(np.linalg.norm(ref,   axis=1, keepdims=True), 1e-8)
        q_n   = q_emb / max(float(np.linalg.norm(q_emb)), 1e-8)
        scores = (ref_n @ q_n).tolist()

        hits = [
            {'id': model.extra['ids'][i], 'score': round(float(scores[i]), 4),
             'label': model.extra['labels'][i]}
            for i in range(len(scores))
        ]
        hits.sort(key=lambda x: x['score'], reverse=True)
        top  = hits[:5]
        best = top[0] if top else {}
        return {
            'best_score':    best.get('score', 0.0),
            'best_match_id': best.get('id', ''),
            'top_matches':   top,
        }

    def evaluate(self, model: TrainerBundle, test_data) -> EvaluationResult:
        """Evaluate the reference library quality."""
        return EvaluationResult(
            extra_metrics={
                "reference_count": len(model.extra["embeddings"]),
                "embedding_dim":   int(model.extra["embeddings"].shape[1]),
            }
        )

SCALERS: StandardScaler (default), MinMaxScaler (0–1), RobustScaler (outliers)
  Tree-based models (RF, GBM, XGBoost) do NOT need a scaler — omit it.

FILE inputs in predict(): always base64-encoded → decode with base64.b64decode(inputs["field"])
S3 writes: /tmp/ only — never write outside /tmp in trainer code.
''' + _TRAINER_SYSTEM_PROMPT_BRIEF


class AiChatMessage(BaseModel):
    role: str    # "user" | "assistant"
    content: str


class AiChatRequest(BaseModel):
    messages: List[AiChatMessage]
    data_source_type: str = "dataset"
    framework: str = "auto"
    class_name: Optional[str] = None
    csv_schema: Optional[dict] = None          # {"columns": [...], "sample_rows": [[...]]}
    available_datasets: Optional[List[dict]] = None
    generate_now: bool = False
    uploaded_dataset_slug: Optional[str] = None
    uploaded_dataset_id: Optional[str] = None


def _pascal_to_snake(name: str) -> str:
    import re as _re
    s1 = _re.sub('(.)([A-Z][a-z]+)', r'\1_\2', name)
    return _re.sub('([a-z0-9])([A-Z])', r'\1_\2', s1).lower()


@router.post("/ai-chat")
async def ai_chat_trainer(
    body: AiChatRequest,
    user=Depends(require_roles("engineer", "admin")),
):
    """
    Multi-turn conversational trainer design.
    Returns a chat response (text) + optionally extracted Python code.
    """
    import re as _re

    # Per-user rate limit: 20 AI chat requests per hour
    _ai_rate_check(user.email)

    base_url, api_key, model_name, provider = _get_llm_config()

    if not api_key or api_key == "key":
        raise HTTPException(
            status_code=503,
            detail="LLM not configured. Set LLM_PROVIDER, LLM_API_KEY, and LLM_MODEL.",
        )

    # ── Billing: check balance + reserve ─────────────────────────────────────
    chat_job_id  = str(uuid.uuid4())
    # Estimate: full conversation history + system prompt + generous output
    history_chars = sum(len(m.content) for m in body.messages)
    est_in   = max(2_000, int(history_chars / 4) + 1_500)   # chars÷4 ≈ tokens + system prompt
    est_out  = int(os.environ.get("LLM_MAX_TOKENS", "16000"))
    reservation = _calc_token_cost(provider, est_in, est_out)
    try:
        from app.services import wallet_service as _ws
        _wallet = await _ws.get_or_create(user.email, user.org_id or "")
        if _ws.available(_wallet) < max(reservation, 0.001):
            raise HTTPException(
                status_code=402,
                detail=(
                    f"Insufficient wallet balance to use AI features. "
                    f"Estimated cost ~${reservation:.4f} USD. Top up your wallet."
                ),
            )
        await _ws.reserve(_wallet, reservation, chat_job_id, "AI Workshop chat reservation")
    except HTTPException:
        raise
    except Exception:
        pass   # billing unavailable — allow through

    # ── Build context section ────────────────────────────────────────────────
    ctx_parts: list[str] = []

    if body.csv_schema:
        cols = body.csv_schema.get("columns", [])
        rows = body.csv_schema.get("sample_rows", [])[:3]
        ctx_parts.append(
            "UPLOADED CSV SCHEMA:\n"
            f"Columns ({len(cols)}): {', '.join(cols)}\n"
            "Sample rows:\n" + "\n".join("  " + str(r) for r in rows)
        )

    if body.available_datasets:
        lines = []
        for d in body.available_datasets[:6]:
            flds = [f["label"] for f in d.get("fields", [])[:6]]
            lines.append(f"  - {d['name']} (id={d['id']}, fields: {', '.join(flds)})")
        ctx_parts.append("AVAILABLE MLDOCK DATASETS:\n" + "\n".join(lines))

    ds_hints: dict[str, str] = {
        "dataset":     "DatasetDataSource with auto_create_spec (user uploads files via platform UI)",
        "upload":      "UploadedFileDataSource — user provides a file each training run",
        "s3":          "S3DataSource(bucket=..., key=...) — pull from a bucket path",
        "url":         "URLDataSource(url=...) — download from HTTP endpoint",
        "mongodb":     "MongoDBDataSource(database=..., collection=..., query={}) — live query",
        "huggingface": "HuggingFaceDataSource(dataset_name=..., split='train') — HF Hub",
        "memory":      "InMemoryDataSource — generate / fetch data inside preprocess()",
    }
    ctx_parts.append(f"DATA SOURCE: {ds_hints.get(body.data_source_type, body.data_source_type)}")

    if body.uploaded_dataset_slug:
        ctx_parts.append(
            f"UPLOADED DATASET — MANDATORY: use this exact slug in data_source:\n"
            f"  slug = \"{body.uploaded_dataset_slug}\"\n\n"
            f"  data_source = DatasetDataSource(\n"
            f"      slug=\"{body.uploaded_dataset_slug}\",\n"
            f"      auto_create_spec={{\"name\": \"AI Workshop Data\", \"fields\": [\n"
            f"          {{\"label\": \"Original Upload\", \"type\": \"file\", \"required\": True}},\n"
            f"          {{\"label\": \"Clean Copy\", \"type\": \"file\", \"required\": False}},\n"
            f"          {{\"label\": \"Cleaning Code\", \"type\": \"file\", \"required\": False}},\n"
            f"      ]}},\n"
            f"  )\n\n"
            f"  Dataset fields:\n"
            f"    'Original Upload' — raw CSV uploaded by the user (file)\n"
            f"    'Clean Copy'      — cleaned version after preprocessing (file, may be absent)\n"
            f"    'Cleaning Code'   — Python preprocessing script stored as .py file\n\n"
            f"  NOTE: use self._fetch_bytes(file_key, file_url) — built-in BaseTrainer method.\n\n"
            f"  CORRECT preprocess() pattern:\n"
            f"    # raw is a list of entries; each entry is a list of field dicts\n"
            f"    import io\n"
            f"    all_fields = [f for entry in raw for f in (entry if isinstance(entry, list) else [entry])]\n"
            f"    file_field = (\n"
            f"        next((f for f in all_fields if f.get('field_label') == 'Clean Copy' and (f.get('file_key') or f.get('file_url'))), None)\n"
            f"        or next((f for f in all_fields if f.get('field_label') == 'Original Upload' and (f.get('file_key') or f.get('file_url'))), None)\n"
            f"        or next((f for f in all_fields if f.get('field_type') == 'file' and (f.get('file_key') or f.get('file_url'))), None)\n"
            f"    )\n"
            f"    if not file_field: raise ValueError('No data in dataset — upload a CSV via the Datasets page.')\n"
            f"    e = file_field\n"
            f"    content = self._fetch_bytes(e.get('file_key'), e.get('file_url'))\n"
            f"    if content is None: raise ValueError('Could not fetch file from storage.')\n"
            f"    fname = (e.get('file_key') or '').split('/')[-1].lower()\n"
            f"    if fname.endswith(('.xlsx','.xls')):\n"
            f"        df = pd.read_excel(io.BytesIO(content))\n"
            f"    else:\n"
            f"        try:\n"
            f"            df = pd.read_csv(io.BytesIO(content))\n"
            f"        except Exception:\n"
            f"            df = pd.read_csv(io.BytesIO(content), on_bad_lines='skip', engine='python')"
        )

    if body.framework not in ("auto",):
        ctx_parts.append(f"FRAMEWORK: {body.framework}")
    if body.class_name:
        ctx_parts.append(f"CLASS NAME: {body.class_name}")

    sys_prompt = _CHAT_SYSTEM_PROMPT
    if ctx_parts:
        sys_prompt += "\n\n---\nCONTEXT:\n" + "\n\n".join(ctx_parts)
    if body.generate_now:
        sys_prompt += (
            "\n\n⚡ GENERATE NOW: The user clicked 'Generate Now'. "
            "Produce the complete trainer code immediately based on all context gathered so far."
        )
    sys_prompt += "\n\n---\n" + _CHAT_CODE_INSTRUCTIONS

    llm_messages = [{"role": "system", "content": sys_prompt}]
    for m in body.messages:
        llm_messages.append({"role": m.role, "content": m.content})

    # ── Call LLM ─────────────────────────────────────────────────────────────
    temperature = float(os.environ.get("LLM_TEMPERATURE", "0.35"))
    # 8000 default — image similarity + evaluate() trainers need ~200 lines of code;
    # 6000 was too low and caused truncation mid-function (sorted() call cut off).
    max_tokens  = int(os.environ.get("LLM_MAX_TOKENS", "16000"))

    try:
        import httpx
        # Build request body — add Ollama num_ctx if configured (default 2048 is too small)
        _num_ctx = int(os.environ.get("LLM_NUM_CTX", "0"))
        _req_body: dict = {
            "model": model_name,
            "messages": llm_messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if _num_ctx > 0:
            _req_body["options"] = {"num_ctx": _num_ctx}
        print(f"[ai_chat] {provider}/{model_name} max_tokens={max_tokens} num_ctx={_num_ctx or 'default'} sys~{len(sys_prompt)//4}tok", flush=True)
        async with httpx.AsyncClient(timeout=180) as http:
            resp = await http.post(
                f"{base_url.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=_req_body,
            )
        resp.raise_for_status()
        resp_data = resp.json()
        raw: str  = resp_data["choices"][0]["message"]["content"].strip()

        # ── Charge wallet for actual tokens ──────────────────────────────────
        usage   = resp_data.get("usage", {})
        in_tok  = usage.get("prompt_tokens")    or _estimate_tokens(" ".join(m["content"] for m in llm_messages))
        out_tok = usage.get("completion_tokens") or _estimate_tokens(raw)
        actual_cost = _calc_token_cost(provider, int(in_tok), int(out_tok))
        try:
            from app.services import wallet_service as _ws
            _wallet2 = await _ws.get_or_create(user.email, user.org_id or "")
            await _ws.release_and_charge(_wallet2, chat_job_id, actual_cost)
        except Exception:
            pass

    except HTTPException:
        raise
    except Exception as exc:
        # Release reservation on failure
        try:
            from app.services import wallet_service as _ws
            _wallet3 = await _ws.get_or_create(user.email, user.org_id or "")
            await _ws.release_and_charge(_wallet3, chat_job_id, 0.0)
        except Exception:
            pass
        logger.error("ai_chat_failed", error=str(exc))
        raise HTTPException(status_code=502, detail=f"LLM request failed: {exc}")

    # ── Extract code block ────────────────────────────────────────────────────
    code: Optional[str] = None
    filename: Optional[str] = None
    extraction_pass: str = "none"
    continuation_count: int = 0
    repair_ran: bool = False
    cont_replies: list[str] = []

    def _derive_filename(src: str) -> str:
        """Derive snake_case.py filename from the first class name in the code."""
        m = _re.search(r'class\s+(\w+)\s*\(BaseTrainer\)', src)
        if not m:
            m = _re.search(r'class\s+(\w+)', src)
        return (_pascal_to_snake(m.group(1)) + ".py") if m else "generated_trainer.py"

    def _strip_fences(src: str) -> str:
        """Remove any ``` ... ``` wrapper lines from extracted code."""
        lines = src.splitlines()
        return "\n".join(l for l in lines if not _re.match(r'\s*```', l)).strip()

    # Pass 1 — explicit <CODE_START filename="..."> tag (our preferred format)
    code_match = _re.search(
        r'<CODE_START\s+filename=["\']([^"\']+)["\']>\s*(.*?)\s*</CODE_START>',
        raw, _re.DOTALL | _re.IGNORECASE,
    )
    if code_match:
        filename = code_match.group(1).strip()
        code = _strip_fences(code_match.group(2).strip())
        raw = (raw[:code_match.start()] + raw[code_match.end():]).strip()
        extraction_pass = "pass1"

    # Pass 1b — opening tag found but closing tag missing (truncated LLM output)
    if not code:
        open_match = _re.search(
            r'<CODE_START\s+filename=["\']([^"\']+)["\']>\s*(.*)',
            raw, _re.DOTALL | _re.IGNORECASE,
        )
        if open_match and len(open_match.group(2).strip()) > 50:
            filename = open_match.group(1).strip()
            code = _strip_fences(open_match.group(2).strip())
            raw = raw[:open_match.start()].strip()
            extraction_pass = "pass1b"

    # Pass 2 — <CODE_START> without filename attribute
    if not code:
        code_match2 = _re.search(r'<CODE_START[^>]*>\s*(.*?)\s*</CODE_START>', raw, _re.DOTALL | _re.IGNORECASE)
        if code_match2:
            code = _strip_fences(code_match2.group(1).strip())
            filename = _derive_filename(code)
            raw = (raw[:code_match2.start()] + raw[code_match2.end():]).strip()
            extraction_pass = "pass2"

    # Pass 2b — any CODE_START without closing tag
    if not code:
        open_match2 = _re.search(r'<CODE_START[^>]*>\s*(.*)', raw, _re.DOTALL | _re.IGNORECASE)
        if open_match2 and len(open_match2.group(1).strip()) > 50:
            code = _strip_fences(open_match2.group(1).strip())
            filename = _derive_filename(code)
            raw = raw[:open_match2.start()].strip()
            extraction_pass = "pass2b"

    # Pass 3 — any fenced block (```python, ```py, ``` Python, ``` , etc.)
    if not code:
        fence = _re.search(r'```[a-zA-Z]*[ \t]*\n(.*?)```', raw, _re.DOTALL)
        if fence:
            candidate = fence.group(1).strip()
            # Only treat as trainer code if it looks like Python
            if candidate and ('def ' in candidate or 'class ' in candidate or 'import ' in candidate):
                code = _strip_fences(candidate)
                filename = _derive_filename(code)
                raw = (raw[:fence.start()] + raw[fence.end():]).strip()
                extraction_pass = "pass3"

    # Pass 4 — bare class block (no fences at all) with BaseTrainer
    if not code:
        cls_start = _re.search(r'^(class\s+\w+\s*\(BaseTrainer\))', raw, _re.MULTILINE)
        if cls_start:
            code = raw[cls_start.start():].strip()
            filename = _derive_filename(code)
            raw = raw[:cls_start.start()].strip()
            extraction_pass = "pass4"

    # ── Continuation loop: if code is syntactically incomplete, ask LLM to continue ──
    # Detects truncated output (unexpected EOF, unclosed brackets) and loops up to
    # MAX_CONTINUATIONS times, appending each continuation and deduplicating overlap.
    # After all continuations, runs a final repair pass if still invalid.
    _TRUNCATION_HINTS = frozenset([
        "unexpected eof", "was never closed", "eof while scanning",
        "expected an indented block", "invalid syntax", "unmatched",
    ])
    _REQUIRED_METHODS = frozenset(["train", "predict", "preprocess", "evaluate"])

    def _is_truncated_syntax_error(src: str) -> bool:
        """Return True if src has a SyntaxError that looks like truncation, not a bug."""
        try:
            compile(src, "<gen>", "exec")
            return False
        except SyntaxError as _e:
            msg = str(_e).lower()
            return any(h in msg for h in _TRUNCATION_HINTS)

    def _missing_methods(src: str) -> list:
        """Return list of required BaseTrainer methods absent from the generated code."""
        try:
            tree = ast.parse(src)
        except SyntaxError:
            return list(_REQUIRED_METHODS)
        defined: set = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef):
                bases = [b.id for b in node.bases if isinstance(b, ast.Name)]
                if "BaseTrainer" in bases:
                    for item in ast.walk(node):
                        if isinstance(item, ast.FunctionDef):
                            defined.add(item.name)
        return sorted(_REQUIRED_METHODS - defined)

    def _needs_continuation(src: str) -> tuple[bool, str]:
        """Return (needs_more, reason) — True if code is incomplete."""
        if _is_truncated_syntax_error(src):
            return True, "syntax error (truncated output)"
        missing = _missing_methods(src)
        if missing:
            return True, f"missing methods: {', '.join(missing)}"
        return False, ""

    def _merge_continuation(base: str, cont: str) -> str:
        """Append cont to base, removing any overlapping lines at the join point."""
        base_lines = base.splitlines()
        cont_lines = cont.splitlines()
        # Find the longest suffix of base_lines that is a prefix of cont_lines
        # (overlap up to 10 lines to handle LLM repetition)
        overlap = 0
        for n in range(min(10, len(base_lines), len(cont_lines)), 0, -1):
            if [l.rstrip() for l in base_lines[-n:]] == [l.rstrip() for l in cont_lines[:n]]:
                overlap = n
                break
        merged = base_lines + cont_lines[overlap:]
        return "\n".join(merged)

    def _extract_any_code(text: str) -> Optional[str]:
        """Try all extraction passes on a raw LLM response; return code or None."""
        # TAG with filename
        m = _re.search(r'<CODE_START\s+filename=["\'][^"\']+["\']>\s*(.*?)\s*</CODE_START>',
                       text, _re.DOTALL | _re.IGNORECASE)
        if m: return _strip_fences(m.group(1).strip())
        # TAG without closing
        m = _re.search(r'<CODE_START[^>]*>\s*(.*)', text, _re.DOTALL | _re.IGNORECASE)
        if m and len(m.group(1).strip()) > 20: return _strip_fences(m.group(1).strip())
        # Fenced block
        m = _re.search(r'```[a-zA-Z]*[ \t]*\n(.*?)```', text, _re.DOTALL)
        if m and ('def ' in m.group(1) or 'class ' in m.group(1)):
            return _strip_fences(m.group(1).strip())
        # Bare code (starts with def/class)
        if text.lstrip().startswith(('def ', 'class ', '#', 'from ', 'import ')):
            return text.strip()
        return None

    if code:
        _needs_more, _reason = _needs_continuation(code)
    else:
        _needs_more, _reason = False, ""

    print(f"[ai_chat] extracted={extraction_pass} lines={len(code.splitlines()) if code else 0} needs_cont={_needs_more} reason={_reason!r}", flush=True)

    if code and _needs_more:
        _MAX_CONT = 3
        _cont_base_raw = resp_data["choices"][0]["message"]["content"].strip()

        for _ci in range(_MAX_CONT):
            _needs_more, _reason = _needs_continuation(code)
            if not _needs_more:
                break

            # Tell the LLM exactly what's missing so it targets the gap
            _missing = _missing_methods(code)
            if _missing:
                _cont_ask = (
                    f"The trainer is incomplete — these methods are missing: "
                    f"{', '.join(_missing)}. "
                    "Add ONLY the missing methods (do not repeat code already written). "
                    "Wrap your output in <CODE_START filename=\"continuation\"> ... </CODE_START>."
                )
            else:
                _cont_ask = (
                    "The code was cut off before it was complete. "
                    "Continue from exactly where you stopped — output ONLY the remaining lines "
                    "(do not repeat any code already written). "
                    "Wrap the continuation in <CODE_START filename=\"continuation\"> ... </CODE_START>."
                )

            _cont_messages = list(llm_messages) + [
                {"role": "assistant", "content": _cont_base_raw},
                {"role": "user", "content": _cont_ask},
            ]
            try:
                import httpx as _hx_c
                _cont_req = {**_req_body, "messages": _cont_messages}
                async with _hx_c.AsyncClient(timeout=120) as _hc:
                    _cr = await _hc.post(
                        f"{base_url.rstrip('/')}/chat/completions",
                        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                        json=_cont_req,
                    )
                _cr.raise_for_status()
                _cont_raw = _cr.json()["choices"][0]["message"]["content"].strip()
                _cont_base_raw = _cont_raw
                cont_replies.append(_cont_raw)
                continuation_count += 1

                _cont_code = _extract_any_code(_cont_raw)
                if _cont_code:
                    code = _merge_continuation(code, _cont_code)
                    logger.info("ai_chat_continuation", iteration=_ci + 1, reason=_reason,
                                added_lines=len(_cont_code.splitlines()))
                else:
                    break
            except Exception as _cont_exc:
                logger.warning("ai_chat_continuation_failed", iteration=_ci + 1, error=str(_cont_exc))
                break

        print(f"[ai_chat] continuations={continuation_count} repair={repair_ran} final_lines={len(code.splitlines()) if code else 0} missing={_missing_methods(code) if code else 'N/A'}", flush=True)

        # ── Repair pass: still incomplete after continuations → ask for full rewrite ──
        _needs_more, _reason = _needs_continuation(code)
        if _needs_more:
            try:
                _missing_r = _missing_methods(code)
                _repair_messages = list(llm_messages) + [
                    {"role": "user", "content": (
                        "The generated trainer is still incomplete. "
                        + (f"Missing methods: {', '.join(_missing_r)}. " if _missing_r else "")
                        + "Return the COMPLETE working trainer file from top to bottom. "
                        "Wrap it in <CODE_START filename=\"fixed_trainer.py\"> ... </CODE_START>."
                        f"\n\nCurrent partial code:\n```python\n{code}\n```"
                    )},
                ]
                _rep_req = {**_req_body, "messages": _repair_messages}
                import httpx as _hx_r
                async with _hx_r.AsyncClient(timeout=180) as _hr:
                    _rr = await _hr.post(
                        f"{base_url.rstrip('/')}/chat/completions",
                        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                        json=_rep_req,
                    )
                _rr.raise_for_status()
                _rep_raw = _rr.json()["choices"][0]["message"]["content"].strip()
                _rep_code = _extract_any_code(_rep_raw)
                if _rep_code:
                    code = _rep_code
                    repair_ran = True
                    logger.info("ai_chat_repair_applied")
            except Exception as _rep_exc:
                logger.warning("ai_chat_repair_failed", error=str(_rep_exc))

    # Final cleanup: strip any still-leaked tags from message text
    raw = _re.sub(r'</?CODE_START[^>]*>', '', raw).strip()
    # Strip any remaining markdown fences left in message text
    raw = _re.sub(r'```[a-zA-Z]*[ \t]*\n.*?```', '', raw, flags=_re.DOTALL).strip()

    # ── Extract SUGGESTIONS: line ─────────────────────────────────────────────
    suggestions: list[str] = []
    message_lines: list[str] = []
    for line in raw.splitlines():
        stripped = line.strip()
        if stripped.upper().startswith("SUGGESTIONS:"):
            parts = stripped[len("SUGGESTIONS:"):].split("|")
            suggestions = [p.strip() for p in parts if 2 < len(p.strip()) < 80]
        else:
            message_lines.append(line)

    message_text = "\n".join(message_lines).strip()
    # Remove any residual markdown code fences from message text
    message_text = _re.sub(r'```.*?```', '', message_text, flags=_re.DOTALL).strip()

    # When code was generated, replace the (often verbose) explanation with a short
    # actionable note so the chat stays clean — the code belongs in the editor panel.
    if code:
        _syn_ok = not _is_truncated_syntax_error(code)
        _status = "Trainer ready" if _syn_ok else "Trainer generated (may be incomplete — review carefully)"
        message_text = f"{_status} — check the **Code** tab to review and edit `{filename}`."

    return {
        "message": message_text,
        "code": code,
        "filename": filename,
        "suggestions": suggestions[:4],
        "has_code": code is not None,
        "debug": {
            "tokens": {"input": int(in_tok), "output": int(out_tok), "total": int(in_tok) + int(out_tok)},
            "cost_usd": actual_cost,
            "model": model_name,
            "provider": provider,
            "max_tokens": max_tokens,
            "num_ctx": _num_ctx or None,
            "system_prompt_tokens_est": len(sys_prompt) // 4,
            "extraction_pass": extraction_pass,
            "continuation_count": continuation_count,
            "repair_ran": repair_ran,
            "final_line_count": len(code.splitlines()) if code else 0,
            "missing_methods_final": _missing_methods(code) if code else list(_REQUIRED_METHODS),
            "raw_llm_reply": resp_data["choices"][0]["message"]["content"].strip(),
            "continuation_replies": cont_replies,
        },
    }


# ── Create dataset from CSV upload (AI Workshop helper) ───────────────────────

class CreateDatasetFromCsvRequest(BaseModel):
    name: str
    description: str = ""
    filename: str
    csv_b64: str           # base64-encoded file bytes
    content_type: str = "text/csv"
    session_id: str = ""   # AI Workshop session GUID — used as slug for get-or-create


@router.post("/datasets/from-csv", status_code=201)
async def create_dataset_from_csv(
    body: CreateDatasetFromCsvRequest,
    user=Depends(require_roles("engineer", "admin")),
):
    """
    Get-or-create a dataset for an AI Workshop session and seed it with CSV data.

    If session_id is provided it is used as the dataset slug, so the same dataset
    is reused across multiple uploads within the same workshop session.  Only the
    Original Upload field is refreshed with new data on each call.
    """
    import base64 as _b64
    import io as _io
    import re as _re2
    from fastapi import UploadFile as _UploadFile
    import app.services.dataset_service as _ds_svc
    from app.models.dataset import DatasetProfile as _DatasetProfile

    # Derive slug: prefer session_id (stable across uploads), fall back to name-based
    if body.session_id:
        slug = f"ws-{body.session_id[:36]}"
        slug = _re2.sub(r"[^a-z0-9\-]", "", slug)[:56] or "ai-workshop-data"
    else:
        slug = body.name.lower().replace(" ", "-")
        slug = _re2.sub(r"[^a-z0-9\-]", "", slug)[:48] or "ai-workshop-data"

    # ── Try to find an existing dataset with this slug ────────────────────────
    profile = None
    try:
        existing = await _DatasetProfile.find_one(
            {"org_id": user.org_id, "slug": slug, "deleted_at": None}
        )
        if existing:
            profile = existing
    except Exception:
        pass

    # ── Create if not found ───────────────────────────────────────────────────
    if profile is None:
        dataset_data = {
            "name": body.name,
            "slug": slug,
            "description": body.description or f"Auto-created from AI Workshop: {body.filename}",
            "category": "tabular",
            "fields": [
                {
                    "label": "Original Upload",
                    "instruction": "Upload the original CSV or Excel file as received",
                    "type": "file",
                    "capture_mode": "upload_only",
                    "required": True,
                    "order": 0,
                },
                {
                    "label": "Clean Copy",
                    "instruction": "Upload the cleaned version of the data (after preprocessing / fixing issues)",
                    "type": "file",
                    "capture_mode": "upload_only",
                    "required": False,
                    "order": 1,
                },
                {
                    "label": "Cleaning Code",
                    "instruction": "Python trainer or preprocessing code generated by AI (.py file)",
                    "type": "file",
                    "capture_mode": "upload_only",
                    "required": False,
                    "order": 2,
                },
            ],
            "visibility": "private",
        }
        try:
            profile = await _ds_svc.create_dataset(
                user.org_id, dataset_data, user.email, acting_email=user.email
            )
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Failed to create dataset: {exc}")

    fields_by_label = {f.label: str(f.id) for f in profile.fields}
    original_field_id = fields_by_label.get("Original Upload", str(profile.fields[0].id))
    clean_field_id    = fields_by_label.get("Clean Copy", "")
    code_field_id     = fields_by_label.get("Cleaning Code", "")

    # Seed / refresh Original Upload field with the provided CSV (best-effort)
    try:
        raw_bytes = _b64.b64decode(body.csv_b64)
        file_obj = _io.BytesIO(raw_bytes)
        fake_upload = _UploadFile(
            filename=body.filename,
            file=file_obj,
            headers={"content-type": body.content_type},
        )
        await _ds_svc.upload_entry_direct(
            user.org_id, str(profile.id), original_field_id, fake_upload, None, user.email
        )
    except Exception:
        pass

    return {
        "dataset_id": str(profile.id),
        "dataset_slug": profile.slug,
        "dataset_name": profile.name,
        "field_id": original_field_id,          # kept for backwards compat
        "original_field_id": original_field_id,
        "clean_field_id": clean_field_id,
        "code_field_id": code_field_id,
    }


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
        from app.services.registry_service import list_trainer_classes
        registered = list(list_trainer_classes().keys())
        print(f"[editor] Registered trainers after scan: {{registered or ['(none)']}}", flush=True)
        # Try importing the plugin directly to surface any import error
        try:
            import importlib.util as _ilu
            _spec = _ilu.spec_from_file_location("_probe_plugin", {plugin_path!r})
            _mod = _ilu.module_from_spec(_spec)
            _spec.loader.exec_module(_mod)
            print(f"[editor] Plugin imported OK — classes defined: {{[k for k in dir(_mod) if not k.startswith('_')]}}", flush=True)
        except Exception as _ie:
            print(f"[editor] Plugin import error: {{type(_ie).__name__}}: {{_ie}}", flush=True)
            import traceback as _tb
            _tb.print_exc()
        raise RuntimeError(
            f"Trainer {trainer_name!r} not found after scan. "
            f"Registered: {{registered}}. "
            f"Check that your class sets name = {trainer_name!r} or trainer_name() returns {trainer_name!r}."
        )

    trainer = cls()
    config = TrainingConfig()
{overrides_snippet}
    # Inject org_id so DatasetDataSource can auto-create missing datasets
    from app.abstract.data_source import DatasetDataSource as _DDS
    if isinstance(trainer.data_source, _DDS):
        trainer.data_source.org_id = os.environ.get('ML_ORG_ID') or trainer.data_source.org_id

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


async def _execute_trainer(
    job_id: str,
    trainer_name: str,
    plugin_path: Path,
    overrides: Optional[dict],
    org_id: str = "",
    billing_info: Optional[dict] = None,
) -> None:
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
        plugin_path=str(plugin_path),
    )

    env = {**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONPATH": "/app", "ML_ORG_ID": org_id}

    await emit("log", {"line": f"[editor] Executing {plugin_path.name} directly (no queue)..."})

    start_ts = time.monotonic()
    run_status = "failed"
    run_error: Optional[str] = None
    run_rc = 1

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

        run_rc = await asyncio.wait_for(proc.wait(), timeout=5)
        run_status = "completed" if run_rc == 0 else "failed"
        if run_rc != 0:
            run_error = f"Process exited with code {run_rc}"

    except asyncio.TimeoutError:
        run_status = "failed"
        run_error = "Timeout waiting for process to exit"
    except Exception as exc:
        run_status = "failed"
        run_error = str(exc)
    finally:
        elapsed = time.monotonic() - start_ts

        # ── Billing: release reservation and charge actual cost ────────────────
        charged = 0.0
        is_free = True
        if billing_info and not billing_info.get("is_free", True):
            is_free = False
            try:
                from app.services import wallet_service
                wallet = await wallet_service.get_or_create(
                    billing_info["user_email"], billing_info["org_id"]
                )
                actual_cost = round(billing_info["price_per_hour"] * (elapsed / 3600), 10)
                charged = await wallet_service.release_and_charge(wallet, job_id, actual_cost)
            except Exception as _bill_exc:
                # Billing failure must not break the run result
                await emit("log", {"line": f"[billing] Warning: charge failed — {_bill_exc}"})

        await emit("billing", {
            "is_free": is_free,
            "charged": charged,
            "elapsed_seconds": round(elapsed, 3),
            "price_per_hour": billing_info.get("price_per_hour", 0.0) if billing_info else 0.0,
        })

        await emit("done", {
            "status": run_status,
            "exit_code": run_rc,
            "metrics": {},
            "error": run_error,
        })

        await queue.put(None)   # sentinel — generator knows to stop
        # NOTE: do NOT pop here; SSE generator owns the queue lifecycle


@router.post("/run")
async def run_trainer(body: RunRequest, user=Depends(require_roles("engineer", "admin"))):
    """
    1. Security-scan the code
    2. Billing check — reserve funds if not on free tier; 402 if insufficient
    3. Save the file to the plugin dir
    4. Spawn an asyncio background task that runs the trainer directly (no Celery)
    5. Return {job_id} — client opens SSE stream on /editor/run/{job_id}/stream
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

    # ── Billing check ─────────────────────────────────────────────────────────
    # Editor runs are local compute — same billing rules as /training/start local.
    # We use a conservative 30-min estimate with a 1.5× buffer for reservation.
    job_id = str(uuid.uuid4())   # generate early so billing tx references it

    billing_info: dict = {"is_free": True, "price_per_hour": 0.0, "user_email": user.email, "org_id": user.org_id or ""}

    try:
        from app.services import wallet_service, ml_billing_service
        is_free, _, local_price = await ml_billing_service.check_local_training(user.email, user.org_id or "")
        if not is_free:
            est_mins = 30   # conservative estimate for editor runs
            reservation = round(local_price * (est_mins / 60) * 1.5, 2)
            wallet = await wallet_service.get_or_create(user.email, user.org_id or "")
            if wallet_service.available(wallet) < reservation:
                raise HTTPException(
                    status_code=402,
                    detail=(
                        f"Insufficient balance for compute. Need ${reservation:.2f} USD reserved, "
                        f"available ${wallet_service.available(wallet):.2f} USD. "
                        "Top up your wallet to run code."
                    ),
                )
            await wallet_service.reserve(
                wallet, reservation, job_id,
                f"Editor run reservation — {body.trainer_name} · ${local_price:.4f}/hr",
                compute_type="local",
            )
            billing_info.update({"is_free": False, "price_per_hour": local_price, "reservation": reservation})
    except HTTPException:
        raise
    except Exception:
        pass   # billing service unavailable — allow run to proceed (safe fallback)

    # Save file
    full = _safe_path(body.path)
    full.parent.mkdir(parents=True, exist_ok=True)
    async with aiofiles.open(full, "w") as f:
        await f.write(body.content)

    # Register job queue
    queue: asyncio.Queue = asyncio.Queue(maxsize=10_000)
    _RUN_QUEUES[job_id] = queue

    # Fire background task
    asyncio.create_task(
        _execute_trainer(job_id, body.trainer_name, full, body.config_overrides,
                         org_id=user.org_id or "", billing_info=billing_info)
    )

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
