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

- 一级「对话」四栏工作区；编辑器 AI 侧栏
- Auto / Plan；风格模板；SSE 流式生成 Dashboard draft
- Schema Guard + DashboardPatch；版本回滚；复用现有分享

## 非目标（本期）

- 监控告警、定时推送、多模型 Skills/MCP（见 roadmap 二期）
- 替代仪表盘作为运行时真相

## 验收要点（交付时写入 requirements）

| ID | 要点 |
|----|------|
| PR-CONV-01 | 开关 `opendashboard.conversation.enabled` 与权限 `conversation:use` |
| PR-CONV-02 | 四栏工作区可完成「选数据集 → 对话 → 预览 draft」 |
| PR-CONV-03 | SSE 事件集与 design 文档一致；可 apply DashboardPatch |
| PR-CONV-04 | 产物为可编辑 Dashboard draft，取数走现有 chartQuery / datasetQuery |

## 关联

- 设计：[../design/conversation.md](../design/conversation.md)
- 原型：`prototypes/hi-fi/conversation-workspace.html`
- Roadmap：v0.5 / P1
