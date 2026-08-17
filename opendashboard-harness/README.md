# opendashboard-harness

Pi-style Agent runtime for Open Dashboard. **FE talks to this service**; Java only executes BI tools.

```text
FE → /harness/v1/conversations*/runs (SSE)
   → Agent loop + tools
   → Java /api/internal/bi/*
```

## Layout

```text
agent/     runtime, types, context, memory, session_store
tools/     registry + od_bi (HTTP to Java)
api/       FastAPI app
skills/    SKILL.md packages
```

## Capabilities

ask / insight / gen / multi-turn append / memory / deterministic fallback.

## Tools → Java

`od_list_datasets` · `write_todos` · `od_profile_dataset` · `od_plan_charts` · `od_review_charts` · `od_get_schema` · `od_run_query` · `od_get_board_summary` · `od_layout_board` · `od_compose_board` · `od_emit_patch` · `od_finish`

## Run

见 [deploy.md](./deploy.md)。

Design: [P004 Harness](../docs/proposals/P004-conversation/harness-design.md). API contract: [OpenAPI](../docs/design/openapi.yaml).
