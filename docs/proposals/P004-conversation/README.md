---
id: P004
title: 对话分析（内测一期）
status: in-progress
milestone: v0.5
date: 2026-08-11
prototype: docs/prototypes/hi-fi/conversation-workspace.html
design:
  - docs/proposals/P004-conversation/design.md
  - docs/proposals/P004-conversation/harness-design.md
  - docs/proposals/P004-conversation/dashboard-generation-design.md
acceptance: docs/proposals/P004-conversation/acceptance.yaml
gates:
  proposal: accepted
  hi-fi: wip
  code: wip
  acceptance: blocked
architecture: docs/design/architecture.html
contract: docs/design/openapi.yaml
implementation: [open-dashboard-frontend/src/conversation/, open-dashboard-backend/, opendashboard-harness/]
---

# P004 · 对话分析（内测一期）

> **状态** `in-progress` · 路线图 [进行中](../../product/roadmap/in-progress/) · 高保 wip · 代码 wip · 验收 blocked

## 开发入口

实现本提案时按这个包读，不要从聊天或其它提案猜：

| 你要 | 去看 |
|------|------|
| 范围与非目标 | 本文 |
| 怎么验收 | [acceptance.yaml](./acceptance.yaml) |
| 对话交互 | [design.md](./design.md) |
| Agent / SSE | [harness-design.md](./harness-design.md) |
| 生成看板（现行代码） | [architecture.html#gen](../../design/architecture.html#gen) · [业界对照](../../design/architecture.html#compare) |
| 生成看板（提案设计） | [dashboard-generation-design.md](./dashboard-generation-design.md) |
| 原型 | 当前增量 [`conversation-workspace.html`](../../prototypes/hi-fi/conversation-workspace.html)；**尚未冻结快照** |
| 代码落点 | `open-dashboard-frontend/src/conversation/` · `opendashboard-harness/` · Java `/api/internal/bi/*` |
| 不要做 | 问数结果卡双按钮（归 P006）；权限消费面（归 P008）；SQLBot 出现在非编辑器页（归 P007） |
| 当前范围 | [路线图 · 进行中](../../product/roadmap/in-progress/)：PR-CONV-01…08 |

## 波及

| 列 | 内容 |
|----|------|
| 依赖 | 已交付仪表盘 draft / chartQuery；问数默认轨配合 [P006](../P006-ask-data/) |
| 改动面 | FE `src/conversation/` · `opendashboard-harness/` · Java `/api/internal/bi/*` · OpenAPI |
| 不改 | 问数结果卡交互（P006）；工作台「我的资源」（P008）；产品壳收缩规则（P007） |
| 回归 | PR-CONV-01…08；P006 的 PR-ASK-02 / 05；P007 的 PR-SH-08（SQLBot 范围） |

## 范围

- 一级「对话」两段式工作区（落地 → 工作台）；编辑器 AI 侧栏
- Auto / Plan；风格模板；SSE 流式生成 Dashboard draft
- Schema Guard + DashboardPatch；版本回滚；复用现有分享
- Harness：见 [harness-design.md](./harness-design.md)

## 非目标（本期）

- 监控告警、定时推送、多模型 Skills/MCP（见 roadmap 二期）
- 替代仪表盘作为运行时真相
- 洞察报告（→ [P005](../P005-insight-report/README.md)，v0.6）

> **问数默认轨**见 [P006](../P006-ask-data/README.md) · [Ask-data 设计](../P006-ask-data/design.md)；P004 侧重 Patch 闭环与生成/采纳落地。

## 工程分期（不作为产品验收 ID）

### Phase A — 契约与开关

| ID | 要点 |
|----|------|
| TASK-CONV-A1 | 开关 `opendashboard.conversation.enabled` 与权限 `conversation:use` |
| TASK-CONV-A2 | Python Harness 暴露 `/harness/v1/*` SSE 与健康检查 |
| TASK-CONV-A3 | 前端 `/conversations` 直连 Harness；Java 不承担 Agent run |

### Phase B — Patch 闭环

| ID | 要点 |
|----|------|
| TASK-CONV-B1 | Schema Guard + PatchApplier + revision |
| TASK-CONV-B2 | LiveCanvas / `chart_ready`；取数仅 chartQuery / datasetQuery |
| TASK-CONV-B3 | Auto / Plan + confirm-plan；「在编辑器打开」同一次生成的图 |
| TASK-CONV-B4 | 编辑器 AI 拾取侧栏共享 conversationId |

### Phase C — LLM 增强

| ID | 要点 |
|----|------|
| TASK-CONV-C1 | OpenAI 兼容客户端；结构化 Patch JSON |
| TASK-CONV-C2 | 失败回退确定性规划器；run journal（可选） |

## 验收 ID

判据、路径、状态与证据只在 [acceptance.yaml](./acceptance.yaml)。

| ID | 标题 |
|----|------|
| PR-CONV-01 | 开关与权限闸门 |
| PR-CONV-02 | 两段式工作区可完成选数据集 → 对话 → 预览 draft |
| PR-CONV-03 | SSE 事件集可 apply DashboardPatch |
| PR-CONV-04 | 产物为可编辑 Dashboard draft |
| PR-CONV-05 | SQLBot 仅仪表盘编辑器 |
| PR-CONV-06 | Vue 直连 Python Harness |
| PR-CONV-07 | Harness 只经内部 Token 调 Java BI |
| PR-CONV-08 | 可问数据集 = conversation:use ∩ dataset:use |

上表 ID 不得在 design 文件中另定义。

## 关联

- 现行生成流程：[architecture.html#gen](../../design/architecture.html#gen) · [业界对照](../../design/architecture.html#compare)
- 设计：[design.md](./design.md) · [dashboard-generation-design.md](./dashboard-generation-design.md) · [harness-design.md](./harness-design.md)
- 原型：`docs/prototypes/hi-fi/conversation-workspace.html`
- 权限与可问数据：[P008](../P008-permission-aware-workbench/)
- Roadmap：v0.5 / P1；洞察报告 → v0.6 / P005

## 修订记录

| 日期 | 说明 |
|------|------|
| 2026-08-17 | 把已编码生成看板流程与 DataEase / JoyAgent / DeerFlow 对照写入 architecture.html |
| 2026-08-17 | 按后续确认统一为 Vue 直连 Python Harness、SQLBot 仅编辑器展示，并将可问权限交给 P008 |
| 2026-08-17 | 补波及表；验收细节只保留在 yaml |
| 2026-08-17 | 本月不交付 PR-CONV-08（可问集合）；等 P008 契约与 askable API |
| 2026-08-18 | 对话画布对齐工作台 `--od-bg`，落地页加轻靛蓝光晕（对照 ChatGPT / Kimi 居中输入） |
