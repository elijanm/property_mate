"""File security scanner — ClamAV virus scan + static code analysis.

Two-stage pipeline
──────────────────
1. ClamAV scan    — detect known malware signatures
2. Code analysis  — detect Python/shell code with data-exfiltration,
                   system modification, or reverse-shell patterns
"""
import re
import ast
import base64
import zipfile
import io
import structlog
from dataclasses import dataclass, field
from typing import List, Optional

logger = structlog.get_logger(__name__)

# ── String-literal stripping ─────────────────────────────────────────────────
# We MUST strip string literals before running regex analysis.
# Otherwise a file like file_scanner_service.py itself (which contains the
# dangerous patterns as raw regex strings) would flag itself, and any trainer
# that defines pattern variables or docstrings would trigger false positives.

_STR_LITERAL = re.compile(
    r"(\"\"\".*?\"\"\"|\'\'\'.*?\'\'\'|\"(?:[^\"\\]|\\.)*\"|\'(?:[^\'\\]|\\.)*\')",
    re.DOTALL,
)

_PY_COMMENT = re.compile(r"(?m)#[^\n]*")

def _strip_strings(source: str) -> str:
    """
    Replace string literal contents AND Python comments with blank placeholders.
    This prevents false positives from:
      - Docstrings that mention dangerous function names for documentation
      - Inline comments like `# execute via API` appearing after base64.b64decode(...)
      - Pattern-definition strings in scanner/ML code
    Line count is preserved so error line numbers remain accurate.
    """
    def _blank(m):
        inner = m.group(0)
        newlines = "\n" * inner.count("\n")
        if inner.startswith('"""') or inner.startswith("'''"):
            return inner[:3] + newlines + inner[-3:]
        return inner[0] + newlines + inner[-1]
    # Strip string literals first (order matters — comments inside strings should stay stripped)
    no_strings = _STR_LITERAL.sub(_blank, source)
    # Strip line comments (# to end of line), preserving the newline itself
    return _PY_COMMENT.sub("", no_strings)

# ── Result type ──────────────────────────────────────────────────────────────

@dataclass
class ScanResult:
    safe: bool
    threats: List[str] = field(default_factory=list)
    clamav_result: Optional[str] = None
    code_threats: List[str] = field(default_factory=list)

    @property
    def summary(self) -> str:
        if self.safe:
            return "clean"
        return "; ".join(self.threats)


# ── ClamAV ───────────────────────────────────────────────────────────────────

def _clamav_scan(content: bytes) -> Optional[str]:
    """
    Scan bytes via ClamAV daemon (clamd).
    Returns the virus name if detected, None if clean.
    Silently returns None if ClamAV is not installed/running (graceful degradation).
    """
    try:
        import clamd  # pip install clamd
        cd = clamd.ClamdUnixSocket()          # /var/run/clamav/clamd.ctl
        result = cd.instream(io.BytesIO(content))
        status, virus = result["stream"]
        if status == "FOUND":
            return virus
        return None
    except ImportError:
        logger.debug("clamav_not_installed")
        return None
    except Exception as exc:
        logger.warning("clamav_scan_failed", error=str(exc))
        return None


# ── Static code analysis ─────────────────────────────────────────────────────

# Dangerous patterns that indicate data exfiltration, RCE, or system modification
_EXFILTRATION = re.compile(
    r"""(?:
      socket\.connect\s*\(
      | os\.system\s*\(
      | os\.execvpe?\s*\(
      | __import__\s*\(\s*['"]os['"]
      | \beval\s*\(
      | \bexec\s*\(
      | compile\s*\(.*exec
      | requests\.(?:get|post|put|delete|head)\s*\(.*https?://(?!(?:localhost|127\.|minio|mlflow|mongodb|redis|roboflow\.com|huggingface\.co|openai\.com|anthropic\.com|googleapis\.com|azure\.com|amazonaws\.com))
      | urllib\.request\.urlopen\s*\(.*https?://(?!(?:localhost|127\.|roboflow\.com|huggingface\.co|openai\.com))
      | boto3\.client\s*\(
      | paramiko\.SSHClient
      | ftplib\.FTP\s*\(
      | smtplib\.SMTP\s*\(
      | open\s*\([^)]*['"]\/etc\/
      | open\s*\([^)]*['"]\/proc\/
      | getattr\s*\(\s*__builtins__   # import smuggling via builtins
    )""",
    re.VERBOSE | re.IGNORECASE,
)

# Import smuggling and dynamic-attribute obfuscation patterns that survive string-stripping
_IMPORT_SMUGGLING = re.compile(
    r"""(?:
      getattr\s*\(\s*__builtins__   # getattr(__builtins__, '__import__')
      | __builtins__\s*\[           # __builtins__['__import__']
    )""",
    re.VERBOSE,
)

