# AI Harness（Pi 架构 · FE 直连）

> **总架构**见 [ai-architecture.md](./ai-architecture.md)。  
> 对照仓：`refs/pi`（`pi-agent-core` / `pi-ai`）— **抄模式，不搬 TS 整仓**。  
> 实现：[`opendashboard-harness/`](../../opendashboard-harness/)。

## 默认决策

| 层 | 做什么 | 不做什么 |
|----|--------|----------|
| **OD Vue** | 对话 UI；直连 harness（`/harness/v1/*`） | 不直连模型；不经 Java 跑 Agent |
| **opendashboard-harness** | Session、Agent loop、工具注册、上下文/记忆、SSE | 不持有生产库写账号；不把结果行写入布局 |
| **Java** | `/api/internal/bi/*` 工具实现 + 看板/数据集 CRUD（编辑器） | 不做 Lead/LLM；**不再**作为 conversation runs 入口 |

```mermaid
flowchart TB
  FE[OD_Vue] -->|"/harness/v1/*"| H[opendashboard_harness]
  H -->|LLM| LLM[DeepSeek_etc]
  H -->|AgentTool_execute| BI[Java_api_internal_bi]
  BI --> Draft[Dashboard_draft_chartQuery]
```

- **问数 Ask-3**：对照 `refs/sqlbot` 迁 generate-SQL → 只读校验 → 执行 → 出图；不搬用户/工作空间/RAG。  
- **步骤折叠**：工具结束 SSE `step.preview`（schema 字段、SQL、行数），前端二次展开。  
- **问数文件源**：`POST /api/dataset/import` 后与 JDBC 数据集同一套工具。  
- **不整仓搬 SQLBot**；编辑器浮层 + harness `sqlbot/` 管道。任意 SQL 不暴露给 FE。  
- 看板真相：`DashboardPatch` → draft + live `chartQuery`。  
- Java `/api/conversations/*/runs` 已废弃（返回明确错误）。

## 从 Pi 抄 / 不抄

**抄：** AgentMessage vs LLM Message、`transformContext`、事件流（turn/tool_execution）、工具 `name+schema+execute`、Session 落盘、Skills 注入、精简核心。

**不抄：** coding-agent 的 bash/read/write/edit、TUI CLI、嵌 TS monorepo。

## 能力

| 能力 | 行为 | 主工具 |
|------|------|--------|
| ask | SQLBot NL2SQL（Ask-3）→ 会话 ephemeral；失败回退意图卡 encode | schema → generate SQL → `od_run_sql` → finish |
| **编辑器 SQLBot** | 同 ask；浮层选当前看板数据集；默认不写画布 | 同上；采纳才 `od_emit_patch` |
| insight | 问数 + 叙事 | 同上 + skill od-ask-board |
| gen | DeerFlow planner + JoyAgent critic：`write_todos` → `od_profile_dataset` → `od_plan_charts`（探测有数 + 质检）→ `od_review_charts`（可省略，layout 再跑）→ `od_layout_board`（查询条+满铺）→ emit_patch；compose-board 仅双失败兜底 | profile / plan_charts / review / layout / emit |
| 多轮 append | 有 linkedDashboard 默认 append | board_summary + emit append |
| 记忆 | transcript + 短事实注入 | session_store + memory |
| 降级 | 无 LLM key：`OD_HARNESS_MODE` | deterministic compose-board |

## 工具目录（定义在 harness，实现在 Java）

