---
id: P012
title: 对话出板 / 问数质量闸
status: done
milestone: v0.6
date: 2026-08-22
done: 2026-08-23
design: [docs/proposals/P012-ask-gen-quality/design.md]
acceptance: docs/proposals/P012-ask-gen-quality/acceptance.yaml
gates:
  proposal: accepted
  hi-fi: none
  code: merged
  acceptance: passed
architecture: docs/design/architecture.html
requirements: [PR-QG-02, PR-QG-03, PR-QG-04, PR-QG-05, PR-QG-09, PR-QG-10, PR-QG-11, PR-QG-12]
implementation:
  - open-dashboard-backend/open-dashboard-app/src/main/java/io/opendashboard/application/conversation/
  - opendashboard-dsh-harness/packages/dsh-od-bi/src/gen-board.js
  - opendashboard-dsh-harness/packages/dsh-od-bi/src/goal-planner.js
  - opendashboard-dsh-harness/packages/dsh-od-bi/src/ask-enrich.js
  - opendashboard-dsh-harness/packages/dsh-od-bi/src/index.js
depends: [P004, P006, P010, P011]
---

# P012 · 对话出板 / 问数质量闸

> **状态** `done` · 路线图 [已完成](../../product/roadmap/done/) · 高保 none · 代码 merged · 验收 passed · 2026-08-23
>
> 只追溯，不驱动新开发。基线见 [requirements §2.10](../../product/requirements.md)。后续缺口（对话改图、斜杠菜单、M3、Eval E0.2+）另开 Pxxx。

## 开发入口

| 你要 | 去看 |
|------|------|
| 范围与非目标 | 本文 |
| **改动前/后流程 · 业界对照 · 代码边界（HTML）** | [quality-upgrade-brief.html](./quality-upgrade-brief.html) |
| **Harness 分段评测方案（Ask/Board · 独立 eval）** | [eval-design.md](./eval-design.md) |
| 评测 CLI（E0.1） | `cd opendashboard-dsh-harness && pnpm eval` · 包 `packages/dsh-od-eval` |
| **出板 Goal 规划（LLM+确认+闸 · 提示词与跑法）** | [goal-planning-design.md](./goal-planning-design.md) |
| M1 规则与数据流 | [design.md](./design.md) |
| 怎么验收 | [acceptance.yaml](./acceptance.yaml) |
| 怎么验证测试集/实跑 | [design.md §11](./design.md) |
| 对照实现（TS M1） | `opendashboard-dsh-harness/packages/dsh-od-bi/src/gen-board.js` · `index.js` 的 `od_plan_charts` / `od_generate_board` |
| 对照实现（Java 去词典） | `DeterministicPlanner` · `IntentResolver` · `AskAnswerPlanner` · `DatasetProfiler` · `DatasetProfileLearner` · `FieldSemantics` · `ConversationHarness` |
| 对照实现（问数 M2） | `ask-enrich.js` · `index.js` 的 `od_get_schema` / `od_run_query` / `od_run_sql` |
| 离线测试集 | `gen-board.test.js` · `sql-guard.test.js` · `ask-enrich.test.js` · `quality-cases.js` |
| 旧生成设计（已被本提案 M1 覆盖的质检段） | [P004 dashboard-generation-design](../P004-conversation/dashboard-generation-design.md) |
| 相邻 | 对话表面 [P011](../P011-dsh-conversation-surface/)（done，只追溯）；问数语义 [P006](../P006-ask-data/)；知识引擎 [P010](../P010-user-memory-ask-knowledge/) |

## 为什么开这条

P011 把对话迁到 dsh 后，出板收成 `od_generate_board` one-shot，换来稳定、不超时。质量闸（有数探测、`od_review_charts`、查询条真实区间、按问题选字段）没有迁进 TS。对话生成的板常见：空查询条、同维柱+饼、高基数碎饼、原始时间戳毛线、半行留白、KPI 写死「订单数」、金额单位「分」当元用。

对照 `refs`：SQLBot / JoyAgent 把质量写进管道内部；DataEase 无自动构图，只提供 encode/formatter；DeerFlow 无 BI 出板。OD 应 **加厚 `od_generate_board`**，不把质检再暴露成模型可跳过的工具。

## 范围

### Java last-resort（用户确认 · 已开工）

