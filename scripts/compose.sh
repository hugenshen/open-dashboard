# Shared docker compose wrapper. Scripts must set ROOT then source this file.
compose() {
  local -a files=(
    --project-directory "$ROOT"
    -f "$ROOT/open-dashboard-backend/docker-compose.yml"
    -f "$ROOT/open-dashboard-frontend/docker-compose.yml"
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
