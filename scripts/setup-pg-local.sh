#!/usr/bin/env bash
# Initialize local PostgreSQL for Open Dashboard (Homebrew postgresql@16 on port 5433).
set -euo pipefail

PG_BIN="/opt/homebrew/opt/postgresql@16/bin"
PORT=5433

if ! "$PG_BIN/pg_ctl" -D /opt/homebrew/var/postgresql@16 status >/dev/null 2>&1; then
  echo "Starting postgresql@16 on port $PORT..."
  brew services start postgresql@16
  sleep 2
fi

echo "Creating role/database (idempotent)..."
"$PG_BIN/psql" -p "$PORT" -d postgres -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'opendashboard') THEN
    CREATE ROLE opendashboard WITH LOGIN PASSWORD 'opendashboard' CREATEDB;
  END IF;
END
$$;
SELECT 'CREATE DATABASE opendashboard OWNER opendashboard'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'opendashboard')\gexec
GRANT ALL PRIVILEGES ON DATABASE opendashboard TO opendashboard;
SQL

echo "Done. Connect: psql -p $PORT -U opendashboard -d opendashboard"
echo "Backend: mvn -pl open-dashboard-start -am spring-boot:run -Dspring-boot.run.arguments='--spring.profiles.active=local'"