- Java 不再维护订单/金额/商户/收入等业务词打分
- 字段角色：已学习 `roleLearned` 优先，否则 schema `group` + JDBC type
- 问数/出板规划：用户原文与数据集名、表名、字段名、中文 label 重叠（glossary 别名已折进 label）
- `ConversationHarness` 不再跑本地/代理规划；`/runs` 只回 `HARNESS_DIRECT`
- 相对时间「近一年/月/周」保留（语法，不是业务域）
- 演示种子数据（`ds_sales` stub 行、工作区种子）不是规划词典，不删

### M1（本期 · 出板 · 已编码）

- `od_generate_board` 接收 `message`，规划对用户原话加权
- 用已存 profile 统计（`distinctCount` / 时间 min-max），**不**对源库 live GROUP BY
- 确定性 `reviewCharts`：同维去饼、高基数禁饼、裸时间戳折线丢掉或按日/月桶、空 encode 不 emit
- `layoutBoardPatch`：奇数末图拉满 72、查询条日期默认填 profile 区间、KPI 标题跟数据集走
- 金额类 label 含「单位分」时带 formatter（分→元），不改 chartQuery 语义以外的运行时
- 对外：`od_plan_charts`（可见规划）+ `od_generate_board`（唯一写入）；`od_layout_board` 不进模型环
- 单测扩 `gen-board.test.js`；代码提交时回写 `architecture.html#gen`（删掉文档里不存在的 `od_review_charts` 工具）

### M2（本期 · 问数加厚 · 已编码）

- `od_get_schema` 附带 ≤3 行 `sample`、confirmed `terms`、few-shot `questions`（调现有 Java knowledge / questions）
- `od_run_query` / `od_run_sql`：0 行返回 `insight`（诚实空结果）；失败**不再**发明华东/华北 stub 假行
- `od_list_datasets` Java 不可达时返回错误，不伪造 stub-sales
- 选图：结果可带 `chartTypeSuggested`（行数启发式）；不新开 `od_*` 工具
- **验真（2026-08-23）**：中间探查 `presentAnswer=false` → 折叠工具+表；最终答案按子问题拆卡 `presentAnswer=true`（默认表 + 查看 SQL）；散文数字必须来自卡；大表采样在 `extra`/`sqlHint` 带 `sampled` 等字段，结果卡角标「采样估算 · 非全表精确」

### 不在本期（M3）

- TableRAG、embedding 选表、sqlglot AST、ECharts 问数预览、JoyAgent HTML 报告
- 新工具 `od_resolve_intent` / `od_nl2sql` / `od_review_charts`

## 非目标

- 新对话 UI / 新高保
- 恢复 Python harness 或 live probe 出板
- 让模型自拼 DashboardPatch
- 改仪表盘编辑器、数据集管理、P007 壳
- P005 洞察报告

## 波及

| 列 | 内容 |
|----|------|
| 依赖 | P011 已交付的 `od_generate_board`；Java `profile-dataset`（`includeProbes=false`）；P004 生成语义 |
| 改动面 | Java conversation 规划/角色；`opendashboard-dsh-harness/packages/dsh-od-bi`；`docs/design/architecture.html#gen` |
| 不改 | OpenAPI（无新公开契约）；FE 对话壳；Java apply-patch 写闸门；`docs/prototypes/snapshots/` |
| 回归 | 本提案 PR-QG-*；P004 生成「能出 draft」不回退 |
| 不要动 | P011 done 目录状态；冻结快照 |

## 产品需求

分析师在对话里说「用订单表生成经营看板」或 `/board` 后，右侧编辑器里的 draft **像一张能读的经营板**：有查询条默认区间、KPI 名称像样、图不碎、折线不毛、没有半行空白。主题句影响选维/度量，不是只改标题。

## 交互与原型

无新表面。沿用 P011 dsh 对话 + 右侧 `DashboardEditorHost`。`hi-fi: none`。

## 技术设计

见 [design.md](./design.md)。成功标准只反链下方 ID。

## OpenAPI / 数据模型

本期无跨端 OpenAPI 变化。`od_generate_board` 增 `message` 为工具参数，仅 dsh Host。

## 兼容与风险

- 无 profile 统计时 review 降级为命名启发式，不 invent 近 30 天
- 高基数规则过严可能少饼图：可接受，用户可在编辑器改
- 与 P004「允许柱饼同维并存」冲突：本提案改为默认去同维饼，修订记在 P004 生成设计文首

