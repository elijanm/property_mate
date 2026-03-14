# ML Studio — Code Editor Guide

**Feature:** In-browser Python trainer editor
**Route:** `/editor` tab in the ML Studio UI
**Backend:** `GET|POST /api/v1/editor/*`
**Source:** `apps/ml/app/api/v1/editor.py`

---

## Table of Contents

1. [Overview](#1-overview)
2. [UI Layout](#2-ui-layout)
3. [File Explorer](#3-file-explorer)
4. [Editor Tabs & Monaco](#4-editor-tabs--monaco)
5. [Toolbar Actions](#5-toolbar-actions)
6. [Run Mechanism](#6-run-mechanism)
7. [Security Scanner](#7-security-scanner)
8. [Log Streaming (SSE)](#8-log-streaming-sse)
9. [Dataset Datasource](#9-dataset-datasource)
10. [Dataset Autofill](#10-dataset-autofill)
11. [Quota & Wallet Bar](#11-quota--wallet-bar)
12. [Writing a Trainer from Scratch](#12-writing-a-trainer-from-scratch)
13. [Troubleshooting](#13-troubleshooting)
14. [API Reference](#14-api-reference)

**Related guides:**
- [Image Classifier Guide](./image-classifier-guide.md) — step-by-step for training image classifiers using `DatasetDataSource`

---

## 1. Overview

The Code Editor lets you write, save, and run Python trainer plugins directly in the browser — no local Python install required. Trainers run inside the `ml-service` container and stream logs back in real time via Server-Sent Events (SSE).

| Property | Detail |
|---|---|
| Language | Python 3.12 |
| Editor | Monaco (VS Code engine) |
| Execution | Direct asyncio subprocess — **no Celery queue** |
| Security | AST-based pre-execution scanner |
| Log delivery | SSE (`event: log`, `event: done`, `event: error`) |
| Plugin directory | `/app/trainers/` (Docker named volume `ml_trainer_plugins`) |
| Min. role to save/run | `engineer` or `admin` |
| Min. role to read | `viewer` |

---

## 2. UI Layout

```
┌─────────────────────────────────────────────────────────┐
│  Quota bar  (balance · local CPU hrs · reset date)      │
├─────────────────────────────────────────────────────────┤
│  Toolbar: [+ New File]  [Dataset ▾]  [Save]  [▶ Run]   │
│           [Deploy]  [↺ Refresh]                         │
├──────────┬──────────────────────────────────────────────┤
│          │  Tab bar: file1.py  ×   file2.py  ×  …       │
│  File    ├──────────────────────────────────────────────┤
│  Explorer│                                              │
│  (tree)  │     Monaco editor (Python, dark theme)       │
│          │                                              │
│          ├──────────────────────────────────────────────┤
│          │  Output panel  (collapsible, SSE logs)       │
└──────────┴──────────────────────────────────────────────┘
```

---

## 3. File Explorer

- Shows the full file/folder tree of `/app/trainers/` inside the container.
- Click a **file** to open it in a new tab.
- Click a **folder** to expand/collapse it.
- Hover any file row → a 🗑 icon appears; click to delete (with confirmation dialog).
- Click **↺ Refresh** to reload the tree after external changes.

The explorer auto-refreshes after every save and after creating a new file.

---

## 4. Editor Tabs & Monaco

- Multiple files can be open simultaneously as tabs.
- A **blue dot** on a tab indicates unsaved changes.
- **Ctrl/Cmd + S** saves the active file.
- Monaco features: line numbers, bracket colorization, `renderWhitespace: selection`, 4-space tabs, automatic layout (resizes with the panel).

---

## 5. Toolbar Actions

| Button | Behaviour |
|---|---|
| **+ New File** | Opens a dialog; enter a filename and choose *Empty* or *BaseTrainer template*. Creates the file and opens it as a new tab. |
| **Dataset ▾** | Dropdown of all datasets in your org. Selecting one calls the autofill endpoint and opens a pre-wired trainer as a new tab (see §10). |
| **Save** | Saves the active tab to `/app/trainers/`. Also triggers a plugin scan so the trainer is immediately registered. |
| **▶ Run** | Validates → saves → runs the trainer in the active tab (see §6). |
| **Deploy** | Navigates to the Deploy page (separate workflow). |
| **↺ Refresh** | Reloads the file tree. |

---

## 6. Run Mechanism

### Flow

```
[▶ Run clicked]
     │
     ▼
POST /editor/validate   ← AST security scan + syntax check + trainer name detection
     │  violation → log error, abort
     ▼
POST /editor/run        ← saves file, creates asyncio.Queue, spawns background task
     │
     ▼  {job_id} returned
EventSource /editor/run/{job_id}/stream
     │
     ▼
Background task: asyncio.create_subprocess_exec(python -c <runner_script>)
     │  stdout/stderr → in-memory queue → SSE
     ▼
Output panel shows log lines in real time
```

### What runs inside the subprocess

```python
import sys, asyncio
sys.path.insert(0, '/app')

async def _main():
    from app.core.database import init_db
    from app.services.registry_service import scan_and_register_plugins, get_trainer_class
    from app.abstract.base_trainer import TrainingConfig

    await init_db()
    await scan_and_register_plugins()          # re-scans /app/trainers/

    cls = get_trainer_class("<trainer_name>")  # finds your class by name attribute
    trainer = cls()
    config = TrainingConfig()                  # config_overrides applied here

    raw = await trainer.data_source.load()
    preprocessed = trainer.preprocess(raw)
    result = trainer.train(preprocessed, config)

asyncio.run(_main())
```

Environment: `PYTHONUNBUFFERED=1`, `PYTHONPATH=/app`, `cwd=/app`.

### Trainer name detection

The validate endpoint walks the Python AST to find `name = "..."` class attribute assignments. The **first match** is used as `trainer_name` for the run. This is more reliable than using the filename.

```python
class MyClassifier(BaseTrainer):
    name = "my_classifier"   # ← this value is extracted by the validator
```

### Queue lifecycle

| Step | State |
|---|---|
| `POST /editor/run` returns | Queue created in `_RUN_QUEUES[job_id]` before response |
| Background task | Pushes `{event, data}` dicts; pushes `None` sentinel on completion |
| SSE generator | Waits up to 3 s for queue to appear; drains it; pops queue in `finally` |

This design means: even if the subprocess exits before the SSE client connects (fast failures), the client still receives all log lines because they are buffered in the queue.

---

## 7. Security Scanner

Before any execution, `_security_check(code)` walks the Python AST and rejects:

| Pattern | Examples blocked |
|---|---|
| **Blocked imports** | `subprocess`, `socket`, `ctypes`, `cffi`, `multiprocessing`, `pty` |
| **Dangerous `os.*` calls** | `os.system()`, `os.popen()`, `os.fork()`, `os.execv()`, `os.kill()`, `os.unlink()` |
| **Dynamic eval/exec** | `eval(var)`, `exec(compiled)`, `__import__(name)` |
| **File writes outside `/tmp`** | `open("any/path", "w")` where path doesn't start with `/tmp` |
| **Unsafe deserialization** | `pickle.loads()`, `pickle.load()` |

If a violation is detected the file is **not executed**; the error is shown in the Output panel.

> **Note:** The scanner is AST-based, not a full sandbox. It prevents common attack patterns but is not a substitute for trusting the code author.

**Working around false positives:**

| Situation | Fix |
|---|---|
| Need to write a temp file | Use `open("/tmp/myfile.csv", "w")` |
| Need HTTP requests | `requests` is allowed; `socket` is not |
| Need to load a model | Use `joblib.load()` or `safetensors` instead of `pickle.loads()` |

---

## 8. Log Streaming (SSE)

Endpoint: `GET /api/v1/editor/run/{job_id}/stream`

Authentication — either:
- `Authorization: Bearer <jwt>` header, **or**
- `?token=<jwt>` query parameter (required for browser `EventSource`)

### SSE event types

| Event | Payload | When |
|---|---|---|
| `connected` | `{"job_id": "..."}` | Stream opened successfully |
| `log` | `{"line": "..."}` | Each stdout/stderr line from subprocess |
| `done` | `{"status", "exit_code", "metrics", "error"}` | Process exited |
| `error` | `{"msg": "..."}` | Queue not found, or stream-level error |
| `ping` | `{}` | Keepalive every 120 s of inactivity |

`status` in `done` is either `"completed"` (exit code 0) or `"failed"` (exit code ≠ 0).

### Output panel colour coding

| Colour | Meaning |
|---|---|
| Blue | `connected` / start messages |
| White | `log` lines |
| Green | `done` (completed) |
| Red | `error` or `done` (failed) |

---

## 9. Dataset Datasource

`DatasetDataSource` loads collected field entries from an ML Dock dataset into a flat Python list.

```python
from app.abstract.data_source import DatasetDataSource

data_source = DatasetDataSource(dataset_id="<mongo-object-id>")
```

### Data shape

Each `DatasetEntry` document is **one field value** submitted by **one collector**. There is no `submission_id`. The natural grouping key is `collector_id`.

`load()` returns a list of dicts:

```python
{
    "entry_id":       str,          # MongoDB _id of the entry document
    "field_id":       str,          # which field this value belongs to
    "field_label":    str,          # human-readable field name
    "field_type":     str,          # "text" | "image" | "number" | ...
    "text_value":     str | None,   # text / number fields
    "file_url":       str | None,   # S3 presigned URL for image/file fields
    "file_key":       str | None,   # raw S3 object key
    "file_mime":      str | None,
    "description":    str | None,
    "captured_at":    str,
    "collector_id":   str,
    "collector_name": str,
    "points_awarded": int,
}
```

### Pivoting in `preprocess()`

To get a training DataFrame, group by `collector_id`:

```python
def preprocess(self, raw):
    rows = {}
    for entry in raw:
        key = entry.get("collector_id") or entry.get("entry_id", "?")
        rows.setdefault(key, {})
        rows[key][entry["field_id"]] = (
            entry.get("text_value") or entry.get("file_url")
        )
    import pandas as pd
    df = pd.DataFrame(list(rows.values()))
    # df columns = field UUIDs; df rows = one per collector
    print(f"[preprocess] {len(df)} rows. Columns: {list(df.columns)}")
    return df
```

Collectors who skipped a field will have `NaN` for that column.

### Image fields

`file_url` is an S3 presigned URL. `auto_train_tabular` cannot process URLs — implement custom download logic in `train()`. See the [Image Classifier Guide](./image-classifier-guide.md).

---

## 10. Dataset Autofill

The **Dataset ▾** dropdown calls `GET /api/v1/editor/datasets/{id}/autofill` and opens generated code as a new tab.

Generated code includes:
- `DatasetDataSource` with the correct `dataset_id`
- Docstring listing all field IDs → labels
- `preprocess()` grouped by `collector_id`
- `label_col` defaulting to the **last** field's ID (typically the target added last)

**Always verify after autofill:**

1. Read the docstring to find your label field's UUID.
2. Set `label_col` in `train()` to that UUID.
3. Confirm the columns printed by `preprocess()` include your label column.
4. If your dataset has image fields, replace `auto_train_tabular` with image-specific logic.

---

## 11. Quota & Wallet Bar

| Indicator | Description |
|---|---|
| `$X.XX USD` | Spendable credits for cloud GPU runs |
| `$X.XX held` | Credits reserved for in-progress jobs |
| Local progress bar | `local_used_seconds / local_quota_seconds` |
| `X.Xh / Yh` | CPU training hours used / total quota this period |
| `resets <date>` | When the local quota counter resets |
| `Runs on local CPU` | Direct runs use the `ml-service` container CPU, not cloud GPU |

Progress bar: green < 50 %, amber 50–80 %, red > 80 %.

---

## 12. Writing a Trainer from Scratch

### Quickstart

1. **+ New File** → `my_trainer.py` → **BaseTrainer template**
2. Edit:

```python
from app.abstract.base_trainer import BaseTrainer, TrainingConfig
from app.abstract.data_source import InMemoryDataSource

class MyTrainer(BaseTrainer):
    name = "my_trainer"          # must be unique across all plugins
    version = "1.0.0"
    description = "What this model does"
    framework = "sklearn"

    data_source = InMemoryDataSource()  # replace with your source

    def preprocess(self, raw):
        return raw  # transform raw → training-ready

    def train(self, preprocessed, config: TrainingConfig):
        return self.auto_train_tabular(preprocessed, "label_col", config)

    def predict(self, model, inputs):
        pred = model.predict([list(inputs.values())])[0]
        return {"label": str(pred)}
```

3. **▶ Run**

### Available data sources

| Class | When to use |
|---|---|
| `InMemoryDataSource` | Testing; returns `[]` |
| `MongoDBDataSource` | Any MongoDB collection |
| `S3DataSource` | CSV/JSON files in S3/MinIO |
| `DatasetDataSource` | Entries collected via ML Dock dataset collector |

### `auto_train_tabular(df, label_col, config)`

Tries RandomForest, GradientBoosting, LogisticRegression → keeps the best by cross-validated score.
- Handles string columns (LabelEncoder), missing values (imputation), train/test split.
- Returns a fitted sklearn Pipeline.
- Logs accuracy and classification report to stdout.

**Not suitable for image data** — implement custom `train()` for image classifiers (see [Image Classifier Guide](./image-classifier-guide.md)).

---

## 13. Troubleshooting

### "Run not found or already finished"
The SSE connected after the queue was cleaned up. Current implementation retries for 3 seconds. If you still see this, check for immediate syntax or import errors — the job may have exited in < 3 s.

### "Trainer 'xyz' not registered"
The scanner couldn't load your class. Common causes:
- `name` attribute is missing or not a string literal
- Import error in the file (check the traceback)
- Saved with a syntax error

### "Label column 'uuid' not found"
The `label_col` UUID has no data collected. Options:
- Collect data for that field
- Change `label_col` to a UUID from the columns printed by `preprocess()`

### "Only N rows remain after dropping NaN labels"
Need at least 2 complete rows (image + label both filled). Collect more data or choose a field with more coverage.

### Security violation
See §7 for blocked patterns and workarounds.

### "IndentationError in runner script"
Upgrade `ml-service` to the latest image — this was a template generation bug now fixed.

---

## 14. API Reference

Base path: `/api/v1/editor`. All endpoints require `Authorization: Bearer <jwt>`.

### File operations

| Method | Path | Min role | Description |
|---|---|---|---|
| `GET` | `/files` | viewer | File tree of `/app/trainers/` |
| `GET` | `/files/content?path=<rel>` | viewer | Read file content |
| `POST` | `/files` | engineer | Save `{path, content}` |
| `DELETE` | `/files?path=<rel>` | engineer | Delete file or directory |
| `POST` | `/files/new` | engineer | Create `{path, template: blank\|trainer}` |

### Validation & run

| Method | Path | Min role | Description |
|---|---|---|---|
| `POST` | `/validate` | viewer | `{path, content}` → `{valid, trainers[], error, warnings[]}` |
| `POST` | `/run` | engineer | `{trainer_name, content, path, config_overrides?}` → `{job_id, status}` |
| `GET` | `/run/{job_id}/stream` | viewer | SSE log stream (also accepts `?token=<jwt>`) |

### Datasets

| Method | Path | Min role | Description |
|---|---|---|---|
| `GET` | `/datasets` | viewer | List org datasets |
| `GET` | `/datasets/{id}/autofill` | viewer | Generate trainer boilerplate |

### `POST /run` body

```json
{
  "trainer_name": "my_trainer",
  "content": "class MyTrainer(BaseTrainer):\n    name = \"my_trainer\"\n    ...",
  "path": "my_trainer.py",
  "config_overrides": {
    "epochs": 50
  }
}
```

### SSE stream example

```
event: connected
data: {"job_id": "b573b482-9a63-4cda-a0e0-855044daccc8"}

event: log
data: {"line": "[editor] Scanning plugins..."}

event: log
data: {"line": "[preprocess] 12 rows. Columns: ['1033b639-...', 'a8135100-...']"}

event: done
data: {"status": "completed", "exit_code": 0, "metrics": {}, "error": null}
```

Failure:

```
event: done
data: {"status": "failed", "exit_code": 1, "error": "Process exited with code 1"}
```
