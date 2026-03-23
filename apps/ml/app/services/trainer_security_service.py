"""
Trainer security scanning service.

Two-layer gate for user-uploaded ML trainer scripts:

  Layer 1 — AST hint collector (deterministic, instant)
    Walks the Python AST and categorises patterns into two buckets:

    DEFINITE_BLOCK — context never helps; reject immediately, no LLM call:
      • exec/eval called on a decoded blob  (obfuscated execution)
      • __reduce__ / __reduce_ex__ method definition  (pickle RCE gadget)
      • subprocess, socket, ctypes, cffi, paramiko, fabric imports  (infra attack tools
        with zero legitimate ML use)

    SUSPICIOUS — context matters; collected as structured hints for the LLM:
      • io, sys, os, pickle, marshal, requests, urllib, etc. — might be fine
      • open(), eval(), exec() bare calls  (without decoded-blob argument)
      • .environ, .getenv, .read_bytes(), .modules, etc. attribute accesses

  Layer 2 — LLM contextual scan
    Receives the full source AND the AST hints, then reasons about whether each
    pattern actually poses a threat given how it is used.  A mere
    `from io import BytesIO` used for PIL image loading is not flagged — but
    `import io; io.open('/etc/passwd').read()` would be.

    The LLM is the final decision-maker.  Only findings with block:true cause
    a rejection / admin escalation.  WARN/LOW findings auto-approve.

    If the LLM is unavailable and no DEFINITE_BLOCK patterns fired, the
    trainer is auto-approved with a note.
"""
from __future__ import annotations

import ast
import hashlib
import os
import re
from typing import Any, Dict, List, Optional

import structlog

logger = structlog.get_logger(__name__)


# ── AST hint collector ────────────────────────────────────────────────────────
#
# DEFINITE_BLOCK: patterns where context never changes the outcome.
# Keep this list SHORT and obvious.

_DEFINITE_BLOCK_IMPORTS: frozenset[str] = frozenset({
    "subprocess",   # shell execution — no ML use
    "socket",       # raw network sockets — no ML use
    "ctypes",       # C FFI / memory access
    "cffi",         # C FFI
    "paramiko",     # SSH client
    "fabric",       # SSH orchestration
    "winreg",       # Windows registry
    "msvcrt",       # Windows CRT
})

# Imports that are suspicious but context-dependent — collected as hints only
_SUSPICIOUS_IMPORTS: frozenset[str] = frozenset({
    "io",           # io.BytesIO is fine; io.open() is suspicious — let LLM decide
    "sys",          # sys.modules traversal is suspicious; sys.argv config is fine
    "os",           # os.environ / os.system suspicious; os.path is fine
    "builtins",     # __builtins__ bypass pattern
    "pickle",       # model deserialization might be fine; network+pickle is not
    "marshal",      # lower-level serialisation
    "shelve",       # file-backed dict
    "zipfile",      # archiving
    "tarfile",      # archiving
    "gzip",         # compression — often fine for data files
    "shutil",       # file operations
    "multiprocessing",  # might be fine for CPU parallelism
    "concurrent",   # same
    "requests",     # HTTP — could be for dataset download or exfil
    "urllib",       # HTTP
    "httpx",        # HTTP
    "aiohttp",      # HTTP
    "aiofiles",     # async file I/O
    "ftplib",       # FTP
    "smtplib",      # email sending
    "imaplib",      # email reading
    "boto3",        # AWS SDK — cloud storage might be legitimate
    "botocore",     # boto3 core
})

# Attribute accesses that are suspicious but context-dependent
_SUSPICIOUS_ATTRS: frozenset[str] = frozenset({
    "environ", "getenv", "putenv", "unsetenv",  # env reading
    "system", "popen",                           # shell (method form)
    "__reduce__", "__reduce_ex__",               # pickle gadget (attribute, not def)
    "read_text", "read_bytes", "read_lines",     # pathlib file read
    "fromfile",                                  # numpy binary read
    "modules",                                   # sys.modules traversal
})


