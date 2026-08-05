#!/usr/bin/env bash
# Stop the Docker stack. Pass --volumes to also delete Postgres data.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

compose() {
  if command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  elif docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  else
    echo "Need docker-compose or Docker Compose plugin (docker compose)."
    exit 1
  fi
}

if [[ "${1:-}" == "--volumes" || "${1:-}" == "-v" ]]; then
  compose down -v
  echo "Stack stopped and volumes removed."
else
  compose down
  echo "Stack stopped (data volume kept)."
fi
