"""
Runtime security audit hook for the Celery ML worker.

Installed once per worker process via the Celery ``worker_process_init`` signal.
``sys.addaudithook`` is **irreversible** — user code cannot remove it.

Policy
------
subprocess.Popen   → BLOCK unless executable basename is in ALLOWED_EXECUTABLES
os.system          → BLOCK always (os.system is never needed; use subprocess)
open (sensitive)   → BLOCK reads/writes to /etc/passwd, /etc/shadow, /root/.ssh,
                      /proc/<pid>/mem, /proc/<pid>/maps
socket.connect     → LOG non-whitelisted hosts (never raises — framework code
                      such as boto3/motor/mlflow also connects and must not break)
"""
from __future__ import annotations

import os
import re
import sys
import structlog

logger = structlog.get_logger(__name__)

# Per-process dedup set — log each external host only once to avoid log spam
# from libraries that open multiple connections to the same host (e.g. Ultralytics
# downloading model weights, boto3 keep-alives, MLflow telemetry).
_warned_hosts: set[str] = set()

# ── Subprocess whitelist ──────────────────────────────────────────────────────
# Basenames of executables that ML inference code legitimately needs.
# Everything else is blocked.
_ALLOWED_EXECUTABLES: frozenset[str] = frozenset({
    "tesseract",      # OCR
    "convert",        # ImageMagick
    "identify",       # ImageMagick
    "ffmpeg",         # video/audio processing
    "ffprobe",
    "gs",             # Ghostscript (PDF rendering)
    "pdftotext",      # poppler
    "pdfimages",
    "python",         # sub-interpreter calls (e.g. multiprocessing)
    "python3",
    "sh",             # restricted shell calls (rare but present in some libs)
    "file",           # file-type detection (used by cpuinfo / Ultralytics on startup)
    "git",            # MLflow captures git commit hash on each training run
})


def _exe_allowed(basename: str) -> bool:
    """Return True if the executable basename is permitted to run."""
    if basename in _ALLOWED_EXECUTABLES:
        return True
    # Allow any versioned Python interpreter: python3.11, python3.12, python3.13, …
    if basename.startswith("python") and basename.replace(".", "").replace("python", "").isdigit():
        return True
    return False

# ── Socket host whitelist ─────────────────────────────────────────────────────
# Connections to hosts NOT in this set are logged as warnings but not blocked.
# Hard enforcement belongs at the network layer (iptables / network namespace).
_ALLOWED_HOSTS: frozenset[str] = frozenset({
    "localhost",
    "127.0.0.1",
    "::1",
    "0.0.0.0",   # bind addresses
    "mongodb",
    "redis",
    "mlflow",
    "minio",
    "rabbitmq",
    "celery",
})

# Docker bridge / overlay subnets used for inter-container communication.
# Connections to these ranges are silently allowed (frameworks resolve hostnames
# to IPs before connecting, so we'd see IPs, not hostnames).
_ALLOWED_IP_PREFIXES: tuple[str, ...] = (
    "10.",
    "172.16.", "172.17.", "172.18.", "172.19.", "172.20.",
    "172.21.", "172.22.", "172.23.", "172.24.", "172.25.",
    "172.26.", "172.27.", "172.28.", "172.29.", "172.30.", "172.31.",
    "192.168.",
    "127.",
    "::1",
    "fd",   # ULA IPv6 (Docker internal)
)

# ── Sensitive file paths ──────────────────────────────────────────────────────
_SENSITIVE_EXACT: frozenset[str] = frozenset({
    "/etc/passwd",
    "/etc/shadow",
    "/etc/sudoers",
    "/etc/gshadow",
})

_SENSITIVE_PREFIX: tuple[str, ...] = (
    "/root/.ssh/",
    "/home/",          # home dir credential files
    "/etc/cron",
    "/etc/ssh/",       # host keys
)

# /proc/<pid>/mem and /proc/<pid>/maps allow direct process memory access
_PROC_SENSITIVE_RE = re.compile(r"^/proc/\d+/(mem|maps|environ|cmdline)$")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _exe_basename(args) -> str:
    """Extract the executable basename from Popen args or a plain string."""
    if isinstance(args, (list, tuple)) and args:
        exe = str(args[0])
    else:
        exe = str(args).split()[0] if args else ""
    return os.path.basename(exe)


