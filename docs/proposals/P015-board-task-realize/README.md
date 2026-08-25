---
id: P015
title: 对话式仪表盘规划、生成与质量闭环
status: in-progress
milestone: v0.6
date: 2026-08-24
design:
  - docs/proposals/P015-board-task-realize/design.md
  - docs/proposals/P015-board-task-realize/architecture-assessment.md
  - docs/proposals/P015-board-task-realize/quality-evaluation.md
  - docs/proposals/P015-board-task-realize/t-pay-order-case-study.md
acceptance: docs/proposals/P015-board-task-realize/acceptance.yaml
gates:
  proposal: accepted
  hi-fi: none
  code: wip
  acceptance: none
architecture: docs/design/architecture.html
depends: [P004, P006, P008, P010, P011, P012]
implementation:
  - opendashboard-dsh-harness/packages/dsh-od-bi/src/board-worker.js
  - opendashboard-dsh-harness/packages/dsh-od-bi/src/realize-task.js
  - opendashboard-dsh-harness/packages/dsh-od-bi/src/data-trans.js
  - opendashboard-dsh-harness/packages/dsh-od-bi/src/goal-planner.js
  - opendashboard-dsh-harness/packages/dsh-od-eval/cases/board-cockpit/BOARD-COCKPIT-S1-01.json
  - opendashboard-dsh-harness/packages/dsh-od-bi/src/gen-board.js
  - open-dashboard-backend/open-dashboard-app/src/main/java/io/opendashboard/application/conversation/FieldSemantics.java
  - open-dashboard-backend/open-dashboard-app/src/main/java/io/opendashboard/application/conversation/DeterministicPlanner.java
  - opendashboard-dsh-harness/packages/dsh-od-bundle/cordis.patch.yml
---

# P015 · 对话式仪表盘规划、生成与质量闭环

> **状态** `in-progress` · 路线图 [进行中](../../product/roadmap/in-progress/) · 无冻结高保 · worker 出板主路径已手验；完整质量发布门（48 例/盲评）仍待做。

## 开发入口

| 你要 | 去看 |
|------|------|
| 范围、边界、当前完成度 | 本文 |
| 用户怎么提问、流程怎么走、每一步展示什么 | [design.md](./design.md) |
| 当前源码漏洞、开源对标与目标源码架构 | [architecture-assessment.md](./architecture-assessment.md) |
| 如何证明整体仪表盘质量有提升 | [quality-evaluation.md](./quality-evaluation.md) |
| `t_pay_order` 真实坏板复盘与目标结果 | [t-pay-order-case-study.md](./t-pay-order-case-study.md) |
| 唯一验收清单 | [acceptance.yaml](./acceptance.yaml) |
| 开源对照 | 本地 `../refs/` 的 JoyAgent / DataEase / DeerFlow / Ossie；官方 GitHub 的 MetricFlow / Cube / WrenAI / LIDA / CompassQL / Draco / Superset / Lightdash / LangGraph，取舍见综合评估 |
| 当前代码落点 | `board-worker.js` · `realize-task.js` · `data-trans.js` · `goal-planner.js` · `cordis.patch.yml` |
| 不要做 | 恢复 Python harness；把 query/worker 细工具交给 Lead；将未实现目标写进 `requirements.md`；修改冻结快照；对话分析报告（HTML/MD 快照 → [P016](../P016-conversation-analysis-report/)） |

## 背景与目标

当前链路已经能从数据集生成一张 draft，但“能生成”不等于“值得发布”。主要问题不是某个提示词，而是五段能力没有形成闭环：

1. 用户要问一个数、做整页看板还是修改已有看板，路由不稳定；
2. 数据集主要靠显式绑定或名称匹配，缺少候选、置信度和字段覆盖判断；
3. 规划容易先套固定槽位，业务问题、指标口径与数据可实现性没有同时约束；
4. KPI、空结果、字段替换、数据变换与最终运行态之间存在验真缺口；
5. 最终只告诉用户“生成完成”，没有披露成功、修复、跳过和风险，也没有基准证明新版更好。

P015 的目标是建立一条可度量、可解释、可修复的出板主路径：

```text
用户问题
  → 意图路由
  → 授权数据集解析
  → AnalysisBrief
  → 规划并确认
  → board worker 逐任务验真/修复/选图
  → 整板质量闸
  → 原子提交
  → 结果摘要与继续修改
```