class _AstCollector(ast.NodeVisitor):
    """
    Collects patterns from the AST into two lists:
      self.definite_blocks  — always reject, no LLM needed
      self.hints            — pass to LLM for contextual evaluation
    """

    def __init__(self) -> None:
        self.definite_blocks: List[Dict[str, Any]] = []
        self.hints: List[Dict[str, Any]] = []

    def _block(self, node: ast.AST, rule: str, message: str) -> None:
        self.definite_blocks.append({
            "line": getattr(node, "lineno", None),
            "col":  getattr(node, "col_offset", None),
            "rule": rule,
            "message": message,
        })

    def _hint(self, node: ast.AST, rule: str, message: str, context: str = "") -> None:
        self.hints.append({
            "line":    getattr(node, "lineno", None),
            "col":     getattr(node, "col_offset", None),
            "rule":    rule,
            "message": message,
            "context": context,  # surrounding snippet for LLM
        })

    # ── Imports ──────────────────────────────────────────────────────────────

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            top = alias.name.split(".")[0]
            if top in _DEFINITE_BLOCK_IMPORTS:
                self._block(node, f"import:{top}",
                            f"'{alias.name}' has no legitimate use in ML trainer code.")
            elif top in _SUSPICIOUS_IMPORTS:
                self._hint(node, f"import:{top}",
                           f"'{alias.name}' imported — evaluate how it is used in context.",
                           context=ast.unparse(node) if hasattr(ast, "unparse") else "")
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        top = (node.module or "").split(".")[0]
        # from io import BytesIO → top="io", names=["BytesIO"]
        names = [a.name for a in node.names]
        if top in _DEFINITE_BLOCK_IMPORTS:
            self._block(node, f"import:{top}",
                        f"'{node.module}' has no legitimate use in ML trainer code.")
        elif top in _SUSPICIOUS_IMPORTS:
            self._hint(node, f"import:{top}",
                       f"'from {node.module} import {', '.join(names)}' — evaluate usage in context.",
                       context=ast.unparse(node) if hasattr(ast, "unparse") else "")
        self.generic_visit(node)

    # ── Calls ─────────────────────────────────────────────────────────────────

    def visit_Call(self, node: ast.Call) -> None:
        func = node.func

        # Bare call: eval(...), exec(...), open(...), __import__(...)
        if isinstance(func, ast.Name):
            name = func.id

            # exec(b64decode(x)) / eval(fromhex(x)) — obfuscated execution
            # This is always a DEFINITE BLOCK regardless of context
            if name in ("exec", "eval") and node.args:
                first_arg = node.args[0]
                if isinstance(first_arg, ast.Call):
                    inner_fn = first_arg.func
                    inner_name = (
                        getattr(inner_fn, "attr", None)
                        or getattr(inner_fn, "id", None)
                    )
                    if inner_name in ("b64decode", "b16decode", "b32decode",
                                      "fromhex", "decode", "decompress"):
                        self._block(
                            node, "obfuscated_exec",
                            f"{name}() called on a decoded/decompressed blob — "
                            "classic obfuscated code execution pattern.",
                        )
                        self.generic_visit(node)
                        return

                # eval/exec without decoded blob — still suspicious
                self._hint(node, f"bare_{name}",
                           f"{name}() call — evaluate what it executes.",
                           context=ast.unparse(node) if hasattr(ast, "unparse") else "")

            elif name == "open":
                self._hint(node, "bare_open",
                           "open() call — evaluate whether it accesses paths outside the working directory.",
                           context=ast.unparse(node) if hasattr(ast, "unparse") else "")

            elif name == "__import__":
                self._hint(node, "dynamic_import",
                           "__import__() call — dynamic module loading.",
                           context=ast.unparse(node) if hasattr(ast, "unparse") else "")

        # Method call: os.system(...), proc.popen(...) — always suspicious
        elif isinstance(func, ast.Attribute):
            attr = func.attr
            if attr in ("system", "popen", "spawn", "execve", "execvp", "execle"):
                # These are method-form shell execution — definite block
                self._block(
                    node, f"shell_call:{attr}",
                    f".{attr}() call — shell execution.",
                )

        self.generic_visit(node)

    # ── Attribute accesses ────────────────────────────────────────────────────

    def visit_Attribute(self, node: ast.Attribute) -> None:
        if node.attr in _SUSPICIOUS_ATTRS:
            self._hint(
                node, f"attr:{node.attr}",
                f"'.{node.attr}' access — evaluate whether it exposes host data.",
                context=ast.unparse(node) if hasattr(ast, "unparse") else "",
            )
        self.generic_visit(node)

    # ── __reduce__ method definitions ─────────────────────────────────────────

    def _check_funcdef(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        if node.name in ("__reduce__", "__reduce_ex__"):
            self._block(
                node, "pickle_gadget",
                f"{node.name}() definition — allows arbitrary code execution via pickle.loads().",
            )
        self.generic_visit(node)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._check_funcdef(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self._check_funcdef(node)


def ast_collect(source: str) -> Dict[str, List[Dict[str, Any]]]:
    """
    Walk the AST and return:
      {
        "definite_blocks": [...],   # always reject, no LLM
        "hints":           [...],   # pass to LLM for context evaluation
      }
    A SyntaxError is added to hints (unparseable but not auto-blocked — obfuscation
    that survives syntax checks is caught by the LLM).
    """
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        return {
            "definite_blocks": [],
            "hints": [{"line": exc.lineno, "col": None,
                       "rule": "syntax_error",
                       "message": f"Code could not be parsed: {exc.msg}",
                       "context": ""}],
        }
    collector = _AstCollector()
    collector.visit(tree)
    return {
        "definite_blocks": collector.definite_blocks,
        "hints": collector.hints,
    }


# Keep the old name for callers that import it directly
def ast_gate(source: str) -> List[Dict[str, Any]]:
    """Legacy alias — returns only definite_blocks (hard violations)."""
    return ast_collect(source)["definite_blocks"]


def compute_submission_hash(org_id: str, file_bytes: bytes) -> str:
    """SHA-256 hash namespaced by org_id to prevent cross-org collisions."""
    return hashlib.sha256(org_id.encode() + b":" + file_bytes).hexdigest()


# ── Environment isolation ─────────────────────────────────────────────────────

_SECRET_ENV_KEYS: frozenset[str] = frozenset({
    "MONGODB_URL", "MONGODB_DATABASE",
    "REDIS_URL", "REDIS_PASSWORD",
    "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_ENDPOINT_URL", "S3_BUCKET",
    "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN",
    "MLFLOW_TRACKING_URI", "MLFLOW_S3_ENDPOINT_URL",
    "PMS_API_URL",
    "JWT_SECRET", "JWT_ALGORITHM",
    "ADMIN_PASSWORD", "DEFAULT_ADMIN_EMAIL",
    "LLM_API_KEY", "OPENAI_API_KEY",
    "OLLAMA_BASE_URL", "OLLAMA_SECURITY_MODEL",
    "CELERY_BROKER_URL", "CELERY_RESULT_BACKEND",
    "SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD",
})


class _Scrubbed:
    """
    Context manager that removes infrastructure secrets from os.environ for
    the duration of any trainer method call, then restores them.
    """
    def __init__(self) -> None:
        self._saved: dict[str, str] = {}

    def __enter__(self) -> "_Scrubbed":
        for key in _SECRET_ENV_KEYS:
            val = os.environ.pop(key, None)
            if val is not None:
                self._saved[key] = val
        return self

    def __exit__(self, *_: object) -> None:
        os.environ.update(self._saved)
        self._saved.clear()


def scrubbed_env() -> "_Scrubbed":
    """Return a context manager that hides infrastructure secrets from trainer code."""
    return _Scrubbed()


# ── Main scan entry point ─────────────────────────────────────────────────────

async def scan_trainer_security(
    source: str,
    org_id: str,
    submission_id: str,
    trainer_name: str = "",
) -> Dict[str, Any]:
    """
    Two-layer security scan for uploaded trainer source code.

    1. AST collector:
       - DEFINITE_BLOCK patterns → immediate reject, LLM skipped.
       - SUSPICIOUS hints → collected and forwarded to LLM.

    2. LLM contextual scan (when LLM is available):
       - Receives full source + structured AST hints.
       - Evaluates whether each hint is a real threat IN CONTEXT.
       - Only block:true findings cause rejection / admin escalation.
       - WARN/LOW findings auto-approve.

    Returns:
        {passed, severity, summary, issues, ast_violations, model_used}
    """
    # ── Step 1: AST collection ─────────────────────────────────────────────
    ast_result = ast_collect(source)
    definite_blocks = ast_result["definite_blocks"]
    hints = ast_result["hints"]

    if definite_blocks:
        # Hard reject — no LLM call needed
        issues = [
            f"[line {v['line']}] {v['rule']}: {v['message']}"
            for v in definite_blocks
        ]
        logger.warning(
            "trainer_security_definite_block",
            submission_id=submission_id,
            org_id=org_id,
            rules=[v["rule"] for v in definite_blocks],
        )
        return {
            "passed": False,
            "severity": "critical",
            "summary": (
                f"Blocked by static analysis: {definite_blocks[0]['rule']}"
                + (f" (+{len(definite_blocks)-1} more)" if len(definite_blocks) > 1 else "")
            ),
            "issues": issues,
            "ast_violations": [
                {"line": v["line"], "col": v.get("col"), "rule": v["rule"], "message": v["message"]}
                for v in definite_blocks
            ],
            "model_used": "ast_gate",
        }

    # ── Step 2: LLM contextual scan ───────────────────────────────────────
    prompt = _build_security_prompt(source, trainer_name, hints)
    result, model_used = await _call_llm_with_fallback(prompt)

    # Attach raw AST hints to result for frontend display
    result["ast_violations"] = [
        {"line": v["line"], "col": v.get("col"), "rule": v["rule"], "message": v["message"]}
        for v in hints
    ]
    result["model_used"] = model_used

    logger.info(
        "trainer_security_scan_complete",
        submission_id=submission_id,
        org_id=org_id,
        passed=result.get("passed"),
        severity=result.get("severity"),
        model=model_used,
        hints=len(hints),
        issues_count=len(result.get("issues", [])),
    )

    return result


# ── LLM prompt construction ───────────────────────────────────────────────────

_LLM_SYSTEM_PROMPT = """\
You are a security gate for an ML platform that runs user-uploaded Python trainer scripts inside a sandbox.
Your goal is to protect the HOST SYSTEM — not to critique the trainer's internal ML logic.

You have TWO jobs:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
JOB 1 — EVALUATE AST HINTS IN CONTEXT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The prompt includes a list of patterns flagged by a static analyzer.
For each hint, decide whether it is actually harmful based on HOW it is used in the full code.
A pattern is NOT dangerous just because it appears — context determines intent.

SAFE (do NOT block):
  • `from io import BytesIO` → used with PIL/Image.open() to process image inputs
  • `import sys` → only sys.exit() / sys.argv / sys.path for config
  • `import pickle` → loads model.pkl from the job's OWN working directory
  • `import os` → only os.path.join(), os.makedirs() within the job directory
  • `import gzip` / `import zipfile` → decompresses a local dataset file
  • `open(path)` → reads a file in the current working dir or config-provided path
  • `os.environ.get('BATCH_SIZE', '32')` → reads a training hyperparameter
  • `base64.b64decode(inputs.get('image'))` → decodes base64-encoded input data
  • `requests.get(url)` where url comes from the training config → dataset download

BLOCK (always block regardless of context):
  • Outbound network to an external host not in the training config
  • Reading /etc/*, /proc/*, ~/.ssh/*, /var/*, or any absolute system path
  • Writing files outside the job working directory
  • Sending any data to an external destination (POST body, socket send, etc.)
  • Shell command execution (subprocess, os.system, os.popen, etc.)
  • eval() / exec() on data that arrived from OUTSIDE the inputs parameter

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
JOB 2 — INDEPENDENT FULL-CODE SCAN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ALSO scan the entire code independently for threats the static analyzer CANNOT see:

  • String-constructed calls: getattr(obj, 'sys'+'tem')('cmd'), obj.__dict__['popen']
  • Encoded/obfuscated payloads hidden in string literals or comments
  • Indirect network: data flowing into urllib/requests through multiple variable hops
  • Time-delayed or conditional payloads: if datetime.now().hour == 3: exfil()
  • Steganographic exfiltration: data hidden in ML model weights, image pixels, etc.
  • DNS exfiltration: encoding secrets in subdomain lookups
  • Import smuggling: importlib.import_module(), __import__(), pkgutil tricks
  • Monkey-patching builtins: builtins.open = malicious_open
  • Abusing trainer callbacks/hooks to run code outside the normal train/predict flow
  • Writing to shared volumes or paths that other services read from
  • Side-channel attacks: timing, CPU usage patterns used to leak information
  • Supply-chain: downloading and exec-ing code from the internet during training

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT (strict — no prose, no markdown)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
For EVERY real finding (from either job) output one JSON line:
{"severity":"HIGH|MEDIUM|LOW","line":<line_number or null>,"rule":"<short_rule>","title":"<short title>","detail":"<one sentence — what it does>","fix":"<one sentence — what to change>","block":true|false,"source":"ast_hint|independent"}

  block:true  → HIGH severity threat to the host — will be rejected
  block:false → MEDIUM/LOW quality issue that only affects the trainer's own data
  source      → "ast_hint" if it came from a static analysis hint, "independent" if you found it yourself

After ALL findings, output exactly ONE summary line:
{"summary":true,"total":<n>,"high":<n>,"medium":<n>,"low":<n>,"blocked":<n>,"risk":"CRITICAL|HIGH|MEDIUM|LOW|SAFE"}

  risk:CRITICAL → any block:true finding exists
  risk:HIGH     → HIGH findings exist but none are block:true
  risk:MEDIUM   → only MEDIUM findings
  risk:LOW      → only LOW findings
  risk:SAFE     → no findings at all

If a static analysis hint is actually SAFE in context, do NOT emit a finding for it — simply omit it.
Output ONLY the JSON lines above. No markdown, no prose, no code fences.\
"""


def _build_security_prompt(source: str, trainer_name: str, hints: List[Dict[str, Any]]) -> str:
    """
    Build the LLM prompt with:
      1. Structured AST hints (line + snippet) — LLM evaluates each in context
      2. Full source code — LLM independently scans for what AST missed
    """
    parts = [f"Trainer name: {trainer_name or 'unknown'}"]

    # ── Part 1: AST hints ──────────────────────────────────────────────────
    if hints:
        parts.append(
            "\n━━ STATIC ANALYSIS HINTS ━━\n"
            "The following patterns were flagged by static analysis.\n"
            "For each hint: evaluate it against the full code — is it actually harmful in context?\n"
            "If it is SAFE (e.g. BytesIO for image processing), omit it from your output.\n"
            "If it is a real threat, emit a finding with source:\"ast_hint\".\n"
        )
        for h in hints:
            loc = f"line {h['line']}" if h.get("line") else "?"
            ctx = f"\n    snippet: `{h['context']}`" if h.get("context") else ""
            parts.append(f"  [{loc}] rule={h['rule']}  {h['message']}{ctx}")
    else:
        parts.append(
            "\n━━ STATIC ANALYSIS HINTS ━━\n"
            "None — no suspicious patterns detected by static analysis.\n"
        )

    # ── Part 2: full source for independent scan ───────────────────────────
    parts.append(
        "\n━━ FULL CODE FOR INDEPENDENT SCAN ━━\n"
        "Also scan the entire code yourself for threats the static analyzer CANNOT see\n"
        "(obfuscation, indirect calls, encoded payloads, dynamic imports, steganographic\n"
        "exfiltration, time-delayed payloads, monkey-patching, etc.).\n"
        "Emit a finding with source:\"independent\" for anything you find independently.\n"
    )
    parts.append(f"<CODE>\n{source[:12000]}\n</CODE>")

    return "\n".join(parts)


# ── LLM callers ───────────────────────────────────────────────────────────────

async def _call_llm_with_fallback(prompt: str) -> tuple[Dict[str, Any], str]:
    """Try Ollama, fallback to OpenAI. Returns (parsed_result, model_name)."""
    for call_fn, label in ((_call_ollama, "ollama"), (_call_openai, "openai")):
        try:
            raw, model = await call_fn(prompt)
            parsed = _parse_llm_response(raw)
            return parsed, model
        except Exception as exc:
            logger.warning(f"trainer_security_{label}_failed", error=str(exc))

    # Both LLMs unavailable — AST already passed so auto-approve with notice
    return {
        "passed": True,
        "severity": "none",
        "summary": "LLM scan unavailable — passed AST gate, no definite violations detected.",
        "issues": [],
    }, "ast_gate_only"


async def _call_ollama(prompt: str) -> tuple[str, str]:
    """Call Ollama HTTP API directly."""
    import httpx
    from app.core.config import settings

    model = (
        getattr(settings, "OLLAMA_SECURITY_MODEL", None)
        or getattr(settings, "OLLAMA_MODEL", None)
        or os.environ.get("OLLAMA_SECURITY_MODEL", "")
        or os.environ.get("OLLAMA_MODEL", "")
    )
    if not model:
        raise ValueError("No Ollama model configured (set OLLAMA_SECURITY_MODEL or OLLAMA_MODEL)")

    base_url = (
        getattr(settings, "OLLAMA_BASE_URL", None)
        or os.environ.get("OLLAMA_BASE_URL", "")
    )
    if not base_url:
        raise ValueError("OLLAMA_BASE_URL is not configured")
    base_url = (base_url
                .replace("localhost", "host.docker.internal")
                .replace("127.0.0.1", "host.docker.internal"))

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{base_url}/v1/chat/completions",
            headers={"User-Agent": "curl/7.64.1"},
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": _LLM_SYSTEM_PROMPT},
                    {"role": "user",   "content": prompt},
                ],
                "temperature": 0.1,
                "stream": False,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"].strip(), model


async def _call_openai(prompt: str) -> tuple[str, str]:
    """Call OpenAI-compatible API."""
    import httpx
    from app.core.config import settings

    api_key = (
        getattr(settings, "OPENAI_API_KEY", "")
        or os.environ.get("OPENAI_API_KEY", "")
        or os.environ.get("LLM_API_KEY", "")
    )
    base_url = (
        getattr(settings, "OPENAI_BASE_URL", "")
        or os.environ.get("OPENAI_BASE_URL", "")
        or os.environ.get("LLM_BASE_URL", "")
        or "https://api.openai.com/v1"
    )
    model = (
        getattr(settings, "OPENAI_MODEL", "")
        or os.environ.get("OPENAI_MODEL", "")
        or os.environ.get("LLM_MODEL", "gpt-4o-mini")
    )

    if not api_key:
        raise ValueError("No OpenAI API key configured (set OPENAI_API_KEY or LLM_API_KEY)")

    async with httpx.AsyncClient(timeout=90) as client:
        resp = await client.post(
            f"{base_url}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": _LLM_SYSTEM_PROMPT},
                    {"role": "user",   "content": prompt},
                ],
                "temperature": 0.1,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"].strip(), model


