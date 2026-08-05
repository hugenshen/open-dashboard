#!/usr/bin/env bash
# Start PostgreSQL via Docker (port 5434 on host to avoid conflict with local PG).
set -euo pipefail
cd "$(dirname "$0")/.."

if ! docker info >/dev/null 2>&1; then
  echo "Docker not running. Start Colima: colima start"
  exit 1
fi

docker-compose up -d postgres
echo "Waiting for PostgreSQL..."
for i in $(seq 1 30); do
  if docker-compose exec -T postgres pg_isready -U opendashboard -d opendashboard >/dev/null 2>&1; then
    echo "PostgreSQL ready on localhost:5434"
    echo "  user=opendashboard password=opendashboard db=opendashboard"
    echo "Backend: SPRING_DATASOURCE_URL=jdbc:postgresql://localhost:5434/opendashboard mvn -pl open-dashboard-start -am spring-boot:run"
    exit 0
  fi
  sleep 1
done
echo "Timeout waiting for PostgreSQL"
exit 1