成功不是“工具调用成功”，而是候选方案相对当前基线通过 [质量发布门](./quality-evaluation.md)：硬错误为零、综合分显著提高、盲评和线上返工指标不回退。

## 范围

**做**

- 识别问数、首次整板生成、单图修改、整页重做、解释/追问六类意图；默认不明确时走问数，不擅自生成整板。
- 在当前用户与工作区有权数据集中，按名称、业务术语、已确认指标、字段覆盖和数据质量召回候选；低置信度必须让用户选择。
- 用结构化 `AnalysisBrief` 固化业务目标、时间范围、分析对象、候选指标、约束与未知项。
- 规划只决定“回答什么问题、使用什么字段与聚合、放在哪个信息层级”，不由模型拍脑袋锁图种。
- 用户确认后由单个受限 `od_board_worker` 执行；每个图表任务真实查询、画像、最多两次受控修复，再由确定性策略选图。
- KPI 与非 KPI 一样必须经过真实查询；禁止用伪造 `rowCount=1` 直接提交。
- 任务失败可部分交付，但必须在最终结果中披露；全失败或整板硬闸失败不得产生空 draft。
- 结果卡展示 draft 预览、任务完成摘要、修复/跳过原因、质量警告和下一步操作。
- 建立基线集、自动硬闸、人工盲评、候选发布阈值和上线后的返工指标。

**不做**

- 让一个子 agent 对应一张图；本期只有一个 board worker，任务级并发由 harness 控制。
- 让模型直接写 SQL、自由选择任意图种或绕过整板 review。
- 持久化查询结果行；只持久化字段、聚合、过滤、排序、格式和布局配置。
- 在 Java 运行态尚不能表达同一变换前，把仅对预览缓存生效的 `od_data_trans` 结果提交为正式图表。
- P004 已有的单图增改删具体 Patch 算法、P008 权限模型、P010 知识治理管理面。
- 本轮直接实现代码、修改 OpenAPI、更新现行架构或冻结高保；这些随对应实现提交推进。

## 产品原则

| 原则 | 约束 |
|------|------|
| 先理解，再规划 | 没有明确数据集与 `AnalysisBrief`，不进入整板规划 |
| 先证据，再选图 | 图种只基于真实 `ResultProfile` 与整板约束确定 |
| 指标口径优先 | confirmed 指标优先；比率/客单价禁止直接 `SUM` |
| 一次确认，一次提交 | 规划确认后可执行；所有图表先 staging，整板通过后原子写入 |
| 部分成功不伪装全成功 | 跳过、修复、警告都进入结果摘要，允许定向重试 |
| 质量可以比较 | 同一用例、同一数据快照、同一预算，基线与候选至少运行三次 |

## 当前实现与目标差距

| 环节 | 当前已有 | P015 完成前必须补齐 |
|------|----------|----------------------|
| 语义 | 单字段 `role` + 名称/画像启发式 | 版本化 `SemanticSnapshot`、字段用途集合、正式指标/默认过滤、关系与语义就绪 |
| 规划 | 问题 + intent + dim/measure；规划不锁图种，但 prompt 强制固定驾驶舱槽位 | `AnalysisBrief → BoardQuestion`、问题覆盖与去重、时间/口径约束；固定模板仅作无主题先验 |
| 执行 | `od_board_worker` 与细工具白名单；进程内 Map staging | 持久 `BoardRun/TaskRun/Event`、任务预算、受控修复、幂等、重启恢复与语义版本失效 |
| 取数 | 非 KPI 任务走 `query/chart`；KPI 仍伪造 `rowCount=1` | 所有任务由 `QuerySpec` 编译并真实查询；字段/聚合/过滤/权限硬校验 |
| 选图 | 基于 intent、时间维和截断行数的 if/else | 完整 `ResultProfile` + 候选生成 + hard constraints + soft score + reason codes |
| 变换 | `od_data_trans` 修改内存预览 | 未能写入运行态前不得 commit；后续需正式 `encode.transforms` 契约 |
| 结果 | 成功或失败工具结果 | 用户可见的完成/修复/跳过摘要与定向重试 |
| 质量 | `pnpm eval` 19 条 + BOARD-E2E-ORDERS-01 手验 | 48 例×3、盲评、灰度返工（PR-REAL-16/17） |

## 波及

