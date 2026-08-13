---
id: P004
title: 对话分析（内测一期）
status: in-progress
milestone: v0.5
date: 2026-08-11
prototype: prototypes/hi-fi/conversation-workspace.html
design: docs/design/conversation.md
---

# P004 · 对话分析（内测一期）

## 范围

- 一级「对话」两段式工作区（落地 → 工作台）；编辑器 AI 侧栏
- Auto / Plan；风格模板；SSE 流式生成 Dashboard draft
- Schema Guard + DashboardPatch；版本回滚；复用现有分享
- Harness：见 [ai-harness.md](../design/ai-harness.md)

## 非目标（本期）

- 监控告警、定时推送、多模型 Skills/MCP（见 roadmap 二期）
- 替代仪表盘作为运行时真相
- 洞察报告（→ [P005](./P005-insight-report.md)，v0.6）

> **问数默认轨** 见 [P006](./P006-ask-data.md) · [ai-architecture.md](../design/ai-architecture.md)；P004 侧重 Patch 闭环与生成/采纳落地。

## 验收拆分（A / B / C）

### Phase A — 契约与开关

| ID | 要点 |
|----|------|
| PR-CONV-A1 | 开关 `opendashboard.conversation.enabled` 与权限 `conversation:use` |
| PR-CONV-A2 | Controller SSE 骨架 + StubHarness 确定性模板（KPI+趋势） |
| PR-CONV-A3 | 前端 `/conversations` 壳接 stub SSE；事件可见 |

### Phase B — Patch 闭环

| ID | 要点 |
|----|------|
| PR-CONV-B1 | Schema Guard + PatchApplier + revision |
| PR-CONV-B2 | LiveCanvas / `chart_ready`；取数仅 chartQuery / datasetQuery |
| PR-CONV-B3 | Auto / Plan + confirm-plan；「在编辑器打开」同一次生成的图 |
| PR-CONV-B4 | 编辑器 AI 拾取侧栏共享 conversationId |

### Phase C — LLM 增强

| ID | 要点 |
|----|------|
| PR-CONV-C1 | OpenAI 兼容客户端；结构化 Patch JSON |
| PR-CONV-C2 | 失败回退确定性规划器；run journal（可选） |

## 验收要点（交付时写入 requirements）

| ID | 要点 |
|----|------|
| PR-CONV-01 | 开关与权限闸门 |
| PR-CONV-02 | 两段式工作区可完成「选数据集 → 对话 → 预览 draft」 |
| PR-CONV-03 | SSE 事件集与 design 一致；可 apply DashboardPatch |
| PR-CONV-04 | 产物为可编辑 Dashboard draft，取数走现有 chartQuery / datasetQuery |

## 关联

- 设计：[../design/dashboard-generation.md](../design/dashboard-generation.md) · [../design/conversation.md](../design/conversation.md) · [../design/ai-harness.md](../design/ai-harness.md)
- 原型：`prototypes/hi-fi/conversation-workspace.html`
- Roadmap：v0.5 / P1；洞察报告 → v0.6 / P005
