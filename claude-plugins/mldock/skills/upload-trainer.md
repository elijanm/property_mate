# /upload-trainer

Upload a local `.py` neuron file to the MLDock platform, then optionally trigger training
and monitor the job.

## Pre-flight

Call `mldock_whoami`. If `authenticated: false`, run `/mldock-login` before continuing.

## Step 1 — Identify the file

If the user provided a file path in their message, use it.
Otherwise ask: "Which `.py` neuron file do you want to upload? Provide the path."

## Step 2 — Upload

Call `mldock_upload_trainer` with the file path.

**On success:**
- Confirm: "Uploaded `{filename}`. Registered as neuron `{name}` (status: `{approval_status}`)."
- If `approval_status` is `pending_review`:
  - Explain: "An admin must approve this neuron before it can be trained. You'll receive a notification when it's approved."
  - Stop here unless the user asks to do something else.
- If `approval_status` is `approved`: proceed to Step 3.

**On error — security violation:**
- Show the exact violation text from the error.
- Explain which patterns are blocked: `subprocess`, `socket`, `os.system`, `eval`/`exec` with dynamic strings, `__import__`, `ctypes`, `pickle.loads`.
- Offer to fix it: "Would you like me to fix these issues using mldock_chat?"
- If yes: pass the file contents and violation to `mldock_chat` with message "Fix the security violations in this neuron code".

**On error — file not found:**
- Ask the user to confirm the path.

**On error — role forbidden (403):**
- Tell the user they need `engineer` or `admin` role to upload neurons.

## Step 3 — Trigger training (optional)

Ask: "Would you like to start a training job for `{name}` now?"

If yes:
- Ask: "Use local compute or cloud GPU?"
  - If cloud GPU, ask for GPU type (or call `mldock_list_trainers` to show available options)
- Call `mldock_trigger_training` with the neuron name and compute type.
- Confirm: "Training job queued — ID: `{job_id}`."

## Step 4 — Monitor job (optional)

Ask: "Would you like me to monitor the training job?"

If yes, poll `mldock_job_status` up to **20 times** with a note between each:
- Queued: "Still queued..."
- Running: "Training in progress..."
- Terminal: show final status and metrics.

Stop polling if `is_terminal: true` or after 20 attempts. If still running after 20 polls,
tell the user to check manually with `mldock_job_status`.

## Notes
- Roles required for upload: `engineer` or `admin`.
- `pending_review` neurons cannot be trained until an admin approves them.
- If the neuron file has syntax errors, the upload tool will catch them before sending.
