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
| 当前范围 | [路线图 · 进行中](../../product/roadmap/in-progress/)：PR-ASK-01…13 |

## 波及

| 列 | 内容 |
|----|------|
| 依赖 | [P004](../P004-conversation/) Harness / Patch |
| 改动面 | FE 对话流 · Harness ask/adopt 路径 · OpenAPI `intent` / adopt |
| 不改 | 整页生成主路径（P004）；可问集合算法产品化（P008）；产品壳（P007） |
| 回归 | PR-ASK-01…13；P004 的 PR-CONV-04 / PR-CONV-09；P007 工作台问数框 PR-ASK-06 |

## 定位

对话模块**默认能力**是问数：自然语言 → 会话内结果（表 / 临时图）。

工作台问数框提交后，进入对话并**自动跑本题**，落到结果卡（不再停在空落地页）。

问数结果卡**本期不提供「保存到仪表盘」**，只在会话里预览。
**直接生成仪表盘** 是落地页 / 输入框的快捷意图：不经单题问数，直出整页 draft。Harness `POST …/adopt` 契约保留，产品入口延后。

架构结论与三开源对照见 [design.md](./design.md)。

## 范围

### Ask-1（进行中 · 高保）

- `#/conversation` 问数默认路径与结果操作（已优化高保）
- 工作台问数 → 对话自动出结果
- 选表后「换一个问数问题」反问具体 Chip，点选后再出 SQL/图
- 洞察结论 + 表/图预览 + 追问 Chip；结果卡本期无「保存到仪表盘」
- SSE 事件名约定：`answer_table` / `answer_chart` / `answer_insight`

### Ask-2（进行中 · 实现）

- OpenAPI：`intent` + `/runs/{runId}/adopt`（契约保留；问数本期不暴露保存入口）
- Harness：ask/insight 产出 run artifact；adopt 闭环标本期不做产品入口
- FE：`/conversations` 问数优先、结果预览；不调 adopt
- **编辑器 SQLBot**：对齐 DataEase 仪表盘编辑页浮层（`assistant.vue` + 当前看板数据集）。实现迁到 `ConversationAiPanel`：默认 `intent=ask`，不写画布；本期无「保存到仪表盘」
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
- **空结果**：SQL 合法但 0 行时发 `answer_insight`（说明无数据 + 样本时间范围），**不**出空白图；打开已完成会话不因缺少 Java assistant 消息而重跑。
- **表头中文**：结果表、轴标题、思考过程样本列用字段中文 label；`order_cnt` 这类物理名转成「订单数」，不把英文列名直接给用户。
- **高频问法 few-shot**：数据集页维护 NL→已验证 SQL；生成前按相似度注入最多 3 条。表名必须是当前物理表，示例不能突破表白名单。
- **维度取值**：confirmed 公共维度的 `values` 挂到 schema 字段，并写入 `<dimension-values>`；过滤必须用原文字面量（如 CNY）。

### Ask-4（暂缓对话入口 · 文件数据源）

对照 DataEase `LOCALFILE`（Excel / ExcelRemote）与 API：

```text
上传/拉取 → 解析字段+样例行 → 落入可查询表 → 与 JDBC 同一套 schema / chartQuery / SQLBot
```

- **对话页不做**：落地页 / Composer 不展示「上传表」；只从 `GET /api/dataset/askable` 选已有表。
- **仍保留**：`POST /api/dataset/import`（CSV / xlsx 首表）与编辑器浮层入口；重启后从 `opendashboard.file-import.dir` 回放。
- **不做（本期）**：API 数据源每次 chartQuery 打 HTTP。DE 也是先把 JSON 同步成引擎表再查；OD 后续同一模式。
- `.xls` 请另存为 xlsx/csv（不引入完整 POI）。

## 非目标

- 问数结果卡 / 编辑器 SQLBot「保存到仪表盘」（adopt 产品入口延后；契约仍保留）
- 把查询结果行持久化进布局或 HTML
- DeerFlow 式沙箱任意 SQL
- 用 SQLBot SQL 替代 chartQuery 作为看板运行时取数
- 前端任意 SQL 入口
- 跨会话用户记忆与完整知识库管理面（→ [P010](../P010-user-memory-ask-knowledge/)）。本切片数据集页维护高频问法；已确认维度值进入 SQLBot prompt
- 可问集合算法产品化与资源 ACL 表（→ [P008](../P008-permission-aware-workbench/)；三入口已接 `GET /api/dataset/askable`）

## 验收 ID

判据、路径、状态与证据只在 [acceptance.yaml](./acceptance.yaml)。

