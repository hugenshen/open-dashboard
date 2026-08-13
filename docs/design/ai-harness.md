# AI Harness（DeerFlow 承载 · Java 零 AI）

> **总架构**见 [ai-architecture.md](./ai-architecture.md)。对照仓：`/Users/shen/backdashboard/refs/deer-flow`。

## 默认决策

| 层 | 职责 |
|----|------|
| **Java** | 管理平台：鉴权、会话落库、BI API（schema/query/applyPatch）、对外 `/api/conversations` **SSE 代理** |
| **DeerFlow / `opendashboard-harness`** | **唯一 AI 运行时**：Lead 工具环、Skills、沙箱；问数/解读/报告/看板生成 |
| **OD Vue** | 产品壳；不直连模型 |

- **Java 不做 LLM / Lead / NL2SQL。**  
- **不从 JoyAgent 迁移 NL2SQL**（DeerFlow 本无 NL2SQL；问数 = `od_*` 取数工具 + `data-analysis` skill + 沙箱）。  
- 看板真相：`DashboardPatch` → draft + live `chartQuery`；布局禁止结果行。  
- 沙箱：分析用 Python 的正路；禁止沙箱持有生产库写账号。

## 运行时

```text
FE → Java /api/conversations/{id}/runs (SSE)
   → opendashboard-harness /v1/runs  (DeerFlow 风格工具环)
        → 工具回调 Java /api/internal/bi/*
   ← OD 事件：step / answer_* / patch / chart_ready / finish
```

配置：

```yaml
opendashboard:
  conversation:
    enabled: true
    harness:
      mode: deerflow          # deerflow | local
      base-url: http://127.0.0.1:8091
      internal-token: od-dev-internal
      timeout-ms: 180000
```

- `mode=deerflow`：代理到 harness；不可达则明确错误（不假装 Java AI 成功）。  
- `mode=local`：仅确定性非模型降级（平台模板），用于 harness 未启动时的联调兜底。

## BI 内部 API（供 harness / MCP）

| 路径 | 作用 |
|------|------|
| `GET /api/internal/bi/datasets` | 列表 |
| `GET /api/internal/bi/datasets/{id}/schema` | 字段 |
| `POST /api/internal/bi/query/dataset` · `query/chart` | 受控 query |
| `GET /api/internal/bi/board-summary` | 当前 draft 组件摘要 |
| `POST /api/internal/bi/compose-board` | 平台构图（确定性，非 LLM） |
| `POST /api/internal/bi/apply-patch` | 唯一写看板 |

鉴权：请求头 `X-OD-Internal-Token`。

## DeerFlow 增强（opendashboard-harness）

`opendashboard-harness` 实现 **DeerFlow 风格 Lead Agent**（LLM + 工具环），不是 Java LLM。

- `OD_HARNESS_MODE=auto`：有 `OD_LLM_API_KEY` 则走 Lead；否则确定性降级。  
- 工具：`od_list_datasets` · `od_get_schema` · `od_run_query` · `od_compose_board` · `od_emit_patch` · `od_get_board_summary` · `od_finish`  
- Skills 说明：`opendashboard-harness/skills/`（后续可挂上游 `data-analysis`）  
- 完整 DeerFlow Gateway/Sandbox 可替换本进程，对外仍保持 `/v1/runs` SSE 契约。

多轮：默认 `emit_patch(mode=append)`；显式整页才 replace。

## SSE 事件（对外不变）

`run` · `step` · `plan` · `answer_*` · `patch` · `chart_ready` · `message_delta` · `error` · `finish`

## 安全边界

- Feature flag 关闭 → conversations 404。  
- 任意 SQL 不暴露给 FE；受控 query 仅 internal。  
- 沙箱输出须经 `od_emit_patch` 才能进看板。
