#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8765}"
ROOT="http://127.0.0.1:${PORT}"
echo "Serving $(pwd)"
echo "入口:   ${ROOT}/index.html"
echo "用户端: ${ROOT}/workbench.html"
echo "数据广场: ${ROOT}/data-market.html"
echo "管理端: ${ROOT}/workspace-admin.html"
TARGET="${1:-index}"
case "$TARGET" in
  index|home|entry)
    URL="${ROOT}/index.html"
    ;;
  login)
    URL="${ROOT}/login.html"
    ;;
  register|signup)
    URL="${ROOT}/register.html"
    ;;
  account|settings)
    URL="${ROOT}/account-settings.html"
    ;;
  conversation|conv)
    URL="${ROOT}/conversation.html"
    ;;
  data-market|data-plaza|market|plaza|datasets)
    URL="${ROOT}/data-market.html"
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
  knowledge|kb)
    URL="${ROOT}/knowledge.html"
    ;;
  admin|workspace-admin|members)
    URL="${ROOT}/workspace-admin.html"
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
    URL="${ROOT}/index.html"
    ;;
esac
echo "Open: ${URL}"
if command -v open >/dev/null 2>&1; then
  (sleep 0.6 && open "$URL") &
elif command -v xdg-open >/dev/null 2>&1; then
  (sleep 0.6 && xdg-open "$URL") &
fi
python3 -m http.server "$PORT" --bind 127.0.0.1
