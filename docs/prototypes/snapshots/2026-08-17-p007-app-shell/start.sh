#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8765}"
ROOT="http://127.0.0.1:${PORT}"
echo "Serving $(pwd)"
echo "工作台（新壳）: ${ROOT}/workbench.html"
echo "对话（产品壳内）: ${ROOT}/dashboard-commercial.html#/conversation"
TARGET="${1:-workbench}"
case "$TARGET" in
  conversation|conv)
    URL="${ROOT}/dashboard-commercial.html#/conversation"
    ;;
  workbench|wb)
    URL="${ROOT}/workbench.html"
    ;;
  dashboard|dash)
    URL="${ROOT}/dashboard-commercial.html#/dashboard"
    ;;
  standalone)
    URL="${ROOT}/conversation-workspace.html"
    ;;
  commercial)
    URL="${ROOT}/dashboard-commercial.html#/datasource"
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
