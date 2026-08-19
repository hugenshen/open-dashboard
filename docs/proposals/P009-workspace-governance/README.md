---
id: P009
title: 工作区隔离、用户体系与知识治理
status: in-progress
milestone: v0.6
date: 2026-08-18
acceptance: docs/proposals/P009-workspace-governance/acceptance.yaml
design: [docs/proposals/P009-workspace-governance/design.md]
architecture: docs/design/architecture.html
contract: docs/design/openapi.yaml
gates:
  proposal: accepted
  hi-fi: none
  code: wip
  acceptance: none
depends: [P004, P006, P008]
implementation:
  - opendashboard-harness/agent/run_controller.py
  - opendashboard-harness/agent/event_stream.py
  - opendashboard-harness/agent/trace_store.py
  - opendashboard-harness/agent/context_builder.py
  - opendashboard-harness/agent/user_context.py
  - opendashboard-harness/agent/session_store.py
  - opendashboard-harness/agent/runtime.py
  - opendashboard-harness/agent/planner.py
  - opendashboard-harness/agent/memory_runtime.py
  - opendashboard-harness/agent/knowledge_retriever.py
  - opendashboard-harness/tools/gateway.py
  - opendashboard-harness/api/app.py
  - opendashboard-harness/tests/test_harness_runtime_skeleton.py
  - opendashboard-harness/tests/test_knowledge.py
---

# P009 · 工作区隔离、用户体系与知识治理

> **状态** `in-progress` · 路线图 [进行中](../../product/roadmap/in-progress/) · 高保 none · 代码 wip · 验收 none

## 开发入口

本提案已进入第一段实现：先落 Harness runtime 骨架，不直接 fork refs。工作区隔离、用户与项目组、工具治理、知识体系和记忆体系仍按分期推进。

| 你要 | 去看 |
|------|------|
| 核心方案与 refs 对照 | [design.md](./design.md) |
| 怎么验收 | [acceptance.yaml](./acceptance.yaml) |
| 依赖 | P004 对话分析、P006 对话问数、P008 权限感知工作台 |
| 契约 | 本切片已补 Harness run/adopt/trace/memory/knowledge 接口到 [`openapi.yaml`](../../design/openapi.yaml)；后续跨端继续先改契约 |
| 当前范围 | 只做 Harness H1/H3 骨架与 Harness 侧 workspace scope：run/event/trace/context/tool/knowledge/user-memory 边界；不动 Java、前端或数据库迁移 |

## 背景与目标

当前准确性和稳定性不理想，本质上不是单点 prompt 问题，而是缺少可治理的上下文闭环：

1. 用户属于哪个工作区、项目组，能访问哪些数据和资源，没有成为所有运行链路的强制前置条件。
2. 问数和仪表盘生成依赖的数据口径、业务术语、SQL 示例、权限策略没有统一版本化。
3. Agent 工具可用性、执行顺序、写入权限和审计还没有沉淀成平台能力。
4. 记忆如果不分用户、工作区、会话和知识库，很容易跨项目污染答案。

目标是让平台支持多项目组接入：每个工作区有独立用户、角色、数据、知识、记忆、工具权限和审计边界；问数和仪表盘生成都从同一份授权上下文启动。

## 范围 / 非目标

**范围**

- 工作区隔离模型：workspace / group / member / role / resource ACL / data policy。
- 用户接入流程：外部身份接入、项目组邀请、角色绑定、工作区切换。
- 问数与仪表盘生成核心流程：运行前上下文装配、工具权限、数据权限、知识召回、产物写入。
- Harness 演进路线：保留自研 Harness 主干，按模块吸收 refs 的事件流、工具循环、SOP、RAG、隔离测试和评测能力。
- 知识体系：Java 侧管理业务术语、指标口径、字段解释、SQL 示例、SOP、版本、审核和发布索引；Harness 按授权边界召回使用。
- 记忆体系：Harness 侧管理会话记忆、用户偏好、工作区经验、召回、压缩、写入策略和清理；Java 只提供身份权限边界与治理入口。
- 验收场景：以跨工作区隔离、权限收敛、知识发布、审计可追溯为主。

**非目标**

- 不在本提案内改 P006 adopt 协议、问数 SQL 生成细节或 P008 工作台 UI。
- 不含工作区的用户 facts / 数据集术语第一刀见 [P010](../P010-user-memory-ask-knowledge/)；本草案仍覆盖工作区 IAM。
- 不把未实现能力写入 `docs/design/architecture.html` 或 `docs/product/requirements.md`。
- 不一次性实现完整企业 IAM；优先定义可对接 OIDC / SSO / 企业通讯录的边界。
- 不允许前端绕过服务端直接调用 Java 内部能力、Harness 内部工具或数据库。

## 波及

| 列 | 内容 |
|----|------|
| 依赖 | P004 对话运行、P006 问数运行、P008 可问数据与资源消费边界 |
| 改动面 | 后续会涉及 OpenAPI、Java 鉴权与资源模型、Harness runtime context、Vue 工作区切换与管理页、数据库迁移 |
| 不改 | 本轮不改代码、不改现行 4A、不改 requirements、不改冻结原型 |
| 回归 | P006 问数准确性、P004 仪表盘生成稳定性、P008 可问数据一致性、P003 报告访问 |

## 产品需求与用户流程

用户以“工作区”为平台边界。一个企业可以有多个工作区，一个工作区对应一个项目组、业务域或客户空间。用户可以加入多个工作区，但每次运行问数或生成时必须落在一个明确的 `workspaceId`。

