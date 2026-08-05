#!/usr/bin/env bash
# Smoke checks for a running stack (Docker or local).
set -euo pipefail

API="${API_BASE:-http://127.0.0.1:${OD_API_PORT:-8080}/api}"
WEB="${WEB_BASE:-http://127.0.0.1:${OD_WEB_PORT:-8088}}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -f "$ROOT/.env" ]]; then
  # shellcheck disable=SC1091
  set -a
  # shellcheck source=/dev/null
  source "$ROOT/.env"
  set +a
  API="${API_BASE:-http://127.0.0.1:${OD_API_PORT:-8080}/api}"
  WEB="${WEB_BASE:-http://127.0.0.1:${OD_WEB_PORT:-8088}}"
fi

AUTH=(-H "X-User-Id: demo" -H "X-User-Perms: *")

echo "== health =="
curl -sf "${API%/api}/actuator/health" | grep -q UP
echo "OK"

echo "== datasource list =="
DS=$(curl -sf "${AUTH[@]}" "$API/datasource")
echo "$DS" | python3 -c "import sys,json; d=json.load(sys.stdin); assert isinstance(d,list); print(f'{len(d)} datasource(s)')"

echo "== dataset list =="
curl -sf "${AUTH[@]}" "$API/dataset" >/dev/null
echo "OK"

echo "== catalog =="
curl -sf "${AUTH[@]}" "$API/catalog" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'dashboards' in d or isinstance(d, dict); print('OK')"

echo "== frontend =="
curl -sf "$WEB/" | grep -Eq 'app|Open Dashboard|root' || curl -sf "$WEB/" >/dev/null
echo "OK"

echo ""
echo "Smoke passed."
echo "Open: $WEB"
