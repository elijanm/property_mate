#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$SCRIPT_DIR/../infra/docker"

if [ ! -f "$INFRA_DIR/.env" ]; then
  echo "No .env found in infra/docker/. Copying from .env.example..."
  cp "$INFRA_DIR/.env.example" "$INFRA_DIR/.env"
  echo "Edit infra/docker/.env before running again if needed."
fi

echo "Starting PMS infrastructure..."
cd "$INFRA_DIR"
echo "docker compose up -d $INFRA_DIR"
docker compose up -d "$@"

echo ""
echo "Services:"
echo "  Backend:    http://localhost:8000"
echo "  API docs:   http://localhost:8000/api/docs"
echo "  Frontend:   http://localhost:5173"
echo "  RabbitMQ:   http://localhost:15672  (guest/guest)"
echo "  MinIO:      http://localhost:9001   (minioadmin/minioadmin)"
echo "  Prometheus: http://localhost:9090"
echo "  Grafana:    http://localhost:3000   (admin/admin)"
