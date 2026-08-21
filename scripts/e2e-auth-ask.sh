#!/usr/bin/env bash
# P008/P009/P004 auth + askable + harness gates. Requires Java :8082 and Harness :8091.
set -euo pipefail

API="${OD_API:-http://127.0.0.1:8082}"
HARNESS="${OD_HARNESS:-http://127.0.0.1:8091}"
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

json_len() {
  python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d) if isinstance(d,list) else len(d.get("workspaces") or d.get("permissions") or []))'
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
from pathlib import Path

def load(name):
    return json.loads(Path(f"/tmp/od-e2e-me-{name}.json").read_text())

demo = load("demo")
wsadmin = load("wsadmin")
analyst = load("analyst")
print("demo workspaces", [w.get("id") for w in demo.get("workspaces") or []])
print("wsadmin workspaces", [w.get("id") for w in wsadmin.get("workspaces") or []])
print("analyst workspaces", [w.get("id") for w in analyst.get("workspaces") or []])
print("demo perms has platform", "platform:admin" in (demo.get("permissions") or demo.get("effectivePermissions") or []))
print("analyst perms", analyst.get("permissions") or analyst.get("effectivePermissions"))
Path("/tmp/od-e2e-ws-counts.json").write_text(json.dumps({
    "demo": len(demo.get("workspaces") or []),
    "wsadmin": len(wsadmin.get("workspaces") or []),
    "analyst": len(analyst.get("workspaces") or []),
}))
PY

counts=$(python3 -c 'import json; print(json.load(open("/tmp/od-e2e-ws-counts.json")))')
python3 - <<'PY'
import json
c=json.load(open("/tmp/od-e2e-ws-counts.json"))
assert c["demo"] >= 3, c
assert c["wsadmin"] == 2, c
assert c["analyst"] == 1, c
print("workspace counts ok", c)
PY
ok "workspace counts demo>=3 wsadmin=2 analyst=1"

echo "== askable sets"
for name in demo wsadmin analyst; do
  curl -sS -b "/tmp/od-e2e-${name}.jar" "$API/api/dataset/askable" > "/tmp/od-e2e-askable-${name}.json"
done
python3 - <<'PY'
import json
from pathlib import Path

def ids(name):
    data=json.loads(Path(f"/tmp/od-e2e-askable-{name}.json").read_text())
    if not isinstance(data, list):
        raise SystemExit(f"{name} askable not a list: {data}")
    return [row.get("id") for row in data]

demo, admin, analyst = ids("demo"), ids("wsadmin"), ids("analyst")
print("demo", demo)
print("wsadmin", admin)
print("analyst", analyst)
assert set(analyst).issubset(set(demo)), (analyst, demo)
assert set(admin) == set(demo) or set(admin).issubset(set(demo))
Path("/tmp/od-e2e-askable-ok").write_text("ok")
PY
ok "askable analyst ⊆ demo, three UIs share GET /dataset/askable"

echo "== analyst cannot open east workspace plaza"
east=$(curl -sS -o /tmp/od-e2e-east.json -w '%{http_code}' -b /tmp/od-e2e-analyst.jar \
  "$API/api/workspaces/workspace-east/data-plaza")
if [ "$east" = "403" ]; then ok "analyst east plaza 403"; else fail "analyst east plaza ($east)"; cat /tmp/od-e2e-east.json; fi

echo "== reject body userId"
uid_code=$(curl -sS -o /tmp/od-e2e-uid.json -w '%{http_code}' -b /tmp/od-e2e-analyst.jar \
  -H 'Content-Type: application/json' \
  -d '{"title":"x","userId":"attacker"}' \
  "$API/api/conversations")
if [ "$uid_code" = "400" ] || [ "$uid_code" = "422" ]; then ok "Java POST /conversations userId=$uid_code"; else fail "Java userId ($uid_code)"; cat /tmp/od-e2e-uid.json; fi

h_uid=$(curl -sS -o /tmp/od-e2e-huid.json -w '%{http_code}' \
  -H 'Content-Type: application/json' -H 'X-User-Id: alice' -H 'X-User-Perms: conversation:use,dataset:use' \
  -d '{"title":"x","userId":"attacker"}' \
  "$HARNESS/v1/conversations")
if [ "$h_uid" -ge 400 ]; then ok "Harness POST /v1/conversations userId=$h_uid"; else fail "Harness userId ($h_uid)"; cat /tmp/od-e2e-huid.json; fi

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

echo "== harness run without conversation:use"
cid=$(python3 -c 'import json,urllib.request; print("skip")')
created=$(curl -sS -H 'Content-Type: application/json' -H 'X-User-Id: alice' -H 'X-User-Perms: conversation:use,dataset:use' \
  -d '{"title":"gate"}' "$HARNESS/v1/conversations")
cid=$(python3 -c 'import json,sys; print(json.load(open("/dev/stdin"))["id"])' <<<"$created")
deny=$(curl -sS -o /tmp/od-e2e-deny.json -w '%{http_code}' \
  -H 'Content-Type: application/json' -H 'X-User-Id: alice' -H 'X-User-Perms: report:view' \
  -d '{"message":"GMV"}' \
  "$HARNESS/v1/conversations/${cid}/runs")
if [ "$deny" = "403" ]; then ok "harness run missing conversation:use 403"; else fail "harness run gate ($deny)"; cat /tmp/od-e2e-deny.json; fi

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

echo
echo "RESULT  pass=$PASS fail=$FAIL"
[ "$FAIL" -eq 0 ]