| 列 | 内容 |
|----|------|
| 依赖 | P006 默认问数轨；P004 首次生成与同板修改；P008 有权数据集；P010 confirmed 术语/指标；P011 dsh 表面；P012 现有 schema/profile/review 质量闸 |
| 预期改动面 | Harness 意图路由、数据集解析、planner、worker、trace/eval；dsh 对话中的确认卡、进度与结果卡；若正式支持变换，再先更新 OpenAPI 与 Java runtime |
| 本轮文档改动 | P015 README、端到端 design、quality evaluation、acceptance、roadmap 与 proposal 索引 |
| 回归 | P004 PR-CONV-13/14；P006 默认问数边界；P012 PR-QG-02…05、09…12；P008 dataset:use 权限交集 |
| 替代 | 替代 P015 早期“只把 get_data/data_trans/save 接进 worker 就能提升质量”的表述；worker 是执行器，不是质量保证本身 |
| 不改 | `docs/design/openapi.yaml`、`docs/design/architecture.html`、`docs/product/requirements.md`、冻结快照、Python harness |

## 验收标准

唯一真相见 [acceptance.yaml](./acceptance.yaml)：PR-REAL-01…21。重点新增门为：

- PR-REAL-12：问题路由与数据集置信度选择；
- PR-REAL-13：可修改、可换表的规划确认卡；
- PR-REAL-14：执行与结果摘要不隐藏失败；
- PR-REAL-15：KPI 真实验真与变换运行态一致；
- PR-REAL-16：固定基准证明候选质量提升；
- PR-REAL-17：盲评、灰度和线上返工指标不回退；
- PR-REAL-18：`t_pay_order` 新建数据集、画像缺失和规划失败链路不得生成无意义看板。
- PR-REAL-19：版本化语义快照、正式指标与关系安全取代单字段 role；
- PR-REAL-20：类型化编译、持久 BoardRun、幂等恢复与生产 fallback 同闸；
- PR-REAL-21：完整结果画像、约束式选图、问题覆盖 review 与布局求解可回放。

## 交付顺序

1. 固定 baseline、用例集、评分器和 trace schema；先测现状。
2. 实现意图路由、数据集解析与 `AnalysisBrief`，补确认/结果交互高保并冻结。
3. 补齐 worker 的 KPI 验真、任务状态、受控修复和 `ResultProfile`。
4. 关闭预览态临时变换的生产 commit；需要正式变换时先改 OpenAPI，再改 Java 与 Harness。
5. 跑候选三次、盲评和回归；满足发布阈值后灰度。
6. 代码验证时同提交更新 `architecture.html`；产品验收后回写 requirements，P015 才能 done。

## 修订记录

| 日期 | 说明 |
|------|------|
| 2026-08-24 | 用户确认：数据特征 → 任务（不定图种）→ dsh worker 取数/变换 → harness 选图/单位；细工具只给 worker |
| 2026-08-24 | 用户要求落地整体方案并说明如何保证质量提升：范围扩展为问题路由、数据集选择、规划确认、执行修复、结果展示和可量化质量发布门 |
| 2026-08-24 | 明确修订：worker 本身不等于质量提升；KPI 必须真实验真，预览态变换无法在运行态复现时禁止提交 |
| 2026-08-24 | 补齐 quality-evaluation.md：CI 19 条金标 + 线上 BOARD-E2E-ORDERS-01（dashboard 11）；PR-REAL-11 pass |
| 2026-08-25 | 用运行态 draft 10 复盘 `t_pay_order` 坏板：60 字段但画像 0 行，规划失败后 `od_compose_board` 按字段顺序生成 `SUM(MchId/MchType/MchRate)`；新增 P0 语义就绪闸和 PR-REAL-18。dashboard 11 证明 worker 主路已有改善，但不抵消该降级漏洞 |
| 2026-08-25 | 深入审计当前 Java/Harness 源码并对标本地 ref 与官方开源：确定采用 Ossie/MetricFlow/Cube 语义思想、WrenAI/JoyAgent 受控流程、CompassQL/Draco 约束推荐和现有 OD runtime 的组合；新增源码级综合评估与 PR-REAL-19…21，固定驾驶舱降为先验而非硬模板 |
| 2026-08-25 | 落地标识字段启发式与 compose 过滤：`FieldSemantics` + `DeterministicPlanner` 不再 SUM ID；注释枚举写入 valueMap；eval `BOARD-BIND-JUNK-ID-01` |
| 2026-08-25 | 生产写路径 fail-closed：`od_compose_board` 与 Java `compose-board` 返回 ok=false 不写 draft。semanticReady 闸与 KPI 真查仍待做 |
