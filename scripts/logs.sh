#!/usr/bin/env bash
# Tail compose logs (optional service name: postgres|backend|frontend).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=compose.sh
source "$ROOT/scripts/compose.sh"

compose logs -f --tail=200 "$@"