## 验收 ID

判据只在 [acceptance.yaml](./acceptance.yaml)。

| ID | 标题 |
|----|------|
| PR-QG-01 | 评审接受 M1 范围（确定性 review + layout，不新加工具、不 live probe） |
| PR-QG-02 | `message` 进入规划加权 |
| PR-QG-03 | review：同维去饼、高基数禁饼、裸时间戳折线不落稿 |
| PR-QG-04 | layout：末图拉满；查询条日期默认来自 profile，无统计则不填假区间 |
| PR-QG-05 | KPI 不写死「订单数」；「单位分」带换算 formatter |
| PR-QG-06 | 不新增 od_* 工具；生成路径不 live probe |
| PR-QG-07 | `gen-board.test.js` 覆盖 M1 规则 |
| PR-QG-08 | `architecture.html#gen` 与 TS 实现一致（无假 `od_review_charts` 工具） |
| PR-QG-09 | Java last-resort 无业务词典：角色与规划只认 schema/profile/原文重叠 |
| PR-QG-10 | `od_get_schema` 带 sample(≤3) / terms / few-shot questions |
| PR-QG-11 | 问数 0 行 insight；失败不发明 stub 假行 |
| PR-QG-12 | LLM Goal 规划主路径 + 确认/澄清 + bind 闸 |

## 关联

