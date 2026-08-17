#!/usr/bin/env bash
# Start PostgreSQL via Docker (port 5434 on host to avoid conflict with local PG).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! docker info >/dev/null 2>&1; then
  echo "Docker not running. Start Colima: colima start"
  exit 1
fi

compose_pg() {
  local -a files=(
    --project-directory "$ROOT"
    -f "$ROOT/open-dashboard-backend/docker-compose.yml"
  )
  if command -v docker-compose >/dev/null 2>&1; then
    docker-compose "${files[@]}" "$@"
  elif docker compose version >/dev/null 2>&1; then
    docker compose "${files[@]}" "$@"
  else
    echo "Need docker-compose or Docker Compose plugin (docker compose)."
    exit 1
  fi
}

compose_pg up -d postgres
echo "Waiting for PostgreSQL..."
for i in $(seq 1 30); do
  if compose_pg exec -T postgres pg_isready -U opendashboard -d opendashboard >/dev/null 2>&1; then
    echo "PostgreSQL ready on localhost:5434"
    echo "  user=opendashboard password=opendashboard db=opendashboard"
    echo "Backend: SPRING_DATASOURCE_URL=jdbc:postgresql://localhost:5434/opendashboard mvn -pl open-dashboard-start -am spring-boot:run"
    exit 0
  fi
  sleep 1
done
echo "Timeout waiting for PostgreSQL"
exit 1
