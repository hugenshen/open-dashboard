# opendashboard-harness

DeerFlow-style **Lead Agent** for Open Dashboard. Java remains zero-AI; this service owns LLM tool loops and calls `/api/internal/bi/*`.

## Modes

| `OD_HARNESS_MODE` | Behavior |
|-------------------|----------|
| `auto` (default) | Lead+LLM if `OD_LLM_API_KEY` set; else deterministic fallback |
| `lead` | Require LLM; fail closed to deterministic only after Lead error |
| `deterministic` | Old thin tool ring (compose-board only) |

## Run

```bash
export OD_BI_BASE=http://127.0.0.1:8082
export OD_INTERNAL_TOKEN=od-dev-internal
export OD_LLM_BASE_URL=https://api.openai.com/v1   # or DeepSeek / Ark / etc.
export OD_LLM_API_KEY=sk-...
export OD_LLM_MODEL=gpt-4o-mini

cd opendashboard-harness
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python main.py   # :8091
```

`GET /health` shows `lead` / `llm.configured`.

## Lead tools

`od_list_datasets` · `od_get_schema` · `od_run_query` · `od_get_board_summary` · `od_compose_board` · `od_emit_patch` · `od_finish`

Skills notes: `skills/od-ask-board`, `od-emit-dashboard`, `od-report`.

## Why not full DeerFlow process?

DeerFlow 2.0 is a full gateway + sandbox + Node stack (Python 3.12+). OD embeds the **same Lead pattern** (system prompt + tool loop + SSE) here so FE/Java stay unchanged. Full DeerFlow Gateway can later replace this process behind the same `/v1/runs` contract.
