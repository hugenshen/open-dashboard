#!/usr/bin/env bash
# Tail compose logs (optional service name: postgres|backend|frontend).
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

compose logs -f --tail=200 "$@"
