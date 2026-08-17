# 仪表盘生成流程方案

> 现行代码中的生成交互与管道已写入 [architecture.html · 生成看板](../../design/architecture.html#gen) 与 [业界对照](../../design/architecture.html#compare)（已编码未验收）。本文仍是提案详细设计，不是 4A 现行架构。
> 交互真相：[design.md](./design.md) · **AI 总架构（问数优先）**：[P006 design](../P006-ask-data/design.md) · Harness：[harness-design.md](./harness-design.md) · 契约：[openapi.yaml](../../design/openapi.yaml) · 提案：[P004](./README.md) · [P006](../P006-ask-data/README.md)

## 定位

- **对话是入口**；**仪表盘 draft 是唯一运行时真相**。
- 生成物是结构化 `DashboardPatch`（配置），不是内嵌结果行的静态页 / HTML。
- 取数始终走既有 `datasetQuery` / `chartQuery`；布局库禁止写入查询结果行。

## 端到端流程

```mermaid
sequenceDiagram
  participant FE as 对话工作区_或_编辑器侧栏
  participant H as Python_Harness
  participant BI as Java_Internal_BI
  participant DB as Dashboard_draft

  FE->>H: POST /harness/v1/conversations/{id}/runs (SSE)
  H->>BI: dataset_schema (Internal Token)
  alt mode=plan
    H-->>FE: event plan
    FE->>H: POST confirm-plan
  end
  H->>H: LLM 或确定性规划器 → DashboardPatch
  H-->>FE: event patch
  H->>BI: apply_patch + revision
  BI->>DB: persist draft
  H->>BI: chart_query preview
  H-->>FE: event chart_ready
  H-->>FE: event finish
  FE->>FE: 在编辑器打开同一 draft
```

### 步骤说明

| 步 | 谁 | 做什么 |
|----|----|--------|
| 1 | 用户 | 落地页选数据集 + 自然语言；Auto 或 Plan |
| 2 | API | 鉴权 `conversation:use`；写看板仍走 dashboard 写权限 |
| 3 | Harness | 加载会话上下文（conversationId、linkedDashboardId、styleId、datasetIds） |
| 4 | Schema Guard | 读字段 schema；无可用 schema → **禁止页面级 Patch** |
| 5 | 证据链 | 编辑器选中图 encode / 用户指定 dataset / 字段语义（可选） |
| 6 | 规划 | Auto：直接 PatchBuild；Plan：推 `plan`，等 `confirm-plan` |
| 7 | PatchBuild | LLM JSON（可选）或确定性模板 → `DashboardPatch` ops |
| 8 | Validate | 数据集可访问、字段存在、encode 角色合法 |
| 9 | Apply | 写入 Dashboard **draft** + conversation revision |
| 10 | Preview | `chartQuery` → SSE `chart_ready` |
| 11 | 桥接 | 「在编辑器打开」→ `/dashboards/:id/edit`（同一次生成的图） |

## DashboardPatch（产物形态）

```json
{
  "dashboardId": "…",
  "ops": [
    { "op": "upsert_chart", "chartId": "…", "type": "bar", "datasetId": "…", "title": "…", "encode": {}, "style": {} },
    { "op": "upsert_component", "id": "…", "type": "chart", "chartId": "…", "x": 0, "y": 9, "w": 36, "h": 20 },
    { "op": "upsert_component", "id": "…", "type": "query", "x": 0, "y": 0, "w": 72, "h": 8, "props": { "label": "查询条件", "items": [] } },
    { "op": "set_layout", "gridCols": 72, "themeRef": "default" },
    { "op": "set_theme", "styleId": "feishu-blue" }
  ]
}
```

- Apply 前必须过 Schema Guard / Validate。
- 禁止把查询结果行写入 layout / component / HTML。

## 生成默认信息架构

默认稿面（对齐销售模板，由 `od_plan_charts` + `od_layout_board` 落地）：

1. 顶栏 `type=query`（日期 + 状态/渠道等，最多 3 项）
2. 有数 KPI（探测 `rowCount>0` 且聚合非 null）
3. 两列满铺图（4～6 张量级；时间分组失败则不出趋势）
4. 底表 `grouptable` 吃掉留白（禁止明细全列表）

`upsert_component` 可 `type=query`，`props.items: [{kind, field, label, scope}]`。

**质检闸（plan_charts 与 layout_board 各跑一次）**：关假 KPI 环比、去掉与柱图同维的饼图、丢掉粒/原始时间戳折线、明细表改汇总。不阻断 emit，只自动修复。

**查询条进入 `chartQuery.context.filters`**：顶栏日期/枚举变更会作为 FilterContextItem 数组随 chartQuery 下发；Java 转 Filter AST 后编进 SQL WHERE（eq / in / between / last）。意图卡 `encode.filters`（近一年等）仍走同一 AST，与查询条合并。禁止为了密度保留空 KPI / 空趋势。

## 规划来源

| 来源 | 条件 | 行为 |
|------|------|------|
| 确定性规划器 | 默认；或 LLM 关闭 / 失败 / Guard 不通过 | profile → plan_charts → 质检 → layout（compose-board 仅双失败兜底） |
| OpenAI 兼容 LLM | `opendashboard.conversation.llm.enabled=true` 且有 key | 结构化 Patch JSON；非法字段整次回退确定性 |

配置见 [harness-design.md](./harness-design.md#llm-配置)。

## SSE 事件（生成期）

`run`（含 runId）· `step` · `plan` · `intent_map` · `patch` · `chart_ready` · `message_delta` · `error` · `finish{reason,detail}`

Plan 模式：`finish.reason=awaiting_confirm`，Harness 把 patch 存在 run.pending；客户端 `confirm-plan` 后续流 `apply-patch`。取消则不落库。

## 入口

| 入口 | 路径 | 说明 |
|------|------|------|
| 一级对话 | `/conversations` | 两段式：落地 → 工作台（对齐高保） |
| 编辑器 SQLBot | `/dashboards/:id/edit` | DataEase 式浮层问数；选当前看板数据集；默认不写画布；「保存到仪表盘」才 Patch |
| 高保原型 | `docs/prototypes/hi-fi/conversation-workspace.html` | 交互真相源 |

## 双轨边界（勿混）

> 总架构与排序结论见 [P006 Ask-data 设计](../P006-ask-data/design.md)：**问数默认优先**；本文件描述「直接生成 / 采纳后」的 Patch 路径。

1. **问数轨（默认，P006）** — 会话内表/临时图；**不**自动改看板；结果卡只可「保存到仪表盘」并写入本题图。  
2. **配置写入轨（生成 / 采纳）** — NL 或问数证据 → `DashboardPatch` → draft → 预览 → 编辑器（本文件）。  
3. **洞察报告轨（v0.6 / P005）** — 统计洞察 + 叙事 → Umo 块（引用 live 图）。

## 成功标准（生成路径）

- `PR-CONV-03/04`：问数结果可保存本题图；快捷生成意图可直出整页 draft。  
- 取数仅 `datasetQuery` / `chartQuery`；布局无结果行。  
- Plan 必须确认后才 apply。  
- 与高保一致：落地 → 工作台 → 桥接编辑器。

## 实现落点（索引）

| 层 | 位置 |
|----|------|
| design / OpenAPI | 本文件 · [design.md](./design.md) · [harness-design.md](./harness-design.md) · [openapi.yaml](../../design/openapi.yaml) |
| Harness | `opendashboard-harness/`：Agent loop、LLM、SSE、工具注册 |
| Java | `/api/internal/bi/*`：Schema、查询、Patch、revision；不承担 Agent SSE |
| FE | `src/conversation/` · 编辑器 `ConversationAiPanel` |
