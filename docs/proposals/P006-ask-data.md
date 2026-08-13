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

### Ask-3（后）

- NL2SQL / 受控 SQL；解释 SQL；澄清打断

## 非目标

- 把查询结果行持久化进布局或 HTML  
- DeerFlow 式沙箱任意 SQL  
- 替代 chartQuery 运行时取数  

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
