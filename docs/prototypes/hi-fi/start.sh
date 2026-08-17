#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8765}"
ROOT="http://127.0.0.1:${PORT}"
echo "Serving $(pwd)"
echo "工作台: ${ROOT}/workbench.html"
echo "对话:   ${ROOT}/conversation.html"
TARGET="${1:-workbench}"
case "$TARGET" in
  conversation|conv)
    URL="${ROOT}/conversation.html"
    ;;
  workbench|wb)
    URL="${ROOT}/workbench.html"
    ;;
  dashboard|dash)
    URL="${ROOT}/dashboard.html"
    ;;
  datasource|src)
    URL="${ROOT}/datasource.html"
    ;;
  dataset)
    URL="${ROOT}/dataset.html"
    ;;
  report)
    URL="${ROOT}/report.html"
    ;;
  standalone)
    URL="${ROOT}/conversation-workspace.html"
    ;;
  commercial)
    URL="${ROOT}/datasource.html"
    ;;
  *)
    URL="${ROOT}/workbench.html"
    ;;
esac
echo "Open: ${URL}"
if command -v open >/dev/null 2>&1; then
  (sleep 0.6 && open "$URL") &
elif command -v xdg-open >/dev/null 2>&1; then
  (sleep 0.6 && xdg-open "$URL") &
fi
python3 -m http.server "$PORT" --bind 127.0.0.1
