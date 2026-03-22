#!/usr/bin/env python3
"""
code_scan.py — Console app that sends code to an Ollama model for security analysis.

Usage:
    OLLAMA_BASE_URL=https://ollama.fileq.io \
    OLLAMA_SECURITY_MODEL=qwen2.5-coder:7b \
    python scripts/code_scan.py [file.py]

If no file is given, a built-in example with intentional vulnerabilities is scanned.
"""

import json
import os
import sys
import textwrap
import urllib.request
import urllib.error
from datetime import datetime

# ── Config ────────────────────────────────────────────────────────────────────

BASE_URL = os.environ.get("OLLAMA_BASE_URL", "https://ollama.fileq.io").rstrip("/")
MODEL    = os.environ.get("OLLAMA_SECURITY_MODEL", "mistral:latest")

# ── ANSI colors ───────────────────────────────────────────────────────────────

RESET  = "\033[0m"
BOLD   = "\033[1m"
DIM    = "\033[2m"
RED    = "\033[91m"
YELLOW = "\033[93m"
GREEN  = "\033[92m"
CYAN   = "\033[96m"
BLUE   = "\033[94m"
GRAY   = "\033[90m"

def c(color: str, text: str) -> str:
    return f"{color}{text}{RESET}"

# ── Example code with intentional vulnerabilities ────────────────────────────

EXAMPLE_CODE = textwrap.dedent("""\
    import sqlite3
    import subprocess
    import hashlib
    import os

    SECRET_KEY = "hardcoded_secret_123"
    DB_PASSWORD = "admin123"

    def get_user(username: str):
        conn = sqlite3.connect("users.db")
        cursor = conn.cursor()
        # SQL injection: user input concatenated directly into query
        query = "SELECT * FROM users WHERE username = '" + username + "'"
        cursor.execute(query)
        return cursor.fetchone()

    def run_report(report_name: str):
        # Command injection: unsanitised input passed to shell
        result = subprocess.run(f"generate_report.sh {report_name}", shell=True, capture_output=True)
        return result.stdout.decode()

    def hash_password(password: str) -> str:
        # Weak hashing: MD5 is cryptographically broken for passwords
        return hashlib.md5(password.encode()).hexdigest()

    def read_file(path: str) -> str:
        # Path traversal: no validation that path stays within expected directory
        with open(path) as f:
            return f.read()

    def login(username: str, password: str) -> bool:
        user = get_user(username)
        if user:
            stored_hash = user[2]
            # Timing attack: == comparison leaks info via execution time
            return stored_hash == hash_password(password)
        return False

    def store_token(token: str):
        # Insecure storage: sensitive data written to world-readable /tmp
        with open("/tmp/session_token.txt", "w") as f:
            f.write(token)
""")

# ── Prompt ────────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are a security gate for an ML platform that runs user-uploaded Python trainer scripts inside a sandbox.
Your job is to detect code that attempts to attack the HOST SYSTEM — not to review the trainer's own logic.

BLOCK-level threats (severity: HIGH, risk: CRITICAL) — these MUST be flagged:
- Reading OS environment variables that may contain secrets (os.environ, os.getenv)
- Reading files outside the working directory (/etc, /proc, ~/.ssh, /var, absolute paths to system dirs)
- Making outbound HTTP/HTTPS/TCP/UDP connections to external hosts (requests, urllib, socket, httpx, aiohttp)
- Sending any data over the network (POST, PUT, upload, socket.connect to non-localhost)
- Creating zip/tar archives and transmitting them
- Executing shell commands (subprocess, os.system, os.popen, exec, eval with external input)
- Loading/deserializing untrusted data from external sources (pickle.loads on network data)
- Writing to paths outside the working directory

WARN-level issues (severity: MEDIUM or LOW) — flag but do NOT treat as BLOCK:
- Internal code quality issues that only affect the trainer's own data (SQL injection in trainer queries, weak hashing)
- Use of deprecated APIs, missing error handling

For each finding output exactly one JSON object per line:
{"severity":"HIGH|MEDIUM|LOW","type":"<threat category>","line":<line_number or null>,"title":"<short title>","detail":"<one sentence>","fix":"<one sentence>","block":true|false}

Set "block":true ONLY for BLOCK-level threats. Set "block":false for WARN-level issues.

After all findings output exactly one summary line:
{"summary":true,"total":<n>,"high":<n>,"medium":<n>,"low":<n>,"blocked":<n>,"risk":"CRITICAL|HIGH|MEDIUM|LOW|SAFE"}

