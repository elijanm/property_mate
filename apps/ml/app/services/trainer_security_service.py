"""
Trainer security scanning service.

Scans uploaded trainer .py files for malicious/suspicious code patterns
using an LLM (Ollama preferred, OpenAI fallback).
"""
from __future__ import annotations

import hashlib
import os
import re
from typing import Any, Dict, Optional

import structlog

logger = structlog.get_logger(__name__)

# Patterns that auto-flag as suspicious (pre-LLM check)
_SUSPICIOUS_PATTERNS = [
    (r"\bos\.system\b", "os.system shell execution"),
    (r"\bsubprocess\b", "subprocess usage"),
    (r"\beval\s*\(", "eval() usage"),
    (r"\bexec\s*\(", "exec() usage"),
    (r"\b__import__\s*\(", "__import__() usage"),
    (r"\bopen\s*\(['\"](?!/tmp)", "file open outside /tmp"),
    (r"\bsocket\.socket\b", "raw socket usage"),
    (r"\bparamiko\b", "paramiko SSH library"),
    (r"\bftplib\b", "ftplib usage"),
    (r"\bboto3\b", "boto3 direct AWS access"),
    (r"\brequests\.get\b", "outbound HTTP request"),
    (r"\burllib\.request\b", "outbound HTTP request"),
    (r"\bhttpx\b", "httpx outbound request"),
    (r"\bos\.environ\b", "env variable access"),
    (r"\bos\.getenv\b", "env variable access"),
]


def compute_submission_hash(org_id: str, file_bytes: bytes) -> str:
    """SHA-256 hash namespaced by org_id to prevent cross-org collisions."""
    return hashlib.sha256(org_id.encode() + b":" + file_bytes).hexdigest()


def quick_pattern_scan(source: str) -> list[dict]:
    """Fast regex scan before LLM. Returns list of {pattern, description}."""
    hits = []
    for pattern, description in _SUSPICIOUS_PATTERNS:
        if re.search(pattern, source):
            hits.append({"pattern": pattern, "description": description})
    return hits


async def scan_trainer_security(
    source: str,
    org_id: str,
    submission_id: str,
    trainer_name: str = "",
) -> Dict[str, Any]:
    """
    Scan trainer source code for security issues using LLM.
    Tries Ollama first, falls back to OpenAI.

    Returns:
        {passed, issues, severity, model_used, summary, quick_hits}
    """
    quick_hits = quick_pattern_scan(source)

    prompt = _build_security_prompt(source, trainer_name, quick_hits)

    # Try Ollama first, fall back to OpenAI
    result, model_used = await _call_llm_with_fallback(prompt)

    result["quick_hits"] = [h["description"] for h in quick_hits]
    result["model_used"] = model_used

    logger.info(
        "trainer_security_scan_complete",
        submission_id=submission_id,
        org_id=org_id,
        passed=result.get("passed"),
        severity=result.get("severity"),
        model=model_used,
        issues_count=len(result.get("issues", [])),
    )

    return result


def _build_security_prompt(source: str, trainer_name: str, quick_hits: list) -> str:
    hits_text = ""
    if quick_hits:
        hits_text = "\n\nPre-scan found these suspicious patterns:\n" + "\n".join(
            f"- {h['description']}" for h in quick_hits
        )

    return f"""You are a code security auditor reviewing an ML trainer plugin for a SaaS platform.
The trainer runs inside a sandboxed Python process but SHOULD NOT:
1. Read/write files outside /tmp
2. Make outbound network connections
3. Access environment variables (secrets)
4. Execute shell commands (os.system, subprocess)
5. Use eval() or exec() on external data
6. Import dangerous libraries (paramiko, boto3, socket, ftplib)
7. Allocate unbounded memory (e.g., huge lists in loops)
8. Exfiltrate model weights or training data

Trainer name: {trainer_name or "unknown"}
{hits_text}

Review this trainer code and respond in JSON only:
{{
  "passed": true/false,
  "severity": "none|low|high|critical|malicious",
  "summary": "one sentence summary",
  "issues": ["issue1", "issue2"]
}}

If passed=true, severity must be "none" and issues must be empty.
If any critical/malicious pattern found, set passed=false and severity accordingly.

Trainer source:
```python
{source[:6000]}
```

Respond with JSON only, no extra text."""


async def _call_llm_with_fallback(prompt: str) -> tuple[Dict[str, Any], str]:
    """Try Ollama, fallback to OpenAI. Returns (parsed_result, model_name)."""
    # Try Ollama first
    try:
        result, model = await _call_ollama(prompt)
        parsed = _parse_llm_response(result)
        return parsed, model
    except Exception as exc:
        logger.warning("trainer_security_ollama_failed", error=str(exc))

    # Fallback to OpenAI
    try:
        result, model = await _call_openai(prompt)
        parsed = _parse_llm_response(result)
        return parsed, model
    except Exception as exc:
        logger.warning("trainer_security_openai_failed", error=str(exc))

    # If both fail, return a safe default requiring manual review
    return {
        "passed": False,
        "severity": "low",
        "summary": "Automated scan failed — manual review required",
        "issues": ["LLM scan unavailable"],
    }, "fallback"


async def _call_ollama(prompt: str) -> tuple[str, str]:
    """Call Ollama HTTP API directly."""
    import httpx
    from app.core.config import settings

    # Use configured model or default to a capable one
    model = getattr(settings, "OLLAMA_SECURITY_MODEL", None) or getattr(settings, "OLLAMA_MODEL", "llama3.2:latest")
    base_url = getattr(settings, "OLLAMA_BASE_URL", "http://ollama:11434")

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{base_url}/api/generate",
            json={"model": model, "prompt": prompt, "stream": False},
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("response", ""), model


async def _call_openai(prompt: str) -> tuple[str, str]:
    """Call OpenAI-compatible API."""
    import httpx
    from app.core.config import settings

    api_key = getattr(settings, "OPENAI_API_KEY", "") or os.environ.get("OPENAI_API_KEY", "")
    base_url = getattr(settings, "OPENAI_BASE_URL", "https://api.openai.com/v1")
    model = getattr(settings, "OPENAI_MODEL", "gpt-4o-mini")

    if not api_key:
        raise ValueError("No OpenAI API key configured")

    async with httpx.AsyncClient(timeout=90) as client:
        resp = await client.post(
            f"{base_url}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.1,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        content = data["choices"][0]["message"]["content"]
        return content, model


def _parse_llm_response(raw: str) -> Dict[str, Any]:
    """Extract JSON from LLM response."""
    import json

    # Try to extract JSON block
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if match:
        try:
            data = json.loads(match.group())
            return {
                "passed": bool(data.get("passed", False)),
                "severity": data.get("severity", "low"),
                "summary": data.get("summary", ""),
                "issues": data.get("issues", []),
            }
        except json.JSONDecodeError:
            pass

    # Fallback: check for obvious pass/fail keywords
    lower = raw.lower()
    passed = "passed: true" in lower or '"passed": true' in lower
    return {
        "passed": passed,
        "severity": "none" if passed else "low",
        "summary": raw[:200],
        "issues": [] if passed else ["Parse error — manual review needed"],
    }


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
    issues = scan_result.get("issues", [])
    summary = scan_result.get("summary", "")

    ticket = AdminTicket(
        category="trainer_security",
        title=f"Security review: {trainer_name} ({severity})",
        body=(
            f"Trainer '{trainer_name}' submitted by {owner_email} (org: {org_id}) "
            f"failed automated security scan.\n\n"
            f"Severity: {severity}\nSummary: {summary}\n\n"
            f"Issues:\n" + "\n".join(f"- {i}" for i in issues)
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