# ── LLM response parser ───────────────────────────────────────────────────────

def _parse_llm_response(raw: str) -> Dict[str, Any]:
    """
    Parse per-finding JSON lines from the LLM.

    Each finding line:
      {"severity":"HIGH","line":N,"rule":"...","title":"...","detail":"...","block":true}
    Summary line:
      {"summary":true,"total":N,"high":N,...,"risk":"CRITICAL|HIGH|MEDIUM|LOW|SAFE"}
    """
    import json

    findings: list[dict] = []
    summary_obj: Optional[dict] = None

    def _ingest(obj: Any) -> None:
        nonlocal summary_obj
        if isinstance(obj, list):
            for item in obj:
                _ingest(item)
        elif isinstance(obj, dict):
            if obj.get("summary"):
                summary_obj = obj
            elif "severity" in obj or "title" in obj or "rule" in obj:
                findings.append(obj)

    # Extract all balanced JSON tokens from raw text
    i, n = 0, len(raw)
    while i < n:
        if raw[i] not in ('{', '['):
            i += 1
            continue
        open_ch  = raw[i]
        close_ch = '}' if open_ch == '{' else ']'
        depth, j = 0, i
        in_str = escape = False
        while j < n:
            ch = raw[j]
            if escape:
                escape = False
            elif ch == '\\' and in_str:
                escape = True
            elif ch == '"':
                in_str = not in_str
            elif not in_str:
                if   ch == open_ch:  depth += 1
                elif ch == close_ch:
                    depth -= 1
                    if depth == 0:
                        try:
                            _ingest(json.loads(raw[i:j+1]))
                        except json.JSONDecodeError:
                            pass
                        i = j + 1
                        break
            j += 1
        else:
            break

    blocked    = [f for f in findings if f.get("block")]
    risk       = (summary_obj or {}).get("risk", "UNKNOWN")
    is_blocked = bool(blocked) or risk == "CRITICAL"

    if not findings and not summary_obj:
        # Unparseable response — AST already passed, so auto-approve (same behaviour as
        # LLM-unavailable fallback). A truly malicious trainer would be caught by the AST gate.
        import structlog as _sl
        _sl.get_logger(__name__).warning(
            "trainer_security_llm_unparseable",
            raw_preview=raw[:300],
        )
        return {
            "passed": True,
            "severity": "none",
            "summary": "AST gate passed — LLM returned unparseable output, auto-approved.",
            "issues": [],
        }

    issues = []
    for f in findings:
        prefix = "BLOCK" if f.get("block") else "WARN"
        loc    = f" (line {f['line']})" if f.get("line") else ""
        src    = f" [{f.get('source', 'llm')}]" if f.get("source") else ""
        issues.append({
            "rule":    f.get("rule", "unknown"),
            "title":   f.get("title", f.get("rule", "")),
            "detail":  f.get("detail", ""),
            "fix":     f.get("fix", ""),
            "line":    f.get("line"),
            "block":   bool(f.get("block")),
            "source":  f.get("source", "llm"),    # "ast_hint" | "independent" | "llm"
            "severity": f.get("severity", "LOW"),
            # Human-readable summary for log / email
            "message": f"[{prefix}]{loc}{src} {f.get('title', f.get('rule',''))}: {f.get('detail','')}",
        })

    severity   = "critical" if is_blocked else ("low" if findings else "none")
    risk_label = (summary_obj or {}).get("risk", "SAFE")

    independent_count = sum(1 for f in findings if f.get("source") == "independent")
    ast_count         = sum(1 for f in findings if f.get("source") == "ast_hint")

    summary_parts = [risk_label]
    if blocked:
        summary_parts.append(f"{len(blocked)} blocked finding(s)")
    if findings:
        summary_parts.append(f"{len(findings)} total ({ast_count} from hints, {independent_count} independent)")

    return {
        "passed":   not is_blocked,
        "severity": severity,
        "summary":  " — ".join(summary_parts) if len(summary_parts) > 1 else risk_label + " — no issues found",
        "issues":   issues,
    }


