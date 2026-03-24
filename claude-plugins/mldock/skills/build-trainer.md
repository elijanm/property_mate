# /build-trainer

Generate a complete, runnable MLDock BaseTrainer subclass (neuron) using AI, write it to the workspace,
and optionally upload it to the platform.

## Pre-flight

Call `mldock_whoami`. If `authenticated: false`, run `/mldock-login` before continuing.

## Step 1 — Gather requirements

If the user's message already contains enough information (task type, data description),
infer requirements without asking again. Otherwise ask:

- **ML task**: What should the model predict or detect?
  (classification, regression, object detection, NLP, image similarity, anomaly detection, etc.)
- **Data**: What does the training data look like?
  (tabular CSV, images, text, time series, etc.)
- **Framework**: Any preference? (`sklearn`, `pytorch`, `tensorflow`, `xgboost`, or `auto`)
- **Name**: What should the neuron be called? (snake_case, e.g. `customer_churn_predictor`)
- **Data source**: How is training data provided?
  (`dataset` = platform dataset, `upload` = file per run, `s3`, `url`, `huggingface`, `memory`)

Never ask more than two questions at once.

## Step 2 — Generate

Call `mldock_generate_trainer` with the gathered information.

On success:
- Show the first 30 lines of the generated code with a brief summary of what was built.
- State the `suggested_filename`.
- Show any `suggestions` returned (refinement ideas).
- Ask: "Does this look right, or would you like to change anything?"

## Step 3 — Refine (optional, repeat as needed)

If the user wants changes, call `mldock_chat` with:
- `message`: the change request
- `current_code`: the current code
- `history`: the history array from the previous `mldock_chat` response (start empty)

Show the new code summary and updated suggestions. Repeat until satisfied.

If `mldock_chat` returns a `SyntaxError` in the code, show the error line and ask the user
whether to fix it automatically (call `mldock_chat` with "Fix the syntax error on line N").

## Step 4 — Write to disk

Call `mldock_write_trainer_file` with:
- `filename`: the suggested filename (or user-specified override)
- `code`: the final approved code
- `directory`: the current workspace directory (use `.` as default)

On success, confirm: "Written to `{path}` ({lines} lines)."

On `SyntaxError` from the write tool: show the error and use `mldock_chat` to fix it first.

## Step 5 — Upload (optional)

Ask: "Would you like to upload `{filename}` to MLDock now?"

If yes, proceed to the `/upload-trainer` skill passing `file_path`.

## Notes
- Always use `mldock_write_trainer_file`, not the built-in Write tool — it runs syntax validation.
- The generated code always extends `BaseTrainer`. Do not modify the class hierarchy.
- If the user later edits the file manually and wants to re-upload, they can run `/upload-trainer`.
