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

Edit `.env` (gitignored):

```bash
OD_LLM_API_KEY=sk-...
OD_LLM_BASE_URL=https://api.deepseek.com/v1
OD_LLM_MODEL=deepseek-v4-pro
OD_BI_BASE=http://127.0.0.1:8082
```

```bash
cd opendashboard-harness
source .venv/bin/activate   # or python3 -m venv .venv && pip install -r requirements.txt
python main.py              # :8091, loads .env
```

`GET /health` → `lead` / `llm` / `envFile` / `bi`.

Contract: [docs/design/ai-harness.md](../docs/design/ai-harness.md). Pi reference: `refs/pi` (patterns only).
