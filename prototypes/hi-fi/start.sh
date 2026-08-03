#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8765}"
URL="http://127.0.0.1:${PORT}/dashboard-commercial.html"
echo "Serving $(pwd)"
echo "Open: ${URL}"
if command -v open >/dev/null 2>&1; then
  (sleep 0.6 && open "$URL") &
elif command -v xdg-open >/dev/null 2>&1; then
  (sleep 0.6 && xdg-open "$URL") &
fi
python3 -m http.server "$PORT"
