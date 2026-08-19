---
id: P010
title: 用户记忆与问数知识库
status: in-progress
milestone: v0.5
date: 2026-08-18
design: [docs/proposals/P010-user-memory-ask-knowledge/design.md]
acceptance: docs/proposals/P010-user-memory-ask-knowledge/acceptance.yaml
gates:
  proposal: accepted
  hi-fi: none
  code: wip
  acceptance: none
architecture: docs/design/architecture.html
contract: docs/design/openapi.yaml
implementation: [opendashboard-harness/agent/user_memory.py, opendashboard-harness/agent/knowledge.py, opendashboard-harness/eval/]
depends: [P004, P006, P008]
---

# P010 · 用户记忆与问数知识库

> **状态** `in-progress` · 路线图 [进行中](../../product/roadmap/in-progress/) · 高保 none · 代码 wip · 验收 none

[P009](../P009-workspace-governance/) 是工作区/IAM 演进草案。本提案是 **不搬工作空间** 的第一刀：用户级 facts + 数据集术语/SQL 示例。

## 开发入口

| 你要 | 去看 |
|------|------|
| 范围与非目标 | 本文 |
| 详细设计 | [design.md](./design.md) |
| 怎么验收 | [acceptance.yaml](./acceptance.yaml) |
| 评测 | [P004 harness-evaluation.md](../P004-conversation/harness-evaluation.md) · `opendashboard-harness/eval/` |
| 代码落点 | `opendashboard-harness/agent/user_memory.py` · `knowledge.py` · `GET/PUT /harness/v1/knowledge/{datasetId}` · `GET /harness/v1/memory` |
| 相邻提案 | 运行时/评测 [P004](../P004-conversation/)；问数轨 [P006](../P006-ask-data/)；身份/askable [P008](../P008-permission-aware-workbench/)；工作区全景 [P009](../P009-workspace-governance/) |
| 不要做 | 内置登录、工作空间、TableRAG、DGP、把知识写进 architecture.html（验收前） |

## 波及

| 列 | 内容 |
|----|------|
| 依赖 | P004 事件日志与 eval runner；P008 principal 贯穿 Harness |
| 改动面 | Harness 记忆/知识文件存储、SQLBot prompt 注入、eval 案例 |
| 不改 | `architecture.html`（验收前）；SQLBot/DeerFlow 整仓；P005 洞察；P009 工作区模型 |
| 回归 | PR-MEM-01…06；P006 PR-ASK-04；P004 eval L1 |

## 范围

- **用户级记忆**：跨对话 facts（常用数据集、偏好），按 `users/{userId}/` 隔离；注入有上限；不把聊天记录当记忆。
- **数据集级知识**：术语 glossary + SQL 示例；生成 SQL 前按问题召回注入 prompt（对照 SQLBot terminology / data_training，不搬工作空间）。
- **用同一 eval runner 证明**：术语能改字段映射；用户记忆互不可读。

## 非目标

- 自建登录 / OIDC / 工作空间（→ P009 草案）
- mem0 / OpenViking / 模型 CRUD `memory_*` 工具
- JoyAgent TableRAG、DGP、诊断 SOP（P005）
- 资源级 ACL 表（治理补齐，P011+）
- 把问数结果行当知识库持久化

## 验收 ID

判据只在 [acceptance.yaml](./acceptance.yaml)。

| ID | 标题 |
|----|------|
| PR-MEM-01 | 用户记忆按 userId 隔离 |
| PR-MEM-02 | 新对话可注入已有用户事实 |
| PR-MEM-03 | 记忆只存描述性 facts |
| PR-MEM-04 | 术语召回映射到真实字段 |
| PR-MEM-05 | SQL 示例不能突破表白名单 |
| PR-MEM-06 | eval runner 覆盖知识/记忆 before-after |

## 修订记录

| 日期 | 说明 |
|------|------|
| 2026-08-18 | 立项为 P010（P009 已被工作区治理草案占用）：对照 deer-flow 记忆 / SQLBot 术语+示例 |
