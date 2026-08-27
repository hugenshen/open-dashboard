#!/usr/bin/env bash
# P011: boot OD conversation profile (dsh Web + od_* BI tools).
# Runs with cwd = DSH_HOME/runtime (empty sandbox) so sessions do not attach to the monorepo.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
export DSH_HOME="${DSH_HOME:-$ROOT/dsh-home}"
export OD_BI_BASE="${OD_BI_BASE:-http://127.0.0.1:8082}"
export OD_INTERNAL_TOKEN="${OD_INTERNAL_TOKEN:-od-dev-internal}"
# Vue AppShell — board "全屏编辑器" / native "在右侧打开" land here, not on :3090.
export OD_APP_ORIGIN="${OD_APP_ORIGIN:-http://127.0.0.1:5173}"
# Local default binds stub demo tenant (override in production with a signed/short-lived bridge).
if [[ -z "${OD_DSH_BRIDGE:-}" ]]; then
  # Local default: open perms so od_* sees the same askable set as an OD admin.
  # Production must set a signed/short-lived OD_DSH_BRIDGE from the logged-in session.
  export OD_DSH_BRIDGE='{"userId":"demo","workspaceId":"workspace-retail","perms":"*"}'
else
  export OD_DSH_BRIDGE
fi
# Listen on all interfaces (cordis.patch.yml host: 0.0.0.0). Share
# http://<lan-ip>:5173 — iframe uses the page hostname, not 127.0.0.1.
PORT="${OD_DSH_PORT:-3090}"

DSH_BIN="$ROOT/node_modules/.bin/dsh"
if [[ ! -x "$DSH_BIN" ]]; then
  echo "opendashboard-dsh-harness: run 'pnpm install' then 'pnpm approve-builds --all' first" >&2
  exit 1
fi

mkdir -p "$DSH_HOME"
# Blank runtime cwd: no .git / AGENTS.md from the Open Dashboard monorepo.
RUNTIME_CWD="${OD_DSH_RUNTIME_CWD:-$DSH_HOME/runtime}"
mkdir -p "$RUNTIME_CWD"
# Keep sandbox empty of project markers (do not create .git here).
cd "$RUNTIME_CWD"

# Prefer --no-open in automation; set OD_DSH_OPEN=1 to launch the browser.
OPEN_FLAG=(--no-open)
if [[ "${OD_DSH_OPEN:-}" == "1" ]]; then
  OPEN_FLAG=()
fi

# Trust LAN IPv4 so http://<lan-ip>:3090 /api websockets pass the browser fence.
# dsh's /api fence is not authentication; coding shells/fs are already disabled.
TRUST_HOSTS=()
if MDNS="$(scutil --get LocalHostName 2>/dev/null)"; then
  [[ -n "$MDNS" ]] && TRUST_HOSTS+=(--trusted-host "${MDNS}.local")
fi
while IFS= read -r ip; do
  [[ -n "$ip" ]] && TRUST_HOSTS+=(--trusted-host "$ip")
done < <(node -e '
const { networkInterfaces } = require("os");
const seen = new Set();
for (const list of Object.values(networkInterfaces())) {
  for (const iface of list || []) {
    const fam = iface.family;
    if (iface.internal) continue;
    if (fam !== "IPv4" && fam !== 4) continue;
    if (seen.has(iface.address)) continue;
    seen.add(iface.address);
    process.stdout.write(iface.address + "\n");
  }
}
')

exec "$DSH_BIN" --profile od-conversation --port "$PORT" "${OPEN_FLAG[@]}" "${TRUST_HOSTS[@]}" "$@"