| 工具 | Java |
|------|------|
| `od_list_datasets` | `GET /api/internal/bi/datasets` |
| `write_todos` | harness 本地（DeerFlow planner 任务列表） |
| `od_profile_dataset` | `POST /api/internal/bi/profile-dataset` |
| `od_plan_charts` | harness 本地（只保留 `probes[].rowCount>0` 且 KPI 非 null 的 encode；带 `query` + `grouptable`；内含质检） |
| `od_review_charts` | harness 本地（JoyAgent critic：关假环比、去同维饼图、丢掉粒折线、明细表改汇总；不阻断 emit） |
| `od_get_schema` | `GET /api/internal/bi/datasets/{id}/schema` |
| `od_run_query` | `POST /api/internal/bi/query/chart` |
| `od_run_sql` | `POST /api/internal/bi/query/sql`（SQLBot：sqlglot 校验后的 SELECT） |
| `od_get_board_summary` | `GET /api/internal/bi/board-summary` |
| `od_layout_board` | harness 本地（顶栏 `type=query` + KPI 行 + 两列满铺 + 底汇总表；强制再跑质检） |
| `od_compose_board` | `POST /api/internal/bi/compose-board`（兜底） |
| `od_emit_patch` | `POST /api/internal/bi/apply-patch` |
| `od_finish` | harness 本地 |

鉴权：工具 → `X-OD-Internal-Token`；FE→harness → `X-User-Id` / `X-User-Perms`。

## Harness HTTP

- `GET /health`
- `GET|POST /v1/conversations`
- `GET|PATCH|DELETE /v1/conversations/{id}`
- `GET /v1/conversations/{id}/messages`
- `POST /v1/conversations/{id}/runs` — SSE：`run` · `step` · `plan` · `intent_map` · `answer_*` · `patch` · `chart_ready` · `board_ready` · `message_delta` · `error` · `finish`

前端 Vite：`/harness` → `http://127.0.0.1:8091`。

## 生成默认信息架构

对齐销售模板槽位，生成页默认：

```text
[ 查询条 type=query：日期范围 + 1～3 个枚举下拉 ]
[ KPI × 2～4（仅 probe 有非空聚合；无 yoy/mom 不画假环比）]
[ 图 图 ] [ 图 图 ]     ← 两列满铺；奇数最后一张拉满；饼图不与柱图同维
[ 汇总表 grouptable ]
```

```mermaid
flowchart LR
  todos[write_todos] --> profile[od_profile_dataset]
  profile --> plan[od_plan_charts]
  plan --> critic[质检闸]
  critic --> layout[od_layout_board]
  layout --> critic2[质检闸再跑]
  critic2 --> emit[od_emit_patch]
```

对照：**DeerFlow** 提供 `write_todos` planner 与 SSE 步骤；**JoyAgent** 的报告路径是「分析后再可视化」——OD 把后者收成确定性质检闸（不另起 LLM critic），LLM 跳过 `od_review_charts` 时 `od_layout_board` 仍会修。

- **空图不进稿**：`od_plan_charts` 要求对应 `probes[].rowCount>0`，KPI 还要求样本值非 null；无命中探测则不加。Agent 禁止在 plan 之外发明未探测 encode。
- **意图对齐**：问数/生成先 `POST /api/internal/bi/resolve-intent`。`encode.filters` 的相对时间（近一年等）进入 SQL WHERE；缺字段则 `answer_clarify`，不盲打试查询。
- **质检闸（确定性，LLM 跳过也会被 layout 兜住）**：KPI `calc` 非 yoy/mom 则 `showCompare=false`；饼图与已有柱图同维则去掉；折线 `tooGranular` 或样本为 ISO 时间戳则去掉；`table` 改 `grouptable`。
- **查询条本轮不进 `chartQuery` context.filters**：顶栏控件写入 draft；与意图卡 `encode.filters` 不是同一层。
- 探测为空的 KPI / 趋势不会出现在 `chart_ready`，预览不用空卡占位。

## 配置（harness `.env`）

```bash
OD_BI_BASE=http://127.0.0.1:8082
OD_INTERNAL_TOKEN=od-dev-internal
OD_HARNESS_PORT=8091
OD_HARNESS_MODE=auto          # auto | lead | deterministic
OD_HARNESS_DATA_DIR=.od-harness
OD_LLM_BASE_URL=https://api.deepseek.com/v1
OD_LLM_API_KEY=
OD_LLM_MODEL=deepseek-v4-pro
```

## 安全

- 任意 SQL 不暴露给 FE；受控 query 仅 internal。  
- 写看板只能 `od_emit_patch`。  
- `.env` gitignore。