_SYSTEM_MODIFICATION = re.compile(
    r"""(?:
      os\.chmod\s*\(
      | os\.chown\s*\(
      | shutil\.(?:rmtree|move)\s*\(
      | os\.remove\s*\(.*\/(?:etc|usr|sys|boot|lib)
      | \bcrontab\b
      | \/etc\/cron
      | \/etc\/passwd
      | \/etc\/shadow
      | \.ssh\/authorized_keys
      | \biptables\s
      | \bsystemctl\s
    )""",
    re.VERBOSE | re.IGNORECASE,
)

_REVERSE_SHELL = re.compile(
    r"""(?:
      socket\.\w+\s*\(.*SOCK_STREAM.*connect
      | \/dev\/tcp\/
      | base64\.b64decode\([^)]*\)\s*\)?\s*[,;]?\s*\bexec\s*\(
      | \bnc\s+-[el]\b
      | \bncat\s+--exec\b
      | mkfifo.*\/tmp.*\bnc\b
      | python\b.*-c.*socket.*connect
    )""",
    re.VERBOSE | re.IGNORECASE,
)

_OBFUSCATION = re.compile(
    r"""(?:
      \\x[0-9a-f]{2}(?:\\x[0-9a-f]{2}){15,}
      | \\[0-7]{3}(?:\\[0-7]{3}){10,}
      | chr\(\d+\)\s*\+\s*chr\(\d+\)
      | zlib\.decompress\s*\(.*base64
    )""",
    re.VERBOSE | re.IGNORECASE,
)


_SENSITIVE_ATTRS = frozenset({
    "environ", "getenv", "__import__", "__builtins__", "system", "popen",
    "execve", "execvp", "modules", "read_bytes",
})

_JOIN_SENSITIVE = frozenset({
    "environ", "getenv", "__import__", "__builtins__", "system", "popen",
    "execve", "execvp", "modules",
})


def _try_fold_join(node: ast.Call) -> Optional[str]:
    """
    If `node` is `''.join([list, of, string, constants])`, return the joined string.
    Returns None if the pattern doesn't match or not all elements are constants.
    This catches `['e','n','v' 'iron']` → 'environ' obfuscation.
    Note: Python's parser already folds adjacent string literals so
    `'v' 'iron'` → Constant('viron') before we even see the AST.
    """
    if not (isinstance(node.func, ast.Attribute) and node.func.attr == "join"):
        return None
    # delimiter must be an empty string constant
    delim = node.func.value
    if not (isinstance(delim, ast.Constant) and delim.value == ""):
        return None
    if not node.args:
        return None
    arg = node.args[0]
    if not isinstance(arg, ast.List):
        return None
    parts = []
    for elt in arg.elts:
        if isinstance(elt, ast.Constant) and isinstance(elt.value, str):
            parts.append(elt.value)
        else:
            return None  # non-constant element — can't fold
    return "".join(parts)


def _analyze_python_ast(source: str) -> List[str]:
    """Parse Python AST and flag dangerous node patterns."""
    threats = []
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return []

    for node in ast.walk(tree):
        # Import of dangerous modules
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            names = [a.name for a in node.names] if isinstance(node, ast.Import) else [node.module or ""]
            for name in names:
                if name in {"pty", "ctypes", "cffi"}:
                    threats.append(f"Dangerous import: {name}")

        # __builtins__ override
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id == "__builtins__":
                    threats.append("Overrides __builtins__")

        if isinstance(node, ast.Call):
            # Dynamic attribute access trying to hide calls
            if isinstance(node.func, ast.Attribute):
                if node.func.attr in {"__class__", "__subclasses__", "__globals__", "__code__"}:
                    threats.append(f"Introspection abuse: {node.func.attr}")

            # ── getattr() abuse detection ──────────────────────────────────
            if isinstance(node.func, ast.Name) and node.func.id == "getattr":
                args = node.args
                if len(args) >= 1:
                    first = args[0]
                    # getattr(__builtins__, ...) — always import smuggling
                    if isinstance(first, ast.Name) and first.id in ("__builtins__", "builtins"):
                        threats.append(
                            "Import smuggling: getattr(__builtins__, ...) bypasses import system"
                        )
                if len(args) >= 2:
                    second = args[1]
                    # getattr(anything, '__import__') — always import smuggling
                    if isinstance(second, ast.Constant) and second.value == "__import__":
                        threats.append(
                            "Import smuggling: getattr(..., '__import__') — dynamic __import__ access"
                        )
                    # getattr(anything, <sensitive_attr_string>)
                    elif isinstance(second, ast.Constant) and second.value in _SENSITIVE_ATTRS:
                        threats.append(
                            f"Dynamic attribute exfiltration: getattr(..., '{second.value}')"
                        )
                    # getattr(anything, <variable>) — hidden dynamic lookup
                    elif not isinstance(second, ast.Constant):
                        threats.append(
                            "Obfuscated attribute access: getattr() with non-constant attribute name"
                        )

            # ── String-join obfuscation: ''.join([...]) to hide attr names ─
            folded = _try_fold_join(node)
            if folded and folded in _JOIN_SENSITIVE:
                threats.append(
                    f"String-join obfuscation constructs sensitive identifier '{folded}'"
                )

    return threats


