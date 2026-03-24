# MLDock Plugin — Instructions for Claude

This plugin connects Claude Code to the MLDock ML training platform.
You have access to 12 MCP tools and 3 slash-command skills.

---

## Tool Reference

| Tool | Auth? | Purpose |
|---|---|---|
| `mldock_login` | No | Authenticate and save JWT session |
| `mldock_whoami` | No | Show current session (disk-only) |
| `mldock_generate_trainer` | Yes | AI-generate a complete BaseTrainer subclass (neuron) |
| `mldock_chat` | Yes | Multi-turn AI refinement of neuron code |
| `mldock_write_trainer_file` | No | Write code to .py file with syntax check |
| `mldock_upload_trainer` | Yes | Upload .py neuron file to MLDock |
| `mldock_list_trainers` | Yes | List registered neurons |
| `mldock_get_trainer` | Yes | Get neuron details |
| `mldock_trigger_training` | Yes | Start a training job |
| `mldock_job_status` | Yes | Check training job status |
| `mldock_list_datasets` | Yes | List available datasets |
| `mldock_list_deployments` | Yes | List deployed model versions |

---

## Authentication Rules

- **ALWAYS** call `mldock_whoami` before any auth-required tool if you are not sure the user is logged in.
- If `mldock_whoami` returns `authenticated: false`, run `/mldock-login` before continuing.
- If ANY tool returns `{ "auth_error": true }`, immediately run `/mldock-login` — the session has expired.
- NEVER ask for the user's password outside the `/mldock-login` skill.
- NEVER display, log, or repeat passwords in any message.

---

## Neuron File Rules

Every valid MLDock neuron file must:
- Be a `.py` file
- Contain a class that extends `BaseTrainer` from `app.abstract.base_trainer`
- Define class attributes: `name` (snake_case), `version` (semver), `description`, `framework`, `category` (dict)
- Define all four methods: `preprocess()`, `train()`, `predict()`, `evaluate()`
- Import heavy packages (`torch`, `sklearn`, `numpy`, etc.) **inside method bodies**, not at module level

**Always use `mldock_write_trainer_file`** (not the built-in Write tool) — it runs a compile-time syntax check before anything touches disk.

---

## Workflow Patterns

### Generate + Upload (happy path)
```
mldock_whoami → check auth
mldock_generate_trainer(description, framework)
  → show code summary → ask for approval / refinements
mldock_chat (if refinements needed, repeat)
mldock_write_trainer_file(filename, code)
mldock_upload_trainer(file_path)
  → if approved: mldock_trigger_training(trainer_name)
  → mldock_job_status (poll until is_terminal: true)
```

### Upload existing file
```
mldock_upload_trainer(file_path)
  → if approved: offer mldock_trigger_training
  → if pending_review: inform user admin approval required
```

### Check training progress
```
mldock_job_status(job_id)
  → is_terminal: false → offer to poll again (ask user, do NOT auto-loop)
  → is_terminal: true, status: completed → show metrics
  → is_terminal: true, status: failed → show error, offer to re-trigger
```

---

## Error Handling

| Error | Meaning | Action |
|---|---|---|
| `auth_error: true` | Session expired | Run `/mldock-login` |
| HTTP 402 | Wallet balance too low | Tell user to top up MLDock wallet |
| HTTP 403 | Wrong role | Explain engineer/admin role required |
| HTTP 404 on neuron | Neuron not found | Call `mldock_list_trainers` to show options |
| Security violation on upload | Blocked code patterns | Fix via `mldock_chat` |
| SyntaxError on write | Python syntax error | Fix via `mldock_chat` before writing |
| Connection error | Server unreachable | Ask user to check `MLDOCK_BASE_URL` |

**Blocked code patterns in neurons** (will be rejected on upload):
`subprocess`, `socket`, `os.system`, `eval`/`exec` with dynamic strings,
`__import__`, `ctypes`, `pickle.loads`

---

## Job Polling Rules

- Always ask the user before polling — do NOT auto-poll in a loop.
- Stop after **20 polls** maximum.
- Report status at each poll: queued → running → completed/failed.
- If still running after 20 polls, stop and tell the user to check manually.

---

## `mldock_chat` History

`mldock_chat` returns a `history` array in its response. Pass this back as the `history`
argument in the next `mldock_chat` call to maintain conversation context. Start with `[]`.