- 现行出板（实现前）：[architecture.html#gen](../../design/architecture.html#gen)
- 表面：[P011](../P011-dsh-conversation-surface/)
- 生成语义：[P004](../P004-conversation/)
- 问数（M2）：[P006](../P006-ask-data/) · [P010](../P010-user-memory-ask-knowledge/)

## 修订记录

| 日期 | 说明 |
|------|------|
| 2026-08-22 | 立项草案：对照 refs + 现行 `od_*`；本期锁定 M1 |
| 2026-08-22 | 用户确认：对话应先可见 `od_plan_charts`（图类型/标题），再 `od_generate_board` 落稿；不恢复 layout/emit 长链、不 live probe |
| 2026-08-22 | 用户确认：规整 Java 架构，去掉写死业务词典；规划只认 schema/profile/原文重叠。Java 切片开工；TS M1 仍待接受 |
| 2026-08-22 | 用户要求做完剩余：TS M1 开工并编码；提案挪入 in-progress；architecture #gen 与测试集回写 |
| 2026-08-22 | 用户继续：升范围做 M2（schema 加厚 / 0 行 insight / 删 stub 假行）；architecture #ask 回写 |
| 2026-08-22 | 实跑反馈：图例用字段名、分未换算、板内叠图、右侧空白。补 fieldCfg alias + FE 吃 formatter/数量级；replace 先清组件；embedded 默认收配置；R9 去重 |
| 2026-08-22 | 左侧收起轨样式兼容；出板固化模板（对比并排≤2、折线全宽、禁半行留白；裸时间戳折线丢掉） |
| 2026-08-22 | L3：新对话 `/board` → `od_generate_board`（draft 68 · 6 图）；`/ask` 按支付状态汇总有数；DEPRECATED 提示 layout/emit/profile；architecture 主路径表述与 `#gen` 对齐 |
| 2026-08-22 | M2 瘦身：`enrichAskResult` 在 table/auto 时应用 `suggestChartType`；「单位分」附 `style.formatter` |
| 2026-08-22 | 用户否决「禁费率」个案补丁；先曾写槽位填充方案 |
| 2026-08-22 | 用户确认 plan 对标 LIDA：**先枚举分析目标再出图**；废弃槽位填充主叙事；写入 design §4.1 + gen-board `enumerateGoals` |
| 2026-08-22 | 输出深度梳理 HTML：[quality-upgrade-brief.html](./quality-upgrade-brief.html)（改动前/后、业界对照、代码边界） |
| 2026-08-22 | 用户要求：改造方案**明确定义**语义层 / 治理后再问 / 自动可视化三大流程并综合进 brief HTML §3 |
| 2026-08-22 | 用户确认：A/B/C **不强制自研**；开源模块可直接照搬/改编接到 OD；仅禁止无适配整仓替换运行时。回写 brief §3 / design |
| 2026-08-22 | 补 brief §4：大流程→小流程→QC 拆解；S1–S5 场景对照 OD/Cube/LIDA/SQLBot·Joy；优化优先级挂到小流程 |
| 2026-08-22 | §4 重写为流水线设计：总流程图 + 五阶段（编排/探查/规划/生成/展示）· LLM 边界 · S1 轨迹；对照表降级 |
| 2026-08-22 | 新增 brief §5：dsh Harness 分层、斜杠命令、od_* 工具表、/board /ask 真实时序、LLM vs Harness 边界 |
| 2026-08-22 | 新增 brief §6 **定稿**：八项准确技术嵌入 S0–S6；开源用/改编/不用选型表；总架构锁定 dsh+gen-board+Java+/dimensions |
| 2026-08-22 | **阶段③修订**：分析规划改为 LLM 为中心 + 可选用户确认；规则 enumerateGoals 降为降级；对照 LIDA/DeerFlow/Joy 写入 brief §4 |
| 2026-08-22 | 方案落盘 [goal-planning-design.md](./goal-planning-design.md)：大→小流程、能力卡、System/User 提示词、S1 实例、/board 协议、验收与工程序；design §4.1 / M1.6 |
| 2026-08-22 | 综合「智能问数 Agent」行业路线图进 brief §5：阶段定位、八项技术×OD、趋势取舍、P0–P3 执行序；归档原图 |
| 2026-08-22 | brief §4 扩为**双意图流水线**：补全 /ask 问数流程、问数×出板工具复用矩阵、业界问数对照（SQLBot/Joy/Vanna/Cube/DeerFlow）；左侧导航同步 |
| 2026-08-22 | brief §2 扩为改动前双轨：问数现状端到端、业界问数对照表、出板改动前、问数×出板复用分叉 |
| 2026-08-22 | brief §13 / design §11：业界 Spider·BIRD·EX 评测跑法；OD 对齐策略（私有 EX 金标主门 + 公开集可选冒烟） |
| 2026-08-22 | brief §13.3：出板无 Spider 级公开榜；对照 LIDA VER/SEVQ、nvBench、DashArena；OD 主门仍确定性金标 |
| 2026-08-22 | 用户确认方向：分段评测 + 独立于对话的 eval；落盘 [eval-design.md](./eval-design.md)（E0 包/CLI → E1 薄服务；plan/query/viz/layout/e2e） |
| 2026-08-22 | eval-design §1.1：开源评测库对照（BIRD/Spider EX 可改编；SQLBot/Vanna 无标准评测架；出板借 LIDA 维） |
| 2026-08-22 | **E0.1 已编码**：`packages/dsh-od-eval`（plan/bind/layout/guard/ex/viz 金标 + `pnpm eval`）；EX 结果集比对内核齐备，真连 BI 留 E0.2 |
| 2026-08-22 | **优先级纠正**：先落地问数/出板流水线，评测 E0.2+ 暂缓。已实施 **P0** knowledge metrics→fields、**P1** 维值 valueMap→fieldCfg、问数 encode 禁 SUM(ratio)、CapabilityCard/bindGoals 脚手架；`/board` 协议改为确认后再 generate |
| 2026-08-22 | **M1.6 已编码**：`goal-planner.js`（LLM→bind→review，clarify/降级）；fixture 单测 + `pnpm test` 56 pass / `pnpm eval` 12；PR-QG-12 → pass |
| 2026-08-22 | 用户确认问数结果卡对齐 SQLBot：**查看 SQL + 复制**挂在表/图/KPI 卡脚；`sqlHint` 进 node data；删重复 SqlBlock；dsh 已重启 |
| 2026-08-23 | 用户确认：中间探查不出图；`presentAnswer` 门控（默认折叠工具+表）；仅最终答案卡出图/表+SQL；停用 autoChart 改写 chartType |
| 2026-08-23 | **问数验真**：多子问题每问一卡 `presentAnswer`；散文禁无卡造数；采样角标「采样估算·非全表精确」；Java `extra.sampled/sampleN/estRows/scaleFactor`；LLM 文本标明采样 |
| 2026-08-23 | **done**：阻塞验收 PR-QG-01…11 + PR-QG-12 均 pass；requirements §2.10 回写；路线图挪 `done/`；PR-DSH-05 主写路径改为 `od_generate_board` |
