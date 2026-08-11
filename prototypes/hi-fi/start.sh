#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8765}"
ROOT="http://127.0.0.1:${PORT}"
echo "Serving $(pwd)"
echo "整体产品高保（含对话）: ${ROOT}/dashboard-commercial.html#/conversation"
echo "对话单页（调试）:         ${ROOT}/conversation-workspace.html"
TARGET="${1:-commercial}"
case "$TARGET" in
  conversation|conv)
    URL="${ROOT}/dashboard-commercial.html#/conversation"
    ;;
  workbench|wb)
    URL="${ROOT}/dashboard-commercial.html#/workbench"
    ;;
  dashboard|dash)
    URL="${ROOT}/dashboard-commercial.html#/dashboard"
    ;;
  standalone)
    URL="${ROOT}/conversation-workspace.html"
    ;;
  *)
    URL="${ROOT}/dashboard-commercial.html#/conversation"
    ;;
esac
echo "Open: ${URL}"
if command -v open >/dev/null 2>&1; then
  (sleep 0.6 && open "$URL") &
elif command -v xdg-open >/dev/null 2>&1; then
  (sleep 0.6 && xdg-open "$URL") &
fi
python3 -m http.server "$PORT" --bind 127.0.0.1
