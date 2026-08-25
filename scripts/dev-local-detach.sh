#!/usr/bin/env bash
# Detach local FE (:5173) + Java API (:8082) from the current terminal/Cursor
# process group so they survive agent abort. Logs + pids under .dev-logs/.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOGDIR="${OD_DEV_LOGDIR:-$ROOT/.dev-logs}"
mkdir -p "$LOGDIR"

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21}"
export PATH="$JAVA_HOME/bin:$PATH"

cmd="${1:-start}"

free_port() {
  local port="$1"
  for p in $(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true); do
    kill "$p" 2>/dev/null || true
  done
}

case "$cmd" in
  stop)
    free_port 8082
    free_port 5173
    for f in api-8082.pid fe-5173.pid; do
      if [[ -f "$LOGDIR/$f" ]]; then
        kill "$(cat "$LOGDIR/$f")" 2>/dev/null || true
        rm -f "$LOGDIR/$f"
      fi
    done
    echo "stopped (ports 8082/5173)"
    ;;
  status)
    echo -n "8082: "; curl -sf http://127.0.0.1:8082/actuator/health || echo DOWN
    echo -n "5173: "; curl -sf -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5173/ || echo DOWN
    ;;
  start|*)
    free_port 8082
    free_port 5173
    sleep 1
    : >"$LOGDIR/api-8082.log"
    : >"$LOGDIR/fe-5173.log"
    python3 - "$ROOT" "$LOGDIR" <<'PY'
import os, subprocess, sys
from pathlib import Path
root, logdir = Path(sys.argv[1]), Path(sys.argv[2])
env = os.environ.copy()
env["JAVA_HOME"] = env.get("JAVA_HOME") or "/opt/homebrew/opt/openjdk@21"
env["PATH"] = f"{env['JAVA_HOME']}/bin:" + env.get("PATH", "")

def spawn(cmd, cwd, logfile, pidfile):
    log = open(logfile, "ab", buffering=0)
    p = subprocess.Popen(
        cmd, cwd=str(cwd), env=env,
        stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    Path(pidfile).write_text(f"{p.pid}\n")
    print(f"pid={p.pid} log={logfile}")

spawn(
    ["mvn", "-pl", "open-dashboard-start", "-am", "spring-boot:run",
     "-Dspring-boot.run.arguments=--spring.profiles.active=docker --server.port=8082 --spring.datasource.url=jdbc:postgresql://127.0.0.1:5434/opendashboard --opendashboard.bootstrap.host=127.0.0.1 --opendashboard.bootstrap.port=5434"],
    root / "open-dashboard-backend",
    logdir / "api-8082.log",
    logdir / "api-8082.pid",
)
spawn(
    ["npm", "run", "dev"],
    root / "open-dashboard-frontend",
    logdir / "fe-5173.log",
    logdir / "fe-5173.pid",
)
PY
    echo "detached. logs: $LOGDIR"
    echo "  stop:   $0 stop"
    echo "  status: $0 status"
    ;;
esac
