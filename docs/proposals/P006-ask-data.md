---
id: P006
title: 对话问数（Ask-data）
status: in-progress
milestone: v0.5
date: 2026-08-12
prototype: prototypes/hi-fi/conversation-workspace.html
design: docs/design/ai-architecture.md
depends: P004
---

# P006 · 对话问数（Ask-data）

## 定位

对话模块**默认能力**是问数：自然语言 → 会话内结果（表 / 临时图）。  
用户可显式：

1. **保存到仪表盘** — 将本题 encode 写入 Dashboard draft（Patch）  
2. **直接生成仪表盘** — 以本题证据扩展为整页 Patch  

架构结论与三开源对照见 [ai-architecture.md](../design/ai-architecture.md)。

## 范围

### Ask-1（进行中 · 高保）

- `#/conversation` 问数默认路径与结果操作（已优化高保）
- 洞察结论 + 表/图预览 + 追问 Chip + 保存/生成
- SSE 事件名约定：`answer_table` / `answer_chart` / `answer_insight`

### Ask-2（进行中 · 实现）

- OpenAPI：`intent` + `/runs/{runId}/adopt`
- BE：`AskAnswerPlanner` + Harness ask/insight 路径；采纳 → Patch
- FE：`/conversations` 问数优先、结果预览、保存/生成
- **编辑器 SQLBot**：对齐 DataEase 仪表盘编辑页浮层（`assistant.vue` + 当前数据集选择）。实现迁到 `ConversationAiPanel`：默认 `intent=ask`，不自动写画布；「保存到仪表盘」走 adopt。
- **意图对齐**：`IntentResolver` 把「近一年 / 商户 / 收入」映射到 schema 字段；缺字段澄清。

### Ask-3（进行中 · SQLBot NL2SQL）

对照 `refs/sqlbot`（[dataease/SQLBot](https://github.com/dataease/SQLBot)）问数主路径，**不**整仓搬用户/工作空间/RAG/xpack：

```text
schema（M-Schema）→ LLM 生成 JSON{sql, chart-type}
  → sqlglot 只读校验 + 表白名单
  → Java POST /api/internal/bi/query/sql 执行
  → LLM/启发式图表配置
  → SSE answer_sql / answer_table / answer_chart
```

- 仅 `SELECT`/`WITH`；表名必须是当前数据集物理表；前端不暴露任意 SQL 入口。
- LLM 未配置或生成失败时回退 Ask-2 意图卡 encode。
- 画布真相仍是 encode + `chartQuery`；SQL 只在会话预览。
- **步骤二次折叠**：`step.preview` 把 Schema / SQL / 行样本藏进工具条，点「N 个字段 >」展开（对照 Kimi 搜索条）。

### Ask-4（进行中 · 文件数据源）

对照 DataEase `LOCALFILE`（Excel / ExcelRemote）与 API：

```text
上传/拉取 → 解析字段+样例行 → 落入可查询表 → 与 JDBC 同一套 schema / chartQuery / SQLBot
```

- **本期**：问数页 `POST /api/dataset/import`（CSV / xlsx 首表）→ 数据集 + 进程内表；重启后从 `opendashboard.file-import.dir` 回放。
- **不做（本期）**：API 数据源每次 chartQuery 打 HTTP。DE 也是先把 JSON 同步成引擎表再查；OD 后续同一模式。
- `.xls` 请另存为 xlsx/csv（不引入完整 POI）。

## 非目标

- 把查询结果行持久化进布局或 HTML  
- DeerFlow 式沙箱任意 SQL  
- 用 SQLBot SQL 替代 chartQuery 作为看板运行时取数  
- 前端任意 SQL 入口  

## 验收要点（草案）

| ID | 要点 |
|----|------|
| PR-ASK-01 | 对话默认意图为问数；结果在会话/画布可见 |
| PR-ASK-02 | 「保存到仪表盘」产生 DashboardPatch，无结果行入库 |
| PR-ASK-03 | 「直接生成仪表盘」进入 draft 预览并可编辑器打开 |
| PR-ASK-04 | 无 schema 时拒答或澄清，不静默写看板 |

## 关联

- 架构：[../design/ai-architecture.md](../design/ai-architecture.md)  
- 生成：[../design/dashboard-generation.md](../design/dashboard-generation.md)  
- 对话：[../design/conversation.md](../design/conversation.md) · [P004](./P004-conversation.md)