核心用户流程：

```text
平台管理员创建工作区
  → 邀请用户或同步外部用户组
  → 绑定角色与默认资源策略
  → 数据管理员接入数据源并发布可问数据集
  → 知识管理员维护指标、术语、字段解释、SQL 示例和 SOP
  → 分析师在工作区内问数或生成仪表盘
  → 前端调用 Harness public run 入口
  → Harness 向 Java internal 获取授权后的 runtime context 与工具清单
  → Harness 装配 AI 上下文、召回记忆、编排计划和工具调用
  → Java internal 执行领域查询、写入和最终权限校验
  → Harness 保存运行记忆与 trace；Java 保存领域产物和领域审计
```

## 交互设计与原型

本提案暂不创建高保。后续高保应覆盖：

- 工作区切换器：当前工作区、可加入工作区、无权限状态。
- 工作区管理：成员、项目组、角色、数据集授权、工具授权、知识发布审核。
- 问数入口：当前工作区与可问数据上下文强提示。
- 运行详情：计划、工具调用、权限策略、知识命中、审计摘要。

## 技术设计与数据流

详见 [design.md](./design.md)。实现时的核心原则：

- Java 是业务事实与权限事实中心，负责身份、工作区、资源、数据、知识发布版本和领域审计。
- Harness 是 AI Run 独立入口和运行编排层；问数、仪表盘生成、SSE、AI 上下文和记忆由 Harness public API 承接。
- 前端普通管理/资源 CRUD 调 Java public API；AI 运行调 Harness public API；前端不持有 Java internal 工具地址。
- Harness 只消费 Java internal 下发的授权身份、权限边界、数据目录、知识版本和工具清单；不自建用户体系，不直接落业务事实。
- 所有跨端契约先进入 OpenAPI，再改 FE / BE / Harness。

## OpenAPI / 数据模型变化

本切片已把 Harness public run、adopt、trace、memory、knowledge 的当前契约写入 `openapi.yaml`。后续完整工作区能力仍至少需要新增：

- `GET /api/workspaces`、`POST /api/workspaces/{id}/switch`
- `GET /api/workspaces/{id}/members`
- `POST /api/workspaces/{id}/members`
- `GET /api/workspaces/{id}/effective-permissions`
- `GET /api/workspaces/{id}/askable-datasets`
- `POST /harness/v1/conversations/{id}/runs`
- `GET /harness/api/runs/{runId}/events`
- `GET /harness/api/runs/{runId}/memory`
- `GET /internal/harness/runtime-context`
- `POST /api/workspaces/{id}/knowledge/*`
- `GET /api/runs/{runId}/audit`

具体路径、Schema 和错误码必须在实现分支写入 OpenAPI。

## 兼容、迁移与风险

- 现有单租户数据需要补 `workspaceId`。迁移期只能把旧数据放入默认工作区，不能把工作区字段留空。
- 权限缓存必须可失效。撤销数据集权限后，正在运行的任务需要按策略中止或在下一次工具调用前失败。
- 知识和记忆不能绕过 ACL。Harness 召回记忆前必须使用 Java 下发的 `workspaceId`、`userId`、`datasetId` 与知识发布状态边界。
- 工具授权要比页面授权更严格。能看仪表盘不代表能写仪表盘，能问数据不代表能发布知识。
- 审计日志不能存敏感明文结果；需要保存策略命中、工具名、参数摘要、产物 ID 和错误码。

## 验收标准

判据、路径、状态与证据只在 [acceptance.yaml](./acceptance.yaml)。

| ID | 标题 |
|----|------|
| PR-WS-01 | 工作区数据与资源强隔离 |
| PR-WS-02 | 用户接入与工作区切换 |
| PR-WS-03 | 项目组角色和资源 ACL 生效 |
| PR-WS-04 | 可问数据集合三入口一致 |
| PR-WS-05 | 行列权限进入问数执行 |
| PR-WS-06 | 仪表盘生成写权限闸门 |
| PR-WS-07 | 知识发布后才进入召回 |
| PR-WS-08 | 记忆按会话、用户、工作区隔离 |
| PR-WS-09 | 工具按 workspace 和 role 过滤 |
| PR-WS-10 | 运行审计可追溯 |
| PR-WS-11 | 知识管理、存储和检索闭环 |
| PR-WS-12 | 记忆管理、存储和检索闭环 |
| PR-WS-13 | Harness 演进骨架闭环 |

## 实现与交付映射

- 当前状态：已开始 Harness 骨架实现，Harness 会话/run/trace、知识和用户记忆已支持 `X-Workspace-Id` 默认隔离，并同步 OpenAPI 与现行架构页；工作区 IAM、Java 权限中心、前端管理面和数据库迁移尚未开始。
- 后续继续拆分为 OpenAPI、数据迁移、Java 权限中心、Harness runtime context、Vue 管理界面与验收脚本。
- 实现后必须同步：OpenAPI → FE/BE/Harness → `architecture.html` → 验收 → `requirements.md`。

## 修订记录

| 日期 | 说明 |
|------|------|
| 2026-08-18 | 新增工作区隔离、用户体系、工具治理、知识体系和记忆体系演进草案 |
| 2026-08-18 | 第一刀实现切片见 [P010](../P010-user-memory-ask-knowledge/)（用户 facts + 数据集术语/示例，不含工作区 IAM） |
| 2026-08-19 | P009 第一段实现：Harness runtime 骨架接入实际 run，ToolGateway 进入 runtime，文件会话/run/trace、知识和用户记忆支持 `X-Workspace-Id` scope |
