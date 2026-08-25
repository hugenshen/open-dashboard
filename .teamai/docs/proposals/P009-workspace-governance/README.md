---
id: P009
title: 工作区隔离、用户体系与知识治理
status: in-progress
milestone: v0.6
date: 2026-08-18
acceptance: .teamai/docs/proposals/P009-workspace-governance/test/acceptance.yaml
design: [.teamai/docs/proposals/P009-workspace-governance/design/design.md]
prototype: .teamai/docs/prototypes/hi-fi/index.html
architecture: .teamai/docs/design/architecture.html
contract: .teamai/docs/design/openapi.yaml
gates:
  proposal: accepted
  hi-fi: wip
  code: wip
  acceptance: none
depends: [P004, P006, P008]
implementation:
  - .teamai/docs/design/openapi.yaml
  - open-dashboard-backend/open-dashboard-domain/src/main/java/io/opendashboard/domain/context/AuthPrincipal.java
  - open-dashboard-backend/open-dashboard-adapter/src/main/java/io/opendashboard/adapter/security/HeaderAuthProvider.java
  - open-dashboard-backend/open-dashboard-adapter/src/main/java/io/opendashboard/adapter/security/MenuProvider.java
  - open-dashboard-backend/open-dashboard-adapter/src/main/java/io/opendashboard/adapter/security/DefaultMenuProvider.java
  - open-dashboard-backend/open-dashboard-adapter/src/main/java/io/opendashboard/adapter/web/AuthController.java
  - open-dashboard-backend/open-dashboard-adapter/src/main/java/io/opendashboard/adapter/web/WorkspaceController.java
  - open-dashboard-backend/open-dashboard-app/src/main/java/io/opendashboard/application/WorkspaceGovernanceService.java
  - open-dashboard-frontend/src/api/http.ts
  - open-dashboard-frontend/src/api/auth.ts
  - open-dashboard-frontend/src/router/index.ts
  - open-dashboard-frontend/src/auth/views/Login.vue
  - open-dashboard-frontend/src/auth/views/Forbidden.vue
  - open-dashboard-frontend/src/shell/AppShell.vue
  - open-dashboard-frontend/src/data-plaza/views/DataPlaza.vue
  - open-dashboard-frontend/src/workspace/views/WorkspaceAdmin.vue
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

> **状态** `in-progress` · 路线图 [进行中](../../product/roadmap/in-progress/) · 高保 wip · 代码 wip · 验收 none

## 开发入口

本提案已进入第一段实现：先落 Harness runtime 骨架、显式登录态、Java/Vue 工作区治理薄片，不直接 fork refs。工作区隔离、用户与项目组、工具治理、知识体系和记忆体系仍按分期推进；本切片未落正式 IAM、数据库迁移、RLS/CLS 和撤权缓存失效。

| 你要 | 去看 |
|------|------|
| 核心方案与 refs 对照 | [design.md](./design/design.md) |
| 问数/看盘出数闸（怎么做） | [P008 permission-design-brief.html](../P008-permission-aware-workbench/design/permission-design-brief.html) · RLS 验收仍是本文 PR-WS-05 |
| 怎么验收 | [acceptance.yaml](./test/acceptance.yaml) |
| 依赖 | P004 对话分析、P006 对话问数、P008 权限感知工作台 |
| 契约 | 本切片已补 Harness run/adopt/trace/memory/knowledge 与 Java workspace/data-plaza 接口到 [`openapi.yaml`](../../design/openapi.yaml)；后续跨端继续先改契约 |
| 当前范围 | 已确认“同壳双区域”：用户使用端不暴露工作区概念；工作区只出现在管理端。超级管理员可治理全部工作区，工作区管理员通常只管理 1～2 个。`scripts/e2e-auth-ask.sh` 已验证 demo/wsadmin/analyst 可见工作区与 east 广场 403。数据广场资产改为真实数据集目录。正式 IAM、RLS/CLS、审批流写库和审计仍后续推进 |

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
- 用户 facts / 数据集术语第一刀见 [P010](../P010-user-memory-ask-knowledge)；P010 只做 `workspaceId + userId` / 授权数据集的轻量隔离，本草案仍覆盖完整工作区 IAM、资源 ACL、发布流和审计。
- 不把未实现能力写入 `.teamai/docs/design/architecture.html` 或 `.teamai/docs/product/requirements.md`。
- 不一次性实现完整企业 IAM；优先定义可对接 OIDC / SSO / 企业通讯录的边界。
- 不允许前端绕过服务端直接调用 Java 内部能力、Harness 内部工具或数据库。

## 波及

| 列 | 内容 |
|----|------|
| 依赖 | P004 对话运行、P006 问数运行、P008 可问数据与资源消费边界 |
| 改动面 | OpenAPI、Java 鉴权与工作区治理薄片、Harness runtime context、Vue 工作区切换与数据广场/成员权限页；后续补数据库迁移 |
| 不改 | 本轮不改 requirements、不改冻结原型、不落正式 IAM/RLS/CLS |
| 回归 | P006 问数准确性、P004 仪表盘生成稳定性、P008 可问数据一致性、P003 报告访问 |

## 产品需求与用户流程

用户端以“企业资产”为发现边界，不以工作区为入口。工作区是管理端的治理边界：一个企业可以有多个工作区，超级管理员可管理全部工作区，一般工作区管理员通常只管理 1～2 个。运行时仍绑定明确的 `workspaceId`，但用户使用端不展示、不切换工作区。

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