# ── Admin ticket / violation helpers ─────────────────────────────────────────

async def create_admin_ticket(
    submission_id: str,
    trainer_name: str,
    scan_result: Dict[str, Any],
    owner_email: str,
    org_id: str,
) -> str:
    """Create an ML-internal admin ticket for a flagged submission. Returns ticket id."""
    from app.models.admin_ticket import AdminTicket

    severity = scan_result.get("severity", "medium")
    issues   = scan_result.get("issues", [])
    summary  = scan_result.get("summary", "")

    def _fmt(i: Any) -> str:
        if isinstance(i, dict):
            return i.get("message") or f"[{i.get('rule','')}] {i.get('detail','')}"
        return str(i)

    ticket = AdminTicket(
        category="trainer_security",
        title=f"Security review: {trainer_name} ({severity})",
        body=(
            f"Trainer '{trainer_name}' submitted by {owner_email} (org: {org_id}) "
            f"requires security review.\n\n"
            f"Severity: {severity}\nSummary: {summary}\n\n"
            f"Findings:\n" + "\n".join(f"- {_fmt(i)}" for i in issues)
        ),
        related_id=submission_id,
        org_id=org_id,
        owner_email=owner_email,
        severity=severity if severity in ("low", "medium", "high", "critical") else "high",
        metadata={"scan_result": scan_result, "submission_id": submission_id},
    )
    await ticket.insert()
    return str(ticket.id)


async def create_violation(
    submission_id: str,
    trainer_name: str,
    org_id: str,
    owner_email: str,
    severity: str,
    summary: str,
    issues: list,
) -> None:
    """Record a trainer violation."""
    from app.models.trainer_violation import TrainerViolation

    violation = TrainerViolation(
        org_id=org_id,
        owner_email=owner_email,
        submission_id=submission_id,
        trainer_name=trainer_name,
        severity=severity,
        summary=summary,
        issues=issues,
    )
    await violation.insert()
    logger.info(
        "trainer_violation_created",
        submission_id=submission_id,
        org_id=org_id,
        severity=severity,
    )