| ID | 标题 |
|----|------|
| PR-ASK-01 | 对话默认问数，结果在会话流 |
| PR-ASK-02 | 问数结果不写入看板 |
| PR-ASK-03 | 落地页整页生成是独立意图 |
| PR-ASK-04 | 无 schema 时拒答或澄清 |
| PR-ASK-05 | 结果卡无保存、无整页生成主按钮 |
| PR-ASK-06 | 工作台提问后自动执行本题 |
| PR-ASK-07 | 可问集合与三入口一致 |
| PR-ASK-08 | Python Harness；Java 零 LLM |
| PR-ASK-09 | 换题反问后出 SQL 与图 |
| PR-ASK-10 | 历史问数回放思考过程与结果卡 |
| PR-ASK-11 | 0 行问数说明无数据，且历史会话不重复思考 |
| PR-ASK-12 | 数据集高频问法注入 SQLBot few-shot |
| PR-ASK-13 | 已确认维度值进入 SQL 生成 prompt |

## 关联

- 现行问数流程：[architecture.html#ask](../../design/architecture.html#ask)
- 提案设计：[design.md](./design.md)
- 生成：[P004 生成设计](../P004-conversation/dashboard-generation-design.md)
- 对话：[P004 对话设计](../P004-conversation/design.md) · [P004](../P004-conversation/README.md)
- 权限与可问数据：[P008](../P008-permission-aware-workbench/)

## 修订记录

| 日期 | 说明 |
|------|------|
| 2026-08-19 | 数据集页「高频问法」落地：NL+SQL 作 SQLBot few-shot；confirmed 维度 values 写入 schema 与 `<dimension-values>` |
| 2026-08-19 | 问数类型先不支持保存到仪表盘：结果卡与编辑器 SQLBot 去掉该入口；adopt 契约保留、产品入口延后 |
| 2026-08-19 | 对话 Composer 去掉 Auto/Plan 与风格切换（用户看不出效果）；固定 Auto + 飞书蓝 |
| 2026-08-19 | 对话 Composer 选表改到输入框下方；去掉落地页「上传表」入口（Ask-4 对话入口暂缓，import API 仍保留） |
| 2026-08-19 | 问数结果表头/轴标题用中文：优先数据集 label，其次把 order_cnt 等物理名转成「订单数」 |
| 2026-08-19 | 问 2026 等无数据年份时：SQLBot 0 行改为 insight 说明，不出空图；打开已完成会话不再因缺少 Java assistant 气泡而重复跑出多段「已思考 / 问数完成。」 |
| 2026-08-19 | 顶条去掉会话标题；结果卡去掉「临时图」标签与「复制结论」；保存到仪表盘不再追加第二段思考过程 |
| 2026-08-19 | 问数页思考过程与结果卡对齐同一内容轴（头像右侧、等宽卡片），去掉并排明细表 |
| 2026-08-19 | 有临时图时结果卡不并列铺明细行；SQL 留在思考过程 |
| 2026-08-19 | 历史问数必须回放思考过程与结果卡：Harness `GET /conversations/{id}/replay` + 消息 attachments `kind=answer`；不重新跑 run |
| 2026-08-18 | 编辑器 SQLBot 浮层改为右下角固定高度（约 520px / 400px），对齐 DataEase 小助手，不再通栏拉满 |
| 2026-08-18 | 对话页去掉内侧栏与「本会话产物」列；新对话 / 历史 / 探索只留对话顶条（对齐 P007 壳） |
| 2026-08-18 | 确认 adopt 协议闭环：FE 只调 Harness；Harness 从 run artifact 生成 Patch 并调 Java internal BI；Java public adopt 入口删除 |
| 2026-08-17 | 换题反问：已选表时「换一个问数问题」按字段给出可点问法，点击后再生成 SQL/图 |
| 2026-08-17 | 把已编码问数交互与 SQLBot 对照写入 architecture.html#ask |
| 2026-08-17 | 收敛结果卡为“保存本题图”，整页生成为独立意图；统一 Python Harness 与可问数据权限边界 |
| 2026-08-17 | 补波及表；验收细节只保留在 yaml |
| 2026-08-17 | 本月不交付 PR-ASK-07（可问集合一致）；等 P008。工作台问数框与结果卡保存本题图已按现有设计对齐产品 |
| 2026-08-17 | 问数临时图改走 chartQuery + ECharts，不再用 CSS 条形图冒充图表 |
| 2026-08-18 | 术语/SQL 示例与跨会话记忆划到 [P010](../P010-user-memory-ask-knowledge/)；三入口接 `GET /api/dataset/askable`
