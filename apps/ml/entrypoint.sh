#!/bin/bash
# ML Service entrypoint — starts ClamAV daemon then uvicorn
set -e

# ── ClamAV setup ──────────────────────────────────────────────────────────────

# Ensure directories exist with correct ownership
mkdir -p /var/run/clamav /var/lib/clamav
chown -R clamav:clamav /var/run/clamav /var/lib/clamav 2>/dev/null || true

# Update virus definitions in the background (non-blocking — don't delay startup)
# Runs fresh on every container start so definitions are always current
echo "[entrypoint] Updating ClamAV virus definitions (background)..."
(freshclam --quiet 2>/dev/null && echo "[entrypoint] ClamAV definitions updated") &

# Start ClamAV daemon (foreground until socket is ready, then background)
echo "[entrypoint] Starting ClamAV daemon..."
clamd &

# Wait up to 30s for clamd unix socket to appear
CLAMD_SOCKET="/var/run/clamav/clamd.ctl"
for i in $(seq 1 30); do
    if [ -S "$CLAMD_SOCKET" ]; then
        echo "[entrypoint] ClamAV daemon ready (${i}s)"
        break
    fi
    sleep 1
done

if [ ! -S "$CLAMD_SOCKET" ]; then
    echo "[entrypoint] WARNING: ClamAV daemon did not start — file scanning will use code analysis only"
fi

# ── Seed built-in public trainers into global_sample/ ────────────────────────
# global_sample/ is always scanned on startup and registered as public trainers
# (org_id="") that users can clone into their own workspace.
# sample_*.py files from the image are synced here on every restart so new
# trainers added to the image automatically appear in the public library.
TRAINER_DIR="${TRAINER_PLUGIN_DIR:-/app/trainers}"
IMAGE_TRAINER_SRC="/app/trainers_builtin"
GLOBAL_SAMPLE_DIR="$TRAINER_DIR/global_sample"
mkdir -p "$GLOBAL_SAMPLE_DIR"

if [ -d "$IMAGE_TRAINER_SRC" ]; then
    for f in "$IMAGE_TRAINER_SRC"/sample_*.py; do
        [ -f "$f" ] || continue
        dest="$GLOBAL_SAMPLE_DIR/$(basename "$f")"
        # Only copy if the file doesn't exist yet or the image version is newer
        if [ ! -f "$dest" ] || ! cmp -s "$f" "$dest"; then
            cp "$f" "$dest"
            echo "[entrypoint] Synced public trainer: $(basename "$f")"
        fi
    done
fi

# ── Start ML service ──────────────────────────────────────────────────────────
echo "[entrypoint] Starting PMS ML Service..."
exec "$@"
