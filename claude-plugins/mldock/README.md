# MLDock Claude Code Plugin

Build, generate, and upload ML neurons to [MLDock](https://www.mldock.io) directly from Claude Code.

## What you get

| Slash command | What it does |
|---|---|
| `/mldock-login` | Authenticate (prompts for email + password) |
| `/build-trainer` | AI-generate a neuron, refine it, write + upload |
| `/upload-trainer` | Upload an existing `.py` neuron file + trigger training |

Plus 12 MCP tools available to Claude at any time.

## Install

```bash
# 1. Clone
git clone https://github.com/your-org/mldock-claude-plugin
cd mldock-claude-plugin

# 2. Install Python deps (Python 3.11+ required)
pip install -e .

# 3. Register with Claude Code
claude mcp add /path/to/mldock-claude-plugin

# 4. Verify — in Claude Code type:
/mldock-login
```

## Quick start

```
/mldock-login
→ Enter email + password when prompted

/build-trainer
→ Describe what you want to build
→ Claude generates, refines, and writes the .py neuron file
→ Optionally uploads and starts training

/upload-trainer path/to/my_neuron.py
→ Uploads, shows approval status, optionally triggers training
```

## Session

Your JWT token is stored at `~/.mldock/session.json` (owner-only permissions).
The password is **never** stored. If your session expires, run `/mldock-login` again.

## Requirements

- Python 3.11+
- Claude Code with MCP support
- MLDock account with `engineer` or `admin` role (for uploads and training)
