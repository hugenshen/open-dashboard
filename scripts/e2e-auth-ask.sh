#!/usr/bin/env bash
# P008/P009 auth + conversation CRUD gates (P011: Agent is dsh, not Python harness).
# Requires Java :8082. Optional: DSH on :3090 for smoke reachability.
set -euo pipefail

API="${OD_API:-http://127.0.0.1:8082}"
DSH="${OD_DSH:-http://127.0.0.1:3090}"
PASS=0
FAIL=0

ok() { PASS=$((PASS + 1)); echo "PASS  $1"; }
fail() { FAIL=$((FAIL + 1)); echo "FAIL  $1"; }

login() {
  local user="$1" pass="$2" jar="$3"
  rm -f "$jar"
  local code
  code=$(curl -sS -o /tmp/od-e2e-login.json -w '%{http_code}' -c "$jar" -b "$jar" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"${user}\",\"password\":\"${pass}\"}" \
    "$API/api/auth/login")
  echo "$code"
}

echo "== login three demo accounts"
for pair in "demo:demo123456:demo" "wsadmin:wsadmin123456:wsadmin" "analyst:analyst123456:analyst"; do
  IFS=: read -r u p name <<<"$pair"
  jar="/tmp/od-e2e-${name}.jar"
  code=$(login "$u" "$p" "$jar")
  if [ "$code" = "200" ]; then ok "login $name"; else fail "login $name ($code)"; cat /tmp/od-e2e-login.json; fi
done

echo "== /api/auth/me workspace visibility"
for name in demo wsadmin analyst; do
  curl -sS -b "/tmp/od-e2e-${name}.jar" "$API/api/auth/me" > "/tmp/od-e2e-me-${name}.json"
done
python3 - <<'PY'
import json
for name in ("demo", "wsadmin", "analyst"):
    with open(f"/tmp/od-e2e-me-{name}.json") as f:
        d = json.load(f)
    wss = d.get("workspaces") or []
    print(f"{name}: {len(wss)} workspaces")
PY

echo "== reject body userId"
uid_code=$(curl -sS -o /tmp/od-e2e-uid.json -w '%{http_code}' -b /tmp/od-e2e-analyst.jar \
  -H 'Content-Type: application/json' \
  -d '{"title":"x","userId":"attacker"}' \
  "$API/api/conversations")
if [ "$uid_code" = "400" ] || [ "$uid_code" = "422" ]; then ok "Java POST /conversations userId=$uid_code"; else fail "Java userId ($uid_code)"; cat /tmp/od-e2e-uid.json; fi

echo "== Java public runs gone; internal BI token"
gone=$(curl -sS -o /tmp/od-e2e-gone.json -w '%{http_code}' -b /tmp/od-e2e-analyst.jar \
  -H 'Content-Type: application/json' \
  -d '{"message":"hi"}' \
  "$API/api/conversations/any/runs")
if [ "$gone" = "410" ]; then ok "Java public runs 410"; else fail "Java runs ($gone)"; cat /tmp/od-e2e-gone.json; fi

no_tok=$(curl -sS -o /tmp/od-e2e-int.json -w '%{http_code}' "$API/api/internal/bi/datasets")
if [ "$no_tok" = "401" ]; then ok "internal BI without token 401"; else fail "internal BI ($no_tok)"; fi

bad_tok=$(curl -sS -o /tmp/od-e2e-int2.json -w '%{http_code}' -H 'X-OD-Internal-Token: wrong' "$API/api/internal/bi/datasets")
if [ "$bad_tok" = "401" ]; then ok "internal BI bad token 401"; else fail "internal BI bad token ($bad_tok)"; fi

echo "== conversation owner isolation"
iso=$(curl -sS -b /tmp/od-e2e-demo.jar -H 'Content-Type: application/json' \
  -d '{"title":"iso"}' "$API/api/conversations")
iso_id=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])' <<<"$iso")
demo_get=$(curl -sS -o /tmp/od-e2e-iso-demo.json -w '%{http_code}' -b /tmp/od-e2e-demo.jar \
  "$API/api/conversations/${iso_id}")
analyst_get=$(curl -sS -o /tmp/od-e2e-iso-analyst.json -w '%{http_code}' -b /tmp/od-e2e-analyst.jar \
  "$API/api/conversations/${iso_id}")
if [ "$demo_get" = "200" ]; then ok "owner GET conversation 200"; else fail "owner GET ($demo_get)"; cat /tmp/od-e2e-iso-demo.json; fi
if [ "$analyst_get" = "404" ]; then ok "non-owner GET conversation 404"; else fail "non-owner GET ($analyst_get)"; cat /tmp/od-e2e-iso-analyst.json; fi

echo "== dsh reachability (optional)"
dsh_code=$(curl -sS -o /dev/null -w '%{http_code}' "$DSH/" || true)
if [ "$dsh_code" = "200" ] || [ "$dsh_code" = "302" ]; then
  ok "dsh Web $DSH → $dsh_code"
else
  echo "SKIP  dsh Web ($dsh_code) — start with: cd opendashboard-dsh-harness && ./start.sh"
fi

echo
echo "RESULT  pass=$PASS fail=$FAIL"
[ "$FAIL" -eq 0 ]
