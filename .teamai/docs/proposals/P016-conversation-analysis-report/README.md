---
id: P016
title: 对话分析报告
status: in-progress
milestone: v0.6
date: 2026-08-24
prototype: .teamai/docs/prototypes/hi-fi/conversation-ask-dsh.html
acceptance: .teamai/docs/proposals/P016-conversation-analysis-report/test/acceptance.yaml
design: .teamai/docs/proposals/P016-conversation-analysis-report/design/design.md
gates:
  proposal: accepted
  hi-fi: wip
  code: wip
  acceptance: none
architecture: .teamai/docs/design/architecture.html
depends: [P004, P006, P011, P015]
implementation:
  - opendashboard-dsh-harness/packages/dsh-od-bi/src/analysis-worker.js
  - opendashboard-dsh-harness/packages/dsh-od-bi/src/insight.js
  - opendashboard-dsh-harness/packages/dsh-od-bi/src/report-render.js
  - opendashboard-dsh-harness/packages/dsh-od-bi/src/board-worker.js
  - opendashboard-dsh-harness/packages/dsh-od-bi/src/commands.js
  - opendashboard-dsh-harness/packages/dsh-od-bundle/cordis.patch.yml
  - opendashboard-dsh-harness/packages/dsh-od-nodes/lib/client.js
  - opendashboard-dsh-harness/packages/dsh-od-eval/cases/analysis-report/
  - open-dashboard-frontend/src/conversation/views/ConversationDshSurface.vue
  - .teamai/docs/prototypes/hi-fi/conversation-ask-dsh.html
  - .teamai/docs/design/architecture.html
---

# P016 · 对话分析报告

> **状态** `in-progress` · 路线图 [进行中](../../product/roadmap/in-progress/) · 高保 wip · 代码 wip · 验收 none

## 开发入口

| 你要 | 去看 |
|------|------|
| 范围、边界、当前完成度 | 本文 |
| 工具链、右侧预览、取数上限 | [design.md](./design/design.md) |
| 唯一验收清单 | [acceptance.yaml](./test/acceptance.yaml) |
| 对照 JoyAgent AutoAnalysis | `refs/joyagent-jdgenie-data_agent`：`get_data` → `data_trans` → `insight` → `save_insight`；UI 为 ActionPanel HTML/MD 文件预览 |
| 当前代码落点 | `analysis-worker.js` · `insight.js` · `report-render.js` · `ConversationDshSurface.vue` · `cordis.patch.yml` |
| 不要做 | 可刷新 Dashboard；P005 Umo 看板解读；JoyAgent 单次 10k 行 / 90s；细工具交给 Lead |

## 给谁 / 要解决什么

分析师在对话里要一份**归因/解读报告**（HTML 或 Markdown 文件），而不是问数卡，也不是可刷新看板。交互对齐 JoyAgent：对话在左、文件在右。

## 范围

**做**

- 对话第三轨：问数 / 出板 / **分析报告**
- 入口：slash `/report`；「写分析报告 / 归因解读」走此轨
- 专用分析工具链（仅 spawn worker，depth≥1）：`od_get_data(purpose=analysis)` → `od_data_trans` → `od_insight` → `od_save_insight` → `od_commit_report`
- 取完数可以换问题/换维再取；图种在有行之后由 harness 填写 `suggestedChartType`
- JoyAgent 式右侧节点轨迹：Lead 调用分析 worker 后立即打开；按真实父子调用顺序展示 Agent/取数/变换/洞察/保存/成稿节点，节点含工具名、业务摘要、状态、耗时，可展开查看结构化输入和输出摘要
- 完成后默认切换最终文件，但保留「过程 / HTML / MD」切换，节点轨迹不因成稿消失
- 右侧最终文件预览：HTML（`iframe` `srcdoc`，sandbox 不含 `allow-scripts`）或 MD（轻量渲染，不加 marked）
- 与看板互斥：开报告收起看板，开看板收起报告；切会话两边都关
- 聚合取数上限 **≤200 行 / 15s**（JoyAgent 10k/90s 对 OD 大表风险过高；出板仍 ≤20 行 / 8s）

