#!/usr/bin/env bash
# Stop the Docker stack. Pass --volumes to also delete Postgres data.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=compose.sh
source "$ROOT/scripts/compose.sh"

if [[ "${1:-}" == "--volumes" || "${1:-}" == "-v" ]]; then
  compose down -v
  echo "Stack stopped and volumes removed."
else
  compose down
  echo "Stack stopped (data volume kept)."
fi