Set risk to CRITICAL if any block:true finding exists.
Output ONLY these JSON lines — no markdown, no prose, no code blocks.\
"""

# ── Ollama API call ───────────────────────────────────────────────────────────

def call_ollama(code: str) -> str:
    url = f"{BASE_URL}/v1/chat/completions"
    payload = json.dumps({
        "model": MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user",   "content": f"Scan this code:\n\n```python\n{code}\n```"},
        ],
        "temperature": 0.1,
        "stream": False,
    }).encode()

    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json", "User-Agent": "curl/7.64.1"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        body = json.loads(resp.read())
    return body["choices"][0]["message"]["content"].strip()

# ── Parse response ────────────────────────────────────────────────────────────

def parse_response(raw: str):
    findings = []
    summary  = None

    def _ingest(obj):
        nonlocal summary
        if isinstance(obj, list):
            for item in obj:
                _ingest(item)
        elif isinstance(obj, dict):
            if obj.get("summary"):
                summary = obj
            elif "severity" in obj or "title" in obj:
                findings.append(obj)

    i, n = 0, len(raw)
    while i < n:
        if raw[i] not in ('{', '['):
            i += 1
            continue
        open_ch  = raw[i]
        close_ch = '}' if open_ch == '{' else ']'
        depth, j = 0, i
        in_str, escape = False, False
        while j < n:
            ch = raw[j]
            if escape:
                escape = False
            elif ch == '\\' and in_str:
                escape = True
            elif ch == '"':
                in_str = not in_str
            elif not in_str:
                if ch == open_ch:
                    depth += 1
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

    return findings, summary

# ── Display ───────────────────────────────────────────────────────────────────

SEV_COLOR = {"HIGH": RED, "MEDIUM": YELLOW, "LOW": CYAN}
RISK_COLOR = {
    "CRITICAL": RED, "HIGH": RED, "MEDIUM": YELLOW, "LOW": CYAN, "SAFE": GREEN,
}

def sev_badge(sev: str) -> str:
    col = SEV_COLOR.get(sev, GRAY)
    return c(col, c(BOLD, f"[{sev:<6}]"))

def display_header(filename: str, model: str):
    width = 70
    print()
    print(c(BOLD, "━" * width))
    print(c(BOLD, c(CYAN, "  🔍  CODE SECURITY SCAN")))
    print(c(DIM,  f"  Model   : {model}"))
    print(c(DIM,  f"  Target  : {filename}"))
    print(c(DIM,  f"  Time    : {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"))
    print(c(BOLD, "━" * width))

def display_findings(findings: list):
    if not findings:
        print(c(GREEN, "\n  ✓  No vulnerabilities found.\n"))
        return

    print()
    for i, f in enumerate(findings, 1):
        sev    = f.get("severity", "UNKNOWN")
        title  = f.get("title",  "Untitled")
        ftype  = f.get("type",   "")
        line   = f.get("line")
        detail = f.get("detail", "")
        fix    = f.get("fix",    "")

        loc = f"line {line}" if line else "—"
        print(f"  {sev_badge(sev)}  {c(BOLD, title)}")
        print(f"           {c(DIM, ftype)}  {c(GRAY, loc)}")
        print(f"           {detail}")
        print(f"           {c(GREEN, '↳ Fix:')} {fix}")
        print()

def display_summary(summary: dict | None, findings: list):
    width = 70
    print(c(BOLD, "━" * width))
    if not summary:
        total = len(findings)
        high  = sum(1 for f in findings if f.get("severity") == "HIGH")
        med   = sum(1 for f in findings if f.get("severity") == "MEDIUM")
        low   = sum(1 for f in findings if f.get("severity") == "LOW")
        risk  = "HIGH" if high else ("MEDIUM" if med else ("LOW" if low else "SAFE"))
        summary = {"total": total, "high": high, "medium": med, "low": low, "risk": risk}

    risk_col = RISK_COLOR.get(summary.get("risk", ""), GRAY)
    print(
        f"  {c(BOLD, 'RESULT')}  "
        f"{c(risk_col, c(BOLD, summary.get('risk', '?')))}  "
        f"│  total {summary.get('total', 0)}  "
        f"│  {c(RED, str(summary.get('high',0)) + ' high')}  "
        f"│  {c(YELLOW, str(summary.get('medium',0)) + ' medium')}  "
        f"│  {c(CYAN, str(summary.get('low',0)) + ' low')}"
    )
    print(c(BOLD, "━" * width))
    print()

def display_raw(raw: str):
    print(c(BOLD, "\n── Raw LLM response ─────────────────────────────────"))
    for line in raw.splitlines():
        print(c(DIM, "  " + line))
    print()

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) > 1:
        path = sys.argv[1]
        try:
            with open(path) as f:
                code = f.read()
            filename = path
        except OSError as e:
            print(c(RED, f"Cannot read file: {e}"), file=sys.stderr)
            sys.exit(1)
    else:
        code     = EXAMPLE_CODE
        filename = "<built-in example>"

    display_header(filename, MODEL)

    print(c(DIM, f"\n  Sending {len(code.splitlines())} lines to {BASE_URL} …\n"))

    try:
        raw = call_ollama(code)
    except urllib.error.URLError as e:
        print(c(RED, f"\n  ✗  Cannot reach Ollama: {e}"), file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(c(RED, f"\n  ✗  Error: {e}"), file=sys.stderr)
        sys.exit(1)

    findings, summary = parse_response(raw)

    if not findings:
        # Model didn't produce clean JSON — show raw output
        display_raw(raw)
        print(c(YELLOW, "  ⚠  Could not parse structured findings from model output above."))
        print()
        return

    display_findings(findings)
    display_summary(summary, findings)

    # Exit code reflects risk level
    risk = (summary or {}).get("risk", "SAFE")
    sys.exit(1 if risk in ("CRITICAL", "HIGH") else 0)


if __name__ == "__main__":
    main()