**不做**

- 写入 Dashboard draft / `dashboardId`
- P005：从已有看板生成 Umo 解读稿 + live 图引用（禁止内嵌结果行）
- 把明细大表 dump 进报告；禁止绕过聚合 `chartQuery`
- dsh 第二 spawn 槽（仍共用 `od_board_worker`，靠 prompt 首行 `ANALYSIS_REPORT=1` 分流）
- 引入 scipy/pandas；insight 为 JS 确定性规则

## 与相邻提案

| 轨 | 提案 | 产物 |
|----|------|------|
| 问数 | P006 / P011 | 对话内表/图卡 |
| 出板 | P004 / P015 | 可刷新 Dashboard draft，右侧嵌编辑器 |
| **对话分析报告** | **P016** | 会话快照 HTML/MD 文件，右侧文件预览 |
| 看板解读进 Umo | P005 draft | live 图引用，禁止内嵌结果行；未接受，不要实现 |

## 验收 ID

判据只在 [acceptance.yaml](./test/acceptance.yaml)。

| ID | 标题 |
|----|------|
| PR-ANR-01 | `/report` 入口与 Lead 一次 spawn |
| PR-ANR-02 | 右侧 HTML / MD 文件预览 |
| PR-ANR-03 | 产物不是 dashboardId |
| PR-ANR-04 | 细工具 Lead 不可调 |
| PR-ANR-05 | 分析取数 ≤200 行 / 15s |
| PR-ANR-06 | 图种在有数后由 harness 确定 |
| PR-ANR-07 | 取完可换维再取 |
| PR-ANR-08 | 与 P005 边界：快照文件 vs live Umo |

## 波及

| 列 | 内容 |
|----|------|
| 依赖 | P006 问数轨；P004 出板轨；P011 dsh 表面；P015 board worker / 单 spawn 槽 |
| 预期改动面 | harness 分析工具、spawn persona 分流、dsh report Node、Vue 右侧文件栏、高保 demo |
| 回归 | P015 出板上限与细工具 guard；P006 问数不提右侧；P011 postMessage 源 |
| 不改 | OpenAPI、Java chartQuery 契约、冻结快照、P005 实现 |

## 修订记录

| 日期 | 说明 |
|------|------|
| 2026-08-24 | 用户确认：JoyAgent AutoAnalysis 工具链；取完可改问题；图种事后定；产物是分析报告不是 Dashboard；OD 取数须严于 10k/90s |
| 2026-08-25 | 右侧文件栏补 HTML/MD 切换与下载；落地页第三轨入口「分析报告」；验收 PR-ANR-03/04/05 单测 pass |
| 2026-08-25 | 实施收口：buildReportFollowup、分析轨 note/换维、eval analysis stage（ANR-REPORT-*）、architecture 回写；PR-ANR-01/06/07 pass；仅 PR-ANR-02 手验待 |
| 2026-08-25 | 与出板同一缺口：worker `od_commit_report` 在子会话，已把 `report_ready` 提升到 Lead `od_board_worker`，右侧 HTML/MD 预览才能打开。PR-ANR-02 仍待手验 |
| 2026-08-25 | 用户补充确认 JoyAgent 交互：分析 worker 运行期间右侧必须持续展示过程明细，完成后在同一右栏展示 HTML/MD 产物；禁止只在左侧显示 Think/完成文案。新增 `od-report-progress` 桥接。 |
| 2026-08-26 | 用户指出阶段状态条不足以理解 Agent 在做什么；对照 JoyAgent `PlanView` / `ActionPanel` 改为可展开节点轨迹，展示工具名、输入、输出、耗时和父子层级，成稿后仍可切回「过程」。 |
| 2026-08-26 | 修复：节点轨迹 `od-report-progress` 在成稿后仍把 `hasReport` 清掉，右侧只剩过程、看不到 HTML；同时 `report_ready` 在 prompt 非字符串时被 expectedKind 丢掉。进度不再覆盖已打开的文件，子会话 HTML 始终提升到 Lead。 |
