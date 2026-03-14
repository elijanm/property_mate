#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR/.."

echo "==> Linting backend..."
cd "$ROOT_DIR/apps/backend"
ruff check app/ tests/
ruff format --check app/ tests/

echo "==> Type-checking backend..."
mypy app/

echo "==> Linting worker..."
cd "$ROOT_DIR/apps/worker"
ruff check app/ tests/
ruff format --check app/ tests/

echo "==> Type-checking worker..."
mypy app/

echo "All checks passed."
