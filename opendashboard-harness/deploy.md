# Harness 运行

本目录是对话 Agent 进程。前端直连本服务；Java 只执行 BI 工具。

整栈开箱（`./scripts/up.sh`）**不含**本进程。问数 / 对话分析本地开发时再起它。

## 本地运行

编辑 `.env`（已 gitignore）：

```bash
OD_LLM_API_KEY=sk-...
OD_LLM_BASE_URL=https://api.deepseek.com/v1
OD_LLM_MODEL=deepseek-v4-pro
OD_BI_BASE=http://127.0.0.1:8082
```

```bash
cd opendashboard-harness
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python main.py              # :8091
```

`GET /health` 查看 `lead` / `llm` / `envFile` / `bi`。

设计：[P004 Harness](../docs/proposals/P004-conversation/harness-design.md)。
