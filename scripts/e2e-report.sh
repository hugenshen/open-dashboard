#!/usr/bin/env bash
# Legacy report E2E (expects seed charts / 销售周报). Prefer ./scripts/smoke.sh for Docker 开箱即用.
# Requires API: docker compose up --build  OR local spring-boot:run
set -euo pipefail

API="${API_BASE:-http://127.0.0.1:8080/api}"
WEB="${WEB_BASE:-http://127.0.0.1:8088}"

echo "== E2E: catalog =="
CATALOG=$(curl -sf "$API/catalog")
echo "$CATALOG" | grep -q '"dashboards"' || { echo "catalog missing dashboards"; exit 1; }
echo "$CATALOG" | grep -q '区域销售额' || { echo "catalog missing seed chart"; exit 1; }

echo "== E2E: report list =="
LIST=$(curl -sf "$API/report")
echo "$LIST" | grep -q '销售周报' || { echo "report list missing seed"; exit 1; }

echo "== E2E: report get =="
DETAIL=$(curl -sf "$API/report/1")
echo "$DETAIL" | grep -q '"contentId"' || { echo "report detail invalid"; exit 1; }
CONTENT_ID=$(echo "$DETAIL" | python3 -c "import sys,json; print(json.load(sys.stdin)['meta']['contentId'])")

echo "== E2E: chartQuery dashboard ref =="
curl -sf -X POST "$API/chartQuery/query" \
  -H 'Content-Type: application/json' \
  -d '{"dashboardId":"1","chartId":"101","view":"draft","context":{"filters":[],"linkages":[]}}' \
  | grep -q 'categories' || { echo "chartQuery dashboard failed"; exit 1; }

echo "== E2E: chartQuery inline =="
curl -sf -X POST "$API/chartQuery/query" \
  -H 'Content-Type: application/json' \
  -d '{"client":"report","inline":{"datasetId":"ds_sales","chartType":"bar","encode":{"category":"region","value":"amount","agg":"SUM"}},"context":{"filters":[],"linkages":[]}}' \
  | grep -q 'categories' || { echo "chartQuery inline failed"; exit 1; }

echo "== E2E: save doc with reportChart =="
DOC='{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"E2E test"}]},{"type":"reportChart","attrs":{"id":"rc_e2e","source":"inline","datasetId":"ds_sales","chartType":"bar","encode":{"category":"region","value":"amount","agg":"SUM"},"title":"E2E Chart","height":320}}]}'
SAVE=$(curl -sf -X PUT "$API/report/1/doc" \
  -H 'Content-Type: application/json' \
  -d "{\"content\":$DOC,\"contentId\":\"$CONTENT_ID\"}")
NEW_CID=$(echo "$SAVE" | python3 -c "import sys,json; print(json.load(sys.stdin)['meta']['contentId'])")
[[ "$NEW_CID" != "$CONTENT_ID" ]] || { echo "contentId not incremented"; exit 1; }

echo "== E2E: publish =="
curl -sf -X POST "$API/report/1/publish" | grep -q 'published' || { echo "publish failed"; exit 1; }

echo "== E2E: frontend index =="
curl -sf "$WEB/" | grep -q '<div id="app">' || curl -sf "$WEB/" | grep -q 'app' || { echo "frontend not serving"; exit 1; }

echo ""
echo "All E2E checks passed."
echo "Open report editor: $WEB/reports/1/edit"