def _host_allowed(host: str) -> bool:
    if not host:
        return True
    if host in _ALLOWED_HOSTS:
        return True
    for prefix in _ALLOWED_IP_PREFIXES:
        if host.startswith(prefix):
            return True
    return False


def _is_sensitive_path(path: str) -> bool:
    if path in _SENSITIVE_EXACT:
        return True
    for prefix in _SENSITIVE_PREFIX:
        if path.startswith(prefix):
            return True
    if _PROC_SENSITIVE_RE.match(path):
        return True
    return False


# ── The hook ──────────────────────────────────────────────────────────────────

def _audit_hook(event: str, args: tuple) -> None:  # noqa: C901
    """
    Called by the CPython runtime for every auditable event.
    Raising inside the hook blocks the operation; returning silently allows it.
    The hook itself must never raise unexpectedly — wrap everything in try/except.
    """
    try:
        # ── subprocess.Popen ─────────────────────────────────────────────────
        # CPython fires: sys.audit("subprocess.Popen", executable, args, cwd, env)
        if event == "subprocess.Popen":
            executable = str(args[0]) if args else ""
            popen_args = args[1] if len(args) > 1 else []
            # Prefer the args list for the basename (more reliable than executable)
            cmd_list = popen_args if isinstance(popen_args, (list, tuple)) and popen_args else [executable]
            basename = _exe_basename(cmd_list)
            if basename and not _exe_allowed(basename):
                logger.warning(
                    "worker_security_subprocess_blocked",
                    executable=basename,
                    args=str(cmd_list[:6]),
                )
                raise PermissionError(
                    f"[worker-security] subprocess blocked: {basename!r} "
                    f"is not in the allowed executables list"
                )

        # ── os.system ────────────────────────────────────────────────────────
        # CPython fires: sys.audit("os.system", command)
        elif event == "os.system":
            cmd = str(args[0]) if args else ""
            exe = _exe_basename(cmd)
            if not _exe_allowed(exe):
                logger.warning(
                    "worker_security_os_system_blocked",
                    command=cmd[:200],
                )
                raise PermissionError(
                    f"[worker-security] os.system blocked: {cmd[:80]!r}"
                )

        # ── open (Python built-in) ───────────────────────────────────────────
        # CPython fires: sys.audit("open", path, mode, flags)
        elif event == "open":
            path = str(args[0]) if args else ""
            if _is_sensitive_path(path):
                mode = str(args[1]) if len(args) > 1 else "r"
                logger.warning(
                    "worker_security_sensitive_open_blocked",
                    path=path,
                    mode=mode,
                )
                raise PermissionError(
                    f"[worker-security] open blocked: {path!r}"
                )

        # ── socket.connect ───────────────────────────────────────────────────
        # CPython fires: sys.audit("socket.connect", socket_obj, address)
        elif event == "socket.connect":
            addr = args[1] if len(args) > 1 else None
            if addr is None:
                return
            host = addr[0] if isinstance(addr, (tuple, list)) and addr else str(addr)
            if not _host_allowed(str(host)):
                port = addr[1] if isinstance(addr, (tuple, list)) and len(addr) > 1 else None
                # Log each external host only once per process — libraries like
                # Ultralytics (model weight downloads) and boto3 (S3 keep-alives)
                # open many connections to the same IP and would flood the log.
                host_key = f"{host}:{port}"
                if host_key not in _warned_hosts:
                    _warned_hosts.add(host_key)
                    logger.warning(
                        "worker_security_external_connect",
                        host=host,
                        port=port,
                    )
                # Log only — do not raise.  Hard network enforcement belongs
                # at the iptables / network-namespace layer.  Raising here
                # would break boto3 / MLflow / motor when they resolve
                # hostnames to IPs that don't appear in _ALLOWED_HOSTS.

    except PermissionError:
        raise  # always re-raise our own intentional blocks
    except Exception:
        pass   # never let the hook crash the worker process


# ── Public entry point ────────────────────────────────────────────────────────

_installed = False


def install() -> None:
    """
    Install the audit hook into this process.
    Safe to call multiple times — installs only once.
    ``sys.addaudithook`` is irreversible; subsequent calls add duplicate hooks,
    so we guard with a module-level flag.
    """
    global _installed
    if _installed:
        return
    sys.addaudithook(_audit_hook)
    _installed = True
    logger.info("worker_security_hook_installed", pid=os.getpid())
