.PHONY: up down nuke logs smoke rebuild

up:
	./scripts/up.sh

down:
	./scripts/down.sh

nuke:
	./scripts/down.sh --volumes

logs:
	./scripts/logs.sh

smoke:
	./scripts/smoke.sh

rebuild:
	@if command -v docker-compose >/dev/null 2>&1; then docker-compose build && docker-compose up -d; else docker compose build && docker compose up -d; fi