本提案采用一个前端产品壳，不先拆成两个独立应用。导航按权限分成“用户使用端”和“管理端”；普通用户只看使用端，管理员额外看到管理端。

当前高保入口：

- 产品壳：[`shared/shell.js`](../../prototypes/hi-fi/shared/shell.js) / [`shared/shell.css`](../../prototypes/hi-fi/shared/shell.css) 只在管理端展示工作区切换器；用户使用端、管理端分组保留。
- 统一入口：[`index.html`](../../prototypes/hi-fi/index.html) 首屏展示登录、用户使用端、管理端和端到端链路。
- 登录注册：[`login.html`](../../prototypes/hi-fi/login.html) / [`register.html`](../../prototypes/hi-fi/register.html) 覆盖登录、注册、忘记密码和企业 SSO 示意。
- 账号设置：[`account-settings.html`](../../prototypes/hi-fi/account-settings.html) 覆盖个人资料、修改密码、登录安全和通知偏好。
- 成员权限：[`workspace-admin.html`](../../prototypes/hi-fi/workspace-admin.html) 覆盖成员、项目组、角色、数据权限、工具权限和审计。
- 知识库：[`knowledge.html`](../../prototypes/hi-fi/knowledge.html) 作为管理端知识维护入口。
- 数据广场：[`data-market.html`](../../prototypes/hi-fi/data-market.html) 作为用户端数据发现、添加到我的数据和消费申请入口。
- 对话分析：[`conversation-workspace.html`](../../prototypes/hi-fi/conversation-workspace.html) 只展示当前工作区、可问数据和知识命中，不承载成员/权限管理。

使用端：

- 工作台：搜索、最近对话、我的仪表盘和报告。
- 数据广场：按企业资产 / 我的资产分区和资产类型发现资产；企业侧筛选已获权 / 可申请，我的侧承接已添加与申请中；不展示工作区，也不用左侧数据空间栏做导航。
- 对话分析：问数、生成看板、查看知识命中和运行解释。
- 仪表盘 / 报告：浏览、编辑和分享受权限控制的产物。

管理端：

- 数据源 / 数据集：接入、发布可问/可申请数据集、字段角色和数据策略。
- 知识库：指标、术语、SQL 示例、SOP、候选审核和发布。
- 成员权限：工作区成员、项目组、角色只读目录；邀请、调整、审批本切片未开放，消费申请走数据广场。

## 技术设计与数据流

详见 [design.md](./design/design.md)。实现时的核心原则：

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

判据、路径、状态与证据只在 [acceptance.yaml](./test/acceptance.yaml)。

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
| PR-WS-14 | 用户使用端与管理端信息架构清晰 |
| PR-WS-15 | 登录、注册、退出和账号设置高保闭环 |
| PR-WS-16 | 用户端数据广场与管理端数据集边界清晰 |

## 实现与交付映射

- 当前状态：已开始 Harness 骨架实现，Harness 会话/run/trace、知识和用户记忆已支持 `X-Workspace-Id` 默认隔离，并同步 OpenAPI 与现行架构页；工作区 IAM、Java 权限中心、前端管理面和数据库迁移尚未开始。
- 后续继续拆分为 OpenAPI、数据迁移、Java 权限中心、Harness runtime context、Vue 管理界面与验收脚本。
- 实现后必须同步：OpenAPI → FE/BE/Harness → `architecture.html` → 验收 → `requirements.md`。

## 修订记录

| 日期 | 说明 |
|------|------|
| 2026-08-18 | 新增工作区隔离、用户体系、工具治理、知识体系和记忆体系演进草案 |
| 2026-08-18 | 第一刀实现切片见 [P010](../P010-user-memory-ask-knowledge)（用户 facts + 数据集术语/示例；只做轻量 workspace scope，不含完整工作区 IAM） |
| 2026-08-19 | P009 第一段实现：Harness runtime 骨架接入实际 run，ToolGateway 进入 runtime，文件会话/run/trace、知识和用户记忆支持 `X-Workspace-Id` scope |
| 2026-08-19 | 确认同壳双区域高保：用户使用端展示工作台/对话分析/仪表盘/报告；管理端展示数据源/数据集/知识库/成员权限 |
| 2026-08-19 | 补登录、注册、忘记密码、账号设置、修改密码和退出登录高保闭环 |
| 2026-08-19 | `index.html` 改为高保统一入口，首屏区分用户使用端和管理端 |
| 2026-08-19 | 补用户端数据广场：普通用户查看企业资产、我的数据、已获权/可申请/申请中，管理端数据集只负责发布治理 |
| 2026-08-20 | 确认用户端不再暴露工作区：工作区只出现在管理端；超级管理员治理全部工作区，工作区管理员通常 1～2 个；数据广场用数据空间组织资产 |
| 2026-08-20 | 数据广场改为企业资产 / 我的资产分区，去掉左侧数据空间导航；申请中只出现在我的资产 |
| 2026-08-20 | e2e 三角色：demo 3 工作区、wsadmin 2、analyst 1；analyst 访问 east 广场 403；可问集合分析师 ⊆ 超管（PR-WS-02/04） |
| 2026-08-22 | 成员权限页改为只读目录：去掉空 CTA；数据边界引导到数据广场 |
| 2026-08-24 | 数据广场不再返回内存演示资产；列表来自管理端数据集（`de_dataset`） |
