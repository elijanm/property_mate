"""
Monitored HTTP client for use inside trainers and inference scripts.

Drop-in replacement for ``httpx`` / ``requests`` for external API calls
(Roboflow, HuggingFace, cloud OCR APIs, etc.).

Every request and response is:
  • Validated against an allowlist of permitted hosts
  • Logged with structlog (url, method, status, latency_ms, response_size)
  • Size-limited on the response body (default 50 MB)
  • Timeout-enforced (default 30 s connect / 60 s read)

Usage inside an inference script or trainer::

    from app.core.safe_http import SafeHttpClient

    client = SafeHttpClient(allowed_hosts=["api.roboflow.com", "huggingface.co"])
    resp = client.get("https://api.roboflow.com/dataset/meter/1")
    data = resp.json()

Or use the module-level default client (allows the built-in ML-service whitelist)::

    from app.core.safe_http import http
    resp = http.post("https://huggingface.co/api/models", json={"query": "meter"})
"""
from __future__ import annotations

import time
from typing import Any, Optional
import structlog

logger = structlog.get_logger(__name__)

# ── Default host allowlist ────────────────────────────────────────────────────
# Hosts that ML code inside this service is permitted to reach.
# Extend per-client by passing ``allowed_hosts`` to ``SafeHttpClient()``.
_DEFAULT_ALLOWED_HOSTS: frozenset[str] = frozenset({
    # Model hubs
    "huggingface.co",
    "cdn-lfs.huggingface.co",
    "huggingface.co",
    # Roboflow
    "roboflow.com",
    "api.roboflow.com",
    "universe.roboflow.com",
    # OpenAI / Anthropic (vision APIs, embeddings)
    "api.openai.com",
    "api.anthropic.com",
    # Google Cloud Vision / Vertex
    "vision.googleapis.com",
    "aiplatform.googleapis.com",
    # AWS Rekognition / Textract
    "rekognition.us-east-1.amazonaws.com",
    "textract.us-east-1.amazonaws.com",
    # Azure Cognitive Services
    "cognitiveservices.azure.com",
    # Internal services (Docker network)
    "minio",
    "mlflow",
    "mongodb",
    "redis",
    "localhost",
    "127.0.0.1",
})

# ── Limits ────────────────────────────────────────────────────────────────────
_DEFAULT_CONNECT_TIMEOUT = 10.0   # seconds
_DEFAULT_READ_TIMEOUT    = 60.0   # seconds
_DEFAULT_MAX_BODY_BYTES  = 50 * 1024 * 1024   # 50 MB


class HostNotAllowedError(PermissionError):
    """Raised when the target host is not in the client's allowlist."""


class ResponseTooLargeError(ValueError):
    """Raised when the response body exceeds the configured size limit."""


class SafeHttpClient:
    """
    Thin wrapper around ``httpx.Client`` that enforces host allowlisting,
    size limits, timeouts, and structured logging on every request.
    """

    def __init__(
        self,
        allowed_hosts: Optional[set[str]] = None,
        max_body_bytes: int = _DEFAULT_MAX_BODY_BYTES,
        connect_timeout: float = _DEFAULT_CONNECT_TIMEOUT,
        read_timeout: float = _DEFAULT_READ_TIMEOUT,
        extra_headers: Optional[dict] = None,
    ):
        self._allowed = frozenset(allowed_hosts) if allowed_hosts else _DEFAULT_ALLOWED_HOSTS
        self._max_body = max_body_bytes
        self._connect_timeout = connect_timeout
        self._read_timeout = read_timeout
        self._extra_headers = extra_headers or {}

    # ── Public interface ──────────────────────────────────────────────────────

    def get(self, url: str, **kwargs) -> "SafeResponse":
        return self._request("GET", url, **kwargs)

    def post(self, url: str, **kwargs) -> "SafeResponse":
        return self._request("POST", url, **kwargs)

    def put(self, url: str, **kwargs) -> "SafeResponse":
        return self._request("PUT", url, **kwargs)

    def delete(self, url: str, **kwargs) -> "SafeResponse":
        return self._request("DELETE", url, **kwargs)

    # ── Core ──────────────────────────────────────────────────────────────────

    def _request(self, method: str, url: str, **kwargs) -> "SafeResponse":
        import httpx

        host = self._extract_host(url)
        self._check_host(host, url)

        timeout = httpx.Timeout(
            connect=kwargs.pop("connect_timeout", self._connect_timeout),
            read=kwargs.pop("read_timeout", self._read_timeout),
            write=None,
            pool=None,
        )
        headers = {**self._extra_headers, **kwargs.pop("headers", {})}

        t0 = time.monotonic()
        try:
            with httpx.Client(timeout=timeout, follow_redirects=True) as client:
                resp = client.request(method, url, headers=headers, **kwargs)
            latency_ms = round((time.monotonic() - t0) * 1000, 1)
        except Exception as exc:
            latency_ms = round((time.monotonic() - t0) * 1000, 1)
            logger.warning(
                "safe_http_request_failed",
                method=method, url=url, latency_ms=latency_ms, error=str(exc),
            )
            raise

        body = resp.content
        if len(body) > self._max_body:
            logger.warning(
                "safe_http_response_too_large",
                method=method, url=url,
                response_bytes=len(body), limit=self._max_body,
            )
            raise ResponseTooLargeError(
                f"Response from {url!r} is {len(body):,} bytes "
                f"(limit {self._max_body:,} bytes)"
            )

        logger.info(
            "safe_http_request",
            method=method,
            host=host,
            url=url,
            status=resp.status_code,
            response_bytes=len(body),
            latency_ms=latency_ms,
        )

        return SafeResponse(resp, body)

    # ── Helpers ───────────────────────────────────────────────────────────────

    @staticmethod
    def _extract_host(url: str) -> str:
        """Extract the hostname from a URL (no port, no path)."""
        try:
            from urllib.parse import urlparse
            return urlparse(url).hostname or ""
        except Exception:
            return ""

    def _check_host(self, host: str, url: str) -> None:
        """Raise HostNotAllowedError if host is not in the allowlist."""
        if not host:
            raise HostNotAllowedError(f"Could not parse host from URL: {url!r}")
        # Exact match or suffix match (e.g. "*.huggingface.co")
        if host in self._allowed:
            return
        for allowed in self._allowed:
            if host.endswith("." + allowed):
                return
        logger.warning(
            "safe_http_host_blocked",
            host=host, url=url,
            allowed=sorted(self._allowed),
        )
        raise HostNotAllowedError(
            f"[safe-http] Host {host!r} is not in the allowed list. "
            f"Pass allowed_hosts={{...}} to SafeHttpClient() to permit it."
        )


class SafeResponse:
    """Thin wrapper around httpx.Response exposing the pre-read body."""

    def __init__(self, resp: Any, body: bytes):
        self._resp = resp
        self._body = body

    @property
    def status_code(self) -> int:
        return self._resp.status_code

    @property
    def headers(self) -> Any:
        return self._resp.headers

    @property
    def content(self) -> bytes:
        return self._body

    @property
    def text(self) -> str:
        return self._body.decode(self._resp.encoding or "utf-8", errors="replace")

    def json(self) -> Any:
        import json
        return json.loads(self._body)

    def raise_for_status(self) -> None:
        self._resp.raise_for_status()


# ── Module-level default client ───────────────────────────────────────────────
# Use this in trainers/inference scripts when no custom allowlist is needed.
http = SafeHttpClient()
