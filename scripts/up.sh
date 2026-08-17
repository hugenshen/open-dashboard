#!/usr/bin/env bash
# One-shot: bring up Postgres + API + Web (out of the box).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=compose.sh
source "$ROOT/scripts/compose.sh"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

# shellcheck disable=SC1091
set -a
source .env
set +a

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install Docker Desktop or Colima, then retry."
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not running. Start it and retry (e.g. colima start)."
  exit 1
fi

echo "== Building images =="
compose build

echo "== Starting stack =="
compose up -d

echo "== Waiting for API health =="
API_PORT="${OD_API_PORT:-8080}"
WEB_PORT="${OD_WEB_PORT:-8088}"
ok=0
for i in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:${API_PORT}/actuator/health" | grep -q UP; then
    ok=1
    break
  fi
  sleep 2
done
if [[ "$ok" -ne 1 ]]; then
  echo "API did not become healthy in time. Check: ./scripts/logs.sh backend"
  exit 1
fi

echo ""
echo "Open Dashboard is ready."
echo "  Web UI : http://127.0.0.1:${WEB_PORT}"
echo "  Help   : http://127.0.0.1:${WEB_PORT}/help/"
echo "  API    : http://127.0.0.1:${API_PORT}/api"
echo "  Health : http://127.0.0.1:${API_PORT}/actuator/health"
echo "  PG     : localhost:${OD_PG_PORT:-5434}  user/db=${POSTGRES_USER:-opendashboard}"
echo ""
echo "Useful commands:"
echo "  ./scripts/logs.sh          # follow logs"
echo "  ./scripts/smoke.sh         # API smoke"
echo "  ./scripts/down.sh          # stop stack"
echo "  ./scripts/down.sh --volumes  # stop + wipe DB volume"