def _analyze_code(source: str, filename: str) -> List[str]:
    """Run regex + AST checks on source code string."""
    threats: List[str] = []

    # Strip string literals so we only analyse actual code constructs,
    # not pattern definitions, docstrings, or comment text.
    code_only = _strip_strings(source)

    if _EXFILTRATION.search(code_only):
        threats.append("Data exfiltration pattern detected")

    if _SYSTEM_MODIFICATION.search(code_only):
        threats.append("System modification pattern detected")

    if _REVERSE_SHELL.search(code_only):
        threats.append("Reverse shell pattern detected")

    if _OBFUSCATION.search(code_only):
        threats.append("Obfuscated payload detected")

    # _IMPORT_SMUGGLING is checked on the RAW source (not string-stripped) because
    # `__builtins__` is an identifier, not a string literal, so stripping does not
    # remove it. String-stripping would only remove the second argument.
    if _IMPORT_SMUGGLING.search(source):
        threats.append("Import smuggling via __builtins__ access detected")

    if filename.endswith(".py"):
        threats.extend(_analyze_python_ast(source))

    return threats


def _extract_text_from_zip(content: bytes) -> List[tuple]:
    """
    Extract all text files from a ZIP archive.
    Returns list of (filename, text_content).
    """
    files = []
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            for name in zf.namelist():
                if name.endswith(("/", "\\")):
                    continue
                ext = name.lower().rsplit(".", 1)[-1] if "." in name else ""
                if ext in {"py", "sh", "bash", "js", "ts", "rb", "pl", "php", "lua", "r"}:
                    try:
                        raw = zf.read(name)
                        files.append((name, raw.decode("utf-8", errors="replace")))
                    except Exception:
                        pass
    except Exception as exc:
        logger.debug("zip_extract_failed", error=str(exc))
    return files


# ── Public interface ──────────────────────────────────────────────────────────

async def scan_file(content: bytes, filename: str, mime_type: str = "", clamav_only: bool = False) -> ScanResult:
    """
    Run the full two-stage scan on uploaded file bytes.
    Safe to call from any async context — CPU-bound work is minimal.
    """
    threats: List[str] = []
    code_threats: List[str] = []

    # Stage 1: ClamAV
    virus = _clamav_scan(content)
    if virus:
        threats.append(f"Virus detected: {virus}")
        return ScanResult(safe=False, threats=threats, clamav_result=virus)

    # Stage 2: Code analysis (skipped for trainer uploads — too many false positives on ML code)
    if clamav_only:
        return ScanResult(safe=True, threats=[], clamav_result=None)

    fname_lower = filename.lower()
    is_zip = fname_lower.endswith(".zip") or mime_type in {
        "application/zip", "application/x-zip-compressed"
    }

    if is_zip:
        # Scan every code file inside the ZIP
        for inner_name, source in _extract_text_from_zip(content):
            inner_threats = _analyze_code(source, inner_name)
            if inner_threats:
                code_threats.extend([f"{inner_name}: {t}" for t in inner_threats])
    elif fname_lower.endswith((".py", ".sh", ".bash", ".js", ".ts", ".rb", ".pl", ".php")):
        try:
            source = content.decode("utf-8", errors="replace")
            code_threats = _analyze_code(source, filename)
        except Exception:
            pass
    elif "text" in mime_type:
        try:
            source = content.decode("utf-8", errors="replace")
            code_threats = _analyze_code(source, filename)
        except Exception:
            pass

    # Stage 3: Detect encoded payloads hiding in seemingly innocent text files
    # ZIP and binary files are skipped — their compressed data produces enormous
    # false positives because compressed bytes look like base64 to the regex.
    # Only apply to plain text/script files that shouldn't contain binary blobs.
    if not is_zip and "text" in mime_type or fname_lower.endswith((".py", ".sh", ".js", ".ts", ".php", ".rb")):
        b64_chunks = re.findall(r"[A-Za-z0-9+/]{200,}={0,2}", content.decode("latin-1", errors="replace"))
        for chunk in b64_chunks:
            try:
                decoded = base64.b64decode(chunk + "==")
                decoded_str = decoded.decode("utf-8", errors="replace")
                if _EXFILTRATION.search(decoded_str) or _REVERSE_SHELL.search(decoded_str):
                    code_threats.append("Encoded payload contains exfiltration/shell pattern")
                    break
            except Exception:
                pass

    threats.extend(code_threats)

    safe = len(threats) == 0
    if not safe:
        logger.warning(
            "file_scan_threat",
            filename=filename,
            threats=threats,
        )

    return ScanResult(
        safe=safe,
        threats=threats,
        clamav_result=None,
        code_threats=code_threats,
    )
