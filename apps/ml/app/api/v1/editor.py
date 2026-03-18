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
    def train(self, preprocessed, config: TrainingConfig):  ...  # return model or (model, test_data)
    def predict(self, model, inputs: dict) -> dict:  ...  # return JSON-serialisable dict
    def evaluate(self, model, test_data) -> EvaluationResult:  ...  # optional
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
- Class name must be PascalCase; name attribute must be snake_case.
- All S3 writes go to /tmp/. Never write outside /tmp in trainer code.
- Imports inside methods (not module-level) for optional heavy deps (torch, sklearn, etc.).
- Docstring at top of file: explain what the trainer does, dataset format, inference I/O.
- input_schema and output_schema MUST be defined for the UI to render forms correctly.
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
      LLM_MAX_TOKENS   — max response tokens                (default: 1024 for generate, 6000 for chat)
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
    max_tokens  = int(os.environ.get("LLM_MAX_TOKENS", "4096"))

    try:
        import httpx
        async with httpx.AsyncClient(timeout=120) as http:
            resp = await http.post(
                f"{base_url.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": model_name,
                    "messages": [
                        {"role": "system", "content": _TRAINER_SYSTEM_PROMPT},
                        {"role": "user",   "content": user_prompt},
                    ],
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                },
            )
        resp.raise_for_status()
        data = resp.json()
        code = data["choices"][0]["message"]["content"].strip()

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

        return {"code": code, "model": model_name, "tokens": {"input": in_tok, "output": out_tok}, "cost_usd": actual_cost}

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

━━ SCOPE EVALUATION (always assess this) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Before diving into requirements, mentally assess:

1. CAN A TRAINER BE BUILT FOR THIS?
   → Identify the model type: classification / regression / clustering / anomaly /
     NLP / image / time-series / custom
   → Identify what the model should return per inference: the output fields and their types
   → If feasible — say so briefly and proceed
   → If not feasible (e.g. user asks for real-time video processing, live audio, web scraping) —
     explain why it's outside a trainer's scope and suggest what IS possible

2. SCOPE WARNING for complex projects:
   If the request involves: large image datasets (zip of images, segmentation, detection, OCR,
   plate recognition), video frames, real-time streams, multi-modal data, or highly custom
   architectures:
   → Acknowledge upfront: "This is a larger-scope project. I can build a working trainer, but
     production-quality results for [task] typically require significant data, GPU resources,
     and hyperparameter tuning. Results should be validated by a domain expert."
   → Then proceed — build the best trainer possible given the constraints.

3. DEFAULT DEFENSE MECHANISM (non-negotiable):
   Every trainer you generate MUST begin with this comment block:
   # ⚠ AI-GENERATED TRAINER
   # Review by a qualified data scientist or ML engineer before production use.
   # Validate output quality on your specific dataset. For complex tasks
   # (image segmentation, object detection, NLP at scale), expert review is essential.

━━ FIRST RESPONSE RULES (critical) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Check what data context you have BEFORE asking any technical questions:

CASE A — No CSV uploaded AND no dataset selected:
  → DO NOT ask about column names. You don't know what data they have yet.
  → Acknowledge the idea warmly (1 sentence), briefly state what model type would suit it
    and what outputs it would produce, then say:
    "To get started, could you either:
     • Upload a CSV or Excel file using the Upload Data button below, or
     • Describe your data — what fields/columns you typically have and roughly how many rows?"
  → Nothing else. One clear ask.

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

