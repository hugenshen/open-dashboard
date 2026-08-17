---
id: P006
title: 对话问数（Ask-data）
status: in-progress
milestone: v0.5
date: 2026-08-12
prototype: docs/prototypes/hi-fi/conversation-workspace.html
design: [docs/proposals/P006-ask-data/design.md]
acceptance: docs/proposals/P006-ask-data/acceptance.yaml
gates:
  proposal: accepted
  hi-fi: wip
  code: wip
  acceptance: blocked
architecture: docs/design/architecture.html
contract: docs/design/openapi.yaml
implementation: [open-dashboard-frontend/src/conversation/, open-dashboard-backend/, opendashboard-harness/]
depends: P004
---

# P006 · 对话问数（Ask-data）

> **状态** `in-progress` · 路线图 [进行中](../../product/roadmap/in-progress/) · 高保 wip · 代码 wip · 验收 blocked

## 开发入口

| 你要 | 去看 |
|------|------|
| 范围与非目标 | 本文 |
| 怎么验收 | [acceptance.yaml](./acceptance.yaml) |
| 问数架构（现行代码） | [architecture.html#ask](../../design/architecture.html#ask) |
| 问数架构（提案设计） | [design.md](./design.md) |
| 原型 | 当前增量 [`conversation.html`](../../prototypes/hi-fi/conversation.html)；**尚未冻结快照** |
| 代码落点 | `open-dashboard-frontend/src/conversation/` · `opendashboard-harness/` · Java internal BI |
| 相邻提案 | 生成看板 [P004](../P004-conversation/)；可问权限 [P008](../P008-permission-aware-workbench/) |
| 当前范围 | [路线图 · 进行中](../../product/roadmap/in-progress/)：PR-ASK-01…09 |

## 波及

| 列 | 内容 |
|----|------|
| 依赖 | [P004](../P004-conversation/) Harness / Patch |
| 改动面 | FE 对话流 · Harness ask 路径 · OpenAPI `intent` / adopt |
| 不改 | 整页生成主路径（P004）；可问集合算法产品化（P008）；产品壳（P007） |
| 回归 | PR-ASK-01…09；P004 的 PR-CONV-04；P007 工作台问数框 PR-ASK-06 |

## 定位

对话模块**默认能力**是问数：自然语言 → 会话内结果（表 / 临时图）。

工作台问数框提交后，进入对话并**自动跑本题**，落到结果卡（不再停在空落地页）。

结果卡只保留 **保存到仪表盘**（本题图写入 draft）。  
**直接生成仪表盘** 是落地页 / 输入框的快捷意图：不经单题问数，直出整页 draft。若问完还想要整页，用追问 Chip「生成经营分析看板」。

架构结论与三开源对照见 [design.md](./design.md)。

## 范围

### Ask-1（进行中 · 高保）

- `#/conversation` 问数默认路径与结果操作（已优化高保）
- 工作台问数 → 对话自动出结果
- 选表后「换一个问数问题」反问具体 Chip，点选后再出 SQL/图
- 洞察结论 + 表/图预览 + 追问 Chip；结果卡「保存到仪表盘」
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
- **换题反问**：已选表时，「换一个问数问题」或模型未识别问数需求，按当前表字段反问具体 Chip；点击后再走 SQLBot 出 SQL/图。不要把元指令送进 NL2SQL。
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

## 验收 ID

判据、路径、状态与证据只在 [acceptance.yaml](./acceptance.yaml)。

| ID | 标题 |
|----|------|
| PR-ASK-01 | 对话默认问数，结果在会话流 |
| PR-ASK-02 | 保存本题图，无结果行入库 |
| PR-ASK-03 | 落地页整页生成是独立意图 |
| PR-ASK-04 | 无 schema 时拒答或澄清 |
| PR-ASK-05 | 结果卡仅「保存到仪表盘」 |
| PR-ASK-06 | 工作台提问后自动执行本题 |
| PR-ASK-07 | 可问集合与三入口一致 |
| PR-ASK-08 | Python Harness；Java 零 LLM |
| PR-ASK-09 | 换题反问后出 SQL 与图 |

## 关联

- 现行问数流程：[architecture.html#ask](../../design/architecture.html#ask)
- 提案设计：[design.md](./design.md)
- 生成：[P004 生成设计](../P004-conversation/dashboard-generation-design.md)
- 对话：[P004 对话设计](../P004-conversation/design.md) · [P004](../P004-conversation/README.md)
- 权限与可问数据：[P008](../P008-permission-aware-workbench/)

## 修订记录

| 日期 | 说明 |
|------|------|
| 2026-08-18 | 编辑器 SQLBot 浮层改为右下角固定高度（约 520px / 400px），对齐 DataEase 小助手，不再通栏拉满 |
| 2026-08-18 | 对话页去掉内侧栏与「本会话产物」列；新对话 / 历史 / 探索只留对话顶条（对齐 P007 壳） |
| 2026-08-17 | 换题反问：已选表时「换一个问数问题」按字段给出可点问法，点击后再生成 SQL/图 |
| 2026-08-17 | 把已编码问数交互与 SQLBot 对照写入 architecture.html#ask |
| 2026-08-17 | 收敛结果卡为“保存本题图”，整页生成为独立意图；统一 Python Harness 与可问数据权限边界 |
| 2026-08-17 | 补波及表；验收细节只保留在 yaml |
| 2026-08-17 | 本月不交付 PR-ASK-07（可问集合一致）；等 P008。工作台问数框与结果卡保存本题图已按现有设计对齐产品 |
| 2026-08-17 | 问数临时图改走 chartQuery + ECharts，不再用 CSS 条形图冒充图表 |
