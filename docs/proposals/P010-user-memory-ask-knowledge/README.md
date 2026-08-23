---
id: P010
title: 用户记忆与问数知识库
status: in-progress
milestone: v0.5
date: 2026-08-18
design:
  - docs/proposals/P010-user-memory-ask-knowledge/design.md
  - docs/proposals/P010-user-memory-ask-knowledge/management-design.md
prototype: docs/prototypes/hi-fi/knowledge.html
acceptance: docs/proposals/P010-user-memory-ask-knowledge/acceptance.yaml
gates:
  proposal: accepted
  hi-fi: wip
  code: wip
  acceptance: none
architecture: docs/design/architecture.html
contract: docs/design/openapi.yaml
implementation: [opendashboard-dsh-harness/packages/dsh-od-bi/src/ask-enrich.js, open-dashboard-frontend/src/dimension/views/DimensionManage.vue, open-dashboard-frontend/src/dataset/views/DatasetManage.vue]
depends: [P004, P006, P008]
---

# P010 · 用户记忆与问数知识库

> **状态** `in-progress` · 路线图 [进行中](../../product/roadmap/in-progress/) · 高保 wip · 代码 wip · 验收 none

[P009](../P009-workspace-governance/) 是完整工作区/IAM/治理方案。本提案是知识与记忆的第一刀：Harness 侧用户 facts 按 `workspaceId + userId` 过滤，数据集术语/SQL 示例按授权数据集过滤；不做完整 IAM 管理面和跨工作区发布流。P004 只保留运行时语义增强，产品化管理面见 [management-design.md](./management-design.md) 与 [`knowledge.html`](../../prototypes/hi-fi/knowledge.html)。

## 开发入口

| 你要 | 去看 |
|------|------|
| 范围与非目标 | 本文 |
| 详细设计 | [design.md](./design.md)（存储与注入）· [management-design.md](./management-design.md)（管理面与对话消费） |
| 原型 | 当前增量 [`knowledge.html`](../../prototypes/hi-fi/knowledge.html)；**尚未冻结快照** |
| 怎么验收 | [acceptance.yaml](./acceptance.yaml) |
| 评测 | [P004 harness-evaluation.md](../P004-conversation/harness-evaluation.md) · `opendashboard-harness/eval/` |
| 代码落点 | `opendashboard-dsh-harness/packages/dsh-od-bi/src/ask-enrich.js`（`projectSemantic`）· `od_get_schema` · Java `KnowledgeService` · 管理页 `/knowledge`（`DimensionManage.vue`）· 数据集页 `/datasets/{id}` 高频问法 |
| 相邻提案 | 运行时/评测 [P004](../P004-conversation/)；问数轨 [P006](../P006-ask-data/)；身份/askable [P008](../P008-permission-aware-workbench/)；工作区全景 [P009](../P009-workspace-governance/) |
| 不要做 | 内置登录、完整工作空间/IAM 管理、跨工作区发布流、TableRAG、DGP、接入 Ossie 仓库/厂商 converter、把未验收高保五 Tab 写进 architecture.html |

## 波及

| 列 | 内容 |
|----|------|
| 依赖 | P004 事件日志与 eval runner；P008 principal 贯穿 Harness |
| 改动面 | 问数 `od_get_schema.semantic` 投影、知识库管理入口、数据集页高频问法、维度/指标确认 |
| 不改 | SQLBot/DeerFlow 整仓；P005 洞察；P009 发布流；Ossie YAML 主存储；跨表 Relationship |
| 回归 | PR-MEM-01…06；PR-KB-UI-01…04；P006 PR-ASK-12 / PR-ASK-13 |

## 范围

- **用户级记忆**：跨对话 facts（常用数据集、偏好），按 `workspaceId + userId` 隔离；注入有上限；不把聊天记录当记忆。分析师可在知识库「我的记忆」删除。
- **数据集级知识**：术语 glossary + SQL 示例 + 已确认指标；生成 SQL 前按 `workspaceId + datasetId + 权限` 召回注入 prompt。
- **管理面**：管理端菜单「知识库」进入 `/knowledge`（`/dimensions` 重定向）；待确认 / 已启用指标·维度·同义词、金标准问法预览与试问。问法增改仍在数据集页「高频问法」。高保「我的记忆」Tab 未产品化，不阻塞注入。
- **用同一 eval runner 证明**：术语能改字段映射；用户记忆互不可读。

## 非目标

- 自建登录 / OIDC / 完整工作空间管理与跨工作区发布流（→ P009）
- mem0 / OpenViking / 模型 CRUD `memory_*` 工具
- JoyAgent TableRAG、DGP、诊断 SOP（P005）
- 资源级 ACL 表（治理补齐，P011+）
- 接入 Apache Ossie 仓库、厂商 converter，或以 Ossie YAML 替代 Java 表作为知识主存储
- 把问数结果行当知识库持久化

## 验收 ID

判据只在 [acceptance.yaml](./acceptance.yaml)。

| ID | 标题 |
|----|------|
| PR-MEM-01 | 用户记忆按 workspaceId + userId 隔离 |
| PR-MEM-02 | 新对话可注入已有用户事实 |
| PR-MEM-03 | 记忆只存描述性 facts |
| PR-MEM-04 | 术语召回映射到真实字段 |
| PR-MEM-05 | SQL 示例不能突破表白名单 |
| PR-MEM-06 | eval runner 覆盖知识/记忆 before-after |
| PR-KB-UI-01 | 管理端一级知识库入口与待确认 Inbox |
| PR-KB-UI-02 | 未确认不注入；确认后可见预览 |
| PR-KB-UI-03 | 对话展示命中知识并可跳转管理 |
| PR-KB-UI-04 | 我的记忆可删、不可手写结果行 |

## 修订记录

| 日期 | 说明 |
|------|------|
| 2026-08-23 | 落地：管理端入口改为「知识库」`/knowledge`；问数 `od_get_schema` 增加 `semantic` 投影（已确认指标 expression / 维度枚举 / 金标准问法）。不接入 Ossie 仓库。高保记忆 Tab 仍未做。 |
| 2026-08-22 | 维度管理：无待确认时默认「全部数据集」；标题不再永远显示 0 待确认 |
| 2026-08-19 | 本切片：数据集页维护高频问法；confirmed 维度值进入 SQLBot。知识库一级入口仍是后续收敛，不阻塞问数准确率 |
| 2026-08-19 | 管理面确认改为「知识库」：指标、词表、金标准问法和我的记忆统一在管理端入口展示；数据集页保留重新学习入口 |
| 2026-08-19 | 与 P004/P009 边界收口：P010 承接跨会话记忆和知识库产品化；记忆召回至少按 `workspaceId + userId` 隔离 |
| 2026-08-19 | 数据集「重新学习」接 Harness LLM 复核；已确认口径仍为人闸 |
| 2026-08-18 | 立项为 P010（P009 已被工作区治理草案占用）：对照 deer-flow 记忆 / SQLBot 术语+示例 |