_CHAT_CODE_INSTRUCTIONS = """
When generating the trainer, follow these rules precisely:

OUTPUT SCHEMA — always include derived metrics relevant to the task:
  - classification: {"label": {"type": "str"}, "confidence": {"type": "float"}, "probabilities": {"type": "dict"}}
  - clustering: {"segment": {"type": "int"}, "segment_label": {"type": "str"}, "distance_to_center": {"type": "float"}}
  - regression: {"prediction": {"type": "float"}, "confidence_interval": {"type": "dict"}}
  - anomaly: {"is_anomaly": {"type": "bool"}, "anomaly_score": {"type": "float"}, "reason": {"type": "str"}}

DATA LOADING — CRITICAL (read carefully):
  ALL data loading goes through DatasetDataSource. NEVER hard-code file paths.

  THE THREE FIELD LABELS ARE ALWAYS AND ONLY:
    "Original Upload"  — the raw file the user uploaded
    "Clean Copy"       — cleaned version (may be absent)
    "Cleaning Code"    — preprocessing script (file, may be absent)

  NEVER use field labels derived from the user's description of their data.
  Even if the user says "I have transaction data and customer profiles",
  the ACTUAL field labels in the workshop dataset are always exactly the three above.
  The user's data is stored INSIDE the uploaded file — it is not split into separate fields.

  ❌ WRONG (do not generate this — ever):
    trans_data   = [e for e in raw if e.get('field_label') == 'Transaction Data' ...]
    profile_data = [e for e in raw if e.get('field_label') == 'Customer Profile Data' ...]
    sales        = [e for e in raw if e.get('field_label') == 'Sales CSV' ...]

  ✅ CORRECT (copy this exactly — field_label is always one of the three workshop labels):
    clean = [e for e in raw if e.get('field_label') == 'Clean Copy' and (e.get('file_key') or e.get('file_url'))]
    orig  = [e for e in raw if e.get('field_label') == 'Original Upload' and (e.get('file_key') or e.get('file_url'))]
    all_f = [e for e in raw if e.get('field_type') == 'file' and (e.get('file_key') or e.get('file_url'))]
    entry = clean or orig or all_f

  data_source MUST always be DatasetDataSource with these three fields:
    fields=[
      {"label": "Original Upload", "type": "file", "required": True},
      {"label": "Clean Copy",      "type": "file", "required": False},
      {"label": "Cleaning Code",   "type": "file", "required": False},
    ]

  CRITICAL: preprocess(self, raw) receives a LIST OF DICTS (not a dict).
  Each dict has keys: field_label, field_type, file_url, file_key, text_value, etc.
  file_url is a presigned S3 URL; file_key is the raw S3 object key.

  ALWAYS use self._fetch_bytes(file_key, file_url) — a method on BaseTrainer that
  reads directly from S3 (reliable) and falls back to the presigned URL automatically.
  Do NOT define your own _fetch_bytes — it is already available on self.

  CORRECT pattern — copy this exactly:
    import io
    clean = [e for e in raw if e.get('field_label') == 'Clean Copy' and (e.get('file_key') or e.get('file_url'))]
    orig  = [e for e in raw if e.get('field_label') == 'Original Upload' and (e.get('file_key') or e.get('file_url'))]
    all_f = [e for e in raw if e.get('field_type') == 'file' and (e.get('file_key') or e.get('file_url'))]
    entry = clean or orig or all_f
    if not entry:
        raise ValueError("No file data in dataset — upload a CSV via the Datasets page.")
    e = entry[-1]
    content = self._fetch_bytes(e.get('file_key'), e.get('file_url'))
    if content is None:
        raise ValueError("Could not fetch file from storage.")
    fname = (e.get('file_key') or '').split('/')[-1].lower()
    if fname.endswith(('.xlsx', '.xls')):
        df = pd.read_excel(io.BytesIO(content))
    else:
        try:
            df = pd.read_csv(io.BytesIO(content))
        except Exception:
            df = pd.read_csv(io.BytesIO(content), on_bad_lines='skip', engine='python')

  CSV READ RULE — ALWAYS use the try/except fallback above. NEVER use a bare read_csv:
    ❌ WRONG — crashes on CSVs with unquoted commas or extra fields:
        df = pd.read_csv(io.BytesIO(content))

    ✅ CORRECT — always copy this exact pattern:
        try:
            df = pd.read_csv(io.BytesIO(content))
        except Exception:
            df = pd.read_csv(io.BytesIO(content), on_bad_lines='skip', engine='python')

  This applies to EVERY pd.read_csv call in preprocess() — no exceptions.
  Real-world CSVs frequently have unquoted commas in fields (e.g. addresses, descriptions)
  that cause "Expected N fields, saw N+1" ParserError with the default C engine.

  If UPLOADED DATASET slug is provided in CONTEXT use that slug exactly.

  FORBIDDEN:
    - field labels other than "Original Upload", "Clean Copy", "Cleaning Code" in preprocess()
    - raw.get('clean_copy'), raw['original_upload'], raw.get('data_file')
    - pd.read_excel('/any/path'), pd.read_csv('/any/path'), open('/any/path')
    - bare pd.read_csv(buf) without the try/except fallback shown above
  raw is a LIST — it has no .get() method. Always iterate with a list comprehension.

DATASET MERGING — when multiple sources must be merged on a unique key:
  preprocess() should: load all sources → merge on unique_id → feature engineer → return DataFrame

PREDICT() — CRITICAL (read carefully):
  predict(self, model, inputs) is called at INFERENCE TIME on a FRESH trainer instance.
  Anything stored on self during preprocess() or train() is GONE.

  NEVER store fitted transformers on self and use them in predict():
    ❌ WRONG — self.scaler lost at inference time:
        def preprocess(self, raw):
            self.scaler = StandardScaler()
            X_scaled = self.scaler.fit_transform(X)
            ...
        def predict(self, model, inputs):
            scaled = self.scaler.transform(...)   # AttributeError at runtime!

  TWO CORRECT PATTERNS — pick one:

  OPTION A — sklearn Pipeline (recommended for supervised tabular models):
    Put scaler, encoder, imputer as Pipeline steps so they are saved and loaded
    automatically as part of the model artifact. auto_train_tabular() already
    returns a Pipeline — scaler is always bundled when you use it.

    ✅ CORRECT (manual Pipeline):
        from sklearn.pipeline import Pipeline
        from sklearn.preprocessing import StandardScaler
        from sklearn.ensemble import RandomForestClassifier

        def train(self, preprocessed, config):
            pipeline = Pipeline([
                ('scaler', StandardScaler()),
                ('clf',    RandomForestClassifier(n_estimators=200, random_state=config.random_seed)),
            ])
            pipeline.fit(X_train, y_train)
            return pipeline                    # scaler saved inside MLflow artifact

        def predict(self, model, inputs):
            import pandas as pd
            row = pd.DataFrame([[inputs['f1'], inputs['f2']]], columns=['f1', 'f2'])
            pred = model.predict(row)[0]       # Pipeline scales + predicts automatically
            return {"label": str(pred)}

  OPTION B — TrainerBundle (required for unsupervised models or multi-artifact cases):
    from app.abstract.base_trainer import TrainerBundle

    ✅ CORRECT (KMeans example — Pipeline is awkward for unsupervised):
        def train(self, preprocessed, config):
            from sklearn.preprocessing import StandardScaler
            from sklearn.cluster import KMeans

            scaler = StandardScaler()
            X_scaled = scaler.fit_transform(X)
            kmeans = KMeans(n_clusters=4, random_state=config.random_seed)
            kmeans.fit(X_scaled)

            return TrainerBundle(
                model=kmeans,
                scaler=scaler,
                feature_names=list(df.columns),
                label_map={0: "Low Value", 1: "Mid Value", 2: "High Value", 3: "VIP"},
            )

        def predict(self, model: TrainerBundle, inputs: dict) -> dict:
            import pandas as pd
            row = pd.DataFrame([[inputs[f] for f in model.feature_names]],
                               columns=model.feature_names)
            X_scaled = model.scaler.transform(row)
            cluster   = int(model.model.predict(X_scaled)[0])
            label     = model.label_map.get(cluster, str(cluster))
            return {"segment": cluster, "segment_label": label}

  FILE INPUTS (base64) — when input_schema has a "file" type field, the value
  in inputs[key] is BASE64-ENCODED bytes (the caller uploaded a CSV/image).
  ALWAYS decode it before use:

    ✅ CORRECT pattern for a CSV file input:
        def predict(self, model, inputs):
            import base64, io, pandas as pd
            csv_bytes = base64.b64decode(inputs['transaction_data'])
            df = pd.read_csv(io.StringIO(csv_bytes.decode('utf-8')))
            preds = model.predict(df[self.get_feature_names()])
            return {"predictions": preds.tolist(), "count": len(preds)}

  SCALERS THAT APPLY TO ALL CASES:
    - StandardScaler   → use when feature magnitudes differ (most tabular data)
    - MinMaxScaler     → use when output must be 0–1 range
    - RobustScaler     → use when data has significant outliers
    - No scaler        → tree-based models (RF, GBM, XGB) do NOT need a scaler;
                         auto_train_tabular() only applies StandardScaler to features
                         alongside ordinal encoding for categoricals inside the Pipeline

TEMPLATE CONTRACT:
""" + _TRAINER_SYSTEM_PROMPT


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
    est_out  = int(os.environ.get("LLM_MAX_TOKENS", "6000"))
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
            f"    import io\n"
            f"    clean = [e for e in raw if e.get('field_label') == 'Clean Copy' and (e.get('file_key') or e.get('file_url'))]\n"
            f"    orig  = [e for e in raw if e.get('field_label') == 'Original Upload' and (e.get('file_key') or e.get('file_url'))]\n"
            f"    entry = clean or orig\n"
            f"    if not entry: raise ValueError('No data in dataset — upload a CSV via the Datasets page.')\n"
            f"    e = entry[-1]\n"
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
    max_tokens  = int(os.environ.get("LLM_MAX_TOKENS", "6000"))

    try:
        import httpx
        async with httpx.AsyncClient(timeout=180) as http:
            resp = await http.post(
                f"{base_url.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": model_name,
                    "messages": llm_messages,
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                },
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

    # Pass 2 — <CODE_START> without filename attribute
    if not code:
        code_match2 = _re.search(r'<CODE_START[^>]*>\s*(.*?)\s*</CODE_START>', raw, _re.DOTALL | _re.IGNORECASE)
        if code_match2:
            code = _strip_fences(code_match2.group(1).strip())
            filename = _derive_filename(code)
            raw = (raw[:code_match2.start()] + raw[code_match2.end():]).strip()

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

    # Pass 4 — bare class block (no fences at all) with BaseTrainer
    if not code:
        cls_start = _re.search(r'^(class\s+\w+\s*\(BaseTrainer\))', raw, _re.MULTILINE)
        if cls_start:
            code = raw[cls_start.start():].strip()
            filename = _derive_filename(code)
            raw = raw[:cls_start.start()].strip()

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
        message_text = f"Trainer ready — check the **Code** tab to review and edit `{filename}`."

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
        raise RuntimeError(f"Trainer {trainer_name!r} not found after scan — check name attribute")

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
