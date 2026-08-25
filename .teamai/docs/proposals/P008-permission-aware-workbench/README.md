---
id: P008
title: 权限感知工作台与资源消费边界
status: accepted
milestone: v0.5
date: 2026-08-17
acceptance: .teamai/docs/proposals/P008-permission-aware-workbench/test/acceptance.yaml
design: [.teamai/docs/proposals/P008-permission-aware-workbench/design/design.md, .teamai/docs/proposals/P008-permission-aware-workbench/design/permission-design-brief.html]
prototype: .teamai/docs/prototypes/hi-fi/data-market.html
gates:
  proposal: accepted
  hi-fi: wip
  code: wip
  acceptance: none
depends: [P003, P006, P007]
---

# P008 · 权限感知工作台与资源消费边界

> **状态** `accepted` · 路线图 [进行中](../../product/roadmap/in-progress/) · 高保 wip · 代码 wip · 验收 none

## 开发入口

权限边界已确认。身份贯穿、askable、公开 chartQuery、ACL 表、QueryGuard 行列注入、管理端数据权限已编码。工作台「我的资源」分组与匿名分享静态化仍未做。

| 你要 | 去看 |
|------|------|
| 已确认原则 | [req/principles.md](./req/principles.md) |
| **问数/看盘怎么做（改动前真实闸门 · 四层 · QueryGuard · 分期）** | [permission-design-brief.html](./design/permission-design-brief.html) |
| 详细设计摘要 | [design.md](./design/design.md)（公式、表、API、QueryGuard） |
| 怎么验收 | [acceptance.yaml](./test/acceptance.yaml) |
| 工作台壳层 | [P007 冻结快照](../../prototypes/snapshots/2026-08-17-p007-app-shell-final/)（只提供壳，不含本提案 IA） |
| 数据广场高保 | [`data-market.html`](../../prototypes/hi-fi/data-market.html)（当前增量，未冻结） |
| 契约 | [`openapi.yaml`](../../design/openapi.yaml) 已含 dataset-permissions / chartQuery 闸 |
| 依赖 | P003 报告模型、P006 问数、P007 壳层 |
| 端到端 | [`scripts/e2e-auth-ask.sh`](../../../../scripts/e2e-auth-ask.sh)（Java :8082 + Harness :8091） |
| 当前范围 | PR-ACL-04/08/09/10/11 与行列 QueryGuard 已编码；**新注册 analyst 不再继承 V18 角色全量 ACL**（V19 收到 `u_analyst`，树/详情/目录按实例 ACL 过滤）。数据广场列表改读 `de_dataset`，去掉内存 `AssetSeed`（订单表/会员画像等）；仪表板等类型本切片不造假。工作台「我的/共享」IA（PR-ACL-05/06/07）与匿名分享静态化（D）未做 |

## 波及

| 列 | 内容 |
|----|------|
| 依赖 | P003 报告发布模型、P006 问数、P007 壳层 |
| 改动面 | 实现时先改 OpenAPI，再 FE/BE；数据广场高保、工作台我的资源、对话可问数据上下文 |
| 不改 | 把本提案 IA 写进 P007 快照或 requirements；P003 当前 live 图语义在本提案交付前保持 |
| 回归 | PR-ACL-01…08；P006 的 PR-ASK-07；P004 的 PR-CONV-08；P003 报告查看 |

## 1. 背景与目标

工作台不能只展示“最近内容”，还要回答用户最关心的三个问题：

1. 我能查看、编辑或管理哪些仪表盘和报告？
2. 哪些资源是我创建的，哪些是共享给我的？
3. 哪些数据集允许在对话或 SQLBot 中继续消费？
4. 哪些数据集我还不能用，但可以申请消费？

本提案固化历史对话已确认的权限边界，避免把“能看到资源”“能查看静态内容”“能继续问底层数据”混成同一种权限。

## 2. 已确认的权限原则

完整原则见 [req/principles.md](./req/principles.md)。摘要：

- 仪表盘访问同时满足资源 ACL 与引用数据集的 `dataset:use`；盘权不反向授予数据集。
- 已发布报告是独立静态资源，`report:view` 足以阅读；刷新 / 问数 / 洞察再校验 `dataset:use`。
- `askableDatasets = conversation:use ∩ dataset:use`；工作台、对话、SQLBot 同一集合。
- 数据广场负责发现与申请；未获权不展示 schema、样例或查询结果。

## 3. 工作台信息架构

### 3.1 我的仪表盘

- 分组：我的、共享给我。
- 卡片字段：名称、所有者、更新时间、draft / published、我的权限（管理 / 编辑 / 只读）、访问状态。
- 仅有编辑权的 draft 或待发布内容才进入“待处理”。

### 3.2 我的报告

- 分组：我的、共享给我。
- 卡片字段：名称、所有者、更新时间、draft / published、我的权限、静态资源状态。
- published 静态报告可直接阅读；draft 的编辑、刷新和重新生成仍按底层数据权限校验。

### 3.3 可问数据

- 展示当前用户可问的数据集、业务域、更新时间和可用状态。
- 工作台问数框必须明确当前数据上下文；切换后只可选择 askable 数据集。
- 数据广场「开始问数」与工作台「问数」跳转对话时必须带上 `datasetId`；对话页顶栏展示当前锁定数据集，后续问数/出板默认只用该表，用户可在顶栏切换或清除。
- 列表、对话和 SQLBot 的可问集合必须一致，禁止三个入口各算一套权限。

### 3.4 用户端数据广场

- 顶栏居中「我的 / 企业」切换（对齐 Quick BI）；其下是「优选数据资产」搜索与资产类型 tab。企业侧不再另做全部 / 已获权 / 可申请筛选，靠顶栏分区即可。进入「我的」后，工具栏右上角切换已添加 / 申请中。不设左侧数据空间导航，用户端不展示工作区概念。
- 企业资产列表展示已获权与可申请；行操作是添加或申请。申请中只出现在「我的」。我的侧右上角切已添加 / 申请中，行操作是开始问数或查看申请。
- 支持关键词搜索、卡片/列表视图切换和已获权资产批量添加到我的数据。主区默认全宽列表，占满剩余视口。
- 列表字段：资产名称、类型、负责人、更新时间、我的权限状态和操作。点名称打开说明/口径预览。
- 已获权资产提供“添加到我的数据”；已获权数据集额外提供“开始问数”和“查看口径”。
- 已发布仪表盘进入「仪表板」分类，展示 `publishStatus`（已发布 / 有改动）；已获权可打开或添加，未获权提供「申请查看」，审批通过后写入仪表盘 view ACL。
- 可申请资产提供“查看说明”和“申请消费/申请查看”，申请表至少包含用途、有效期和期望权限。
- 申请中展示审批人和提交时间，不提供问数入口。

## 4. 用户流程

```text
进入工作台
  → 获取当前用户资源与权限摘要
  → 查看「我的 / 共享给我」仪表盘、报告和可问数据摘要
  → 进入数据广场查看企业资产 / 我的资产 / 可申请 / 申请中
  → 必要时提交数据消费申请
  → 选择可问数据集后提问
  → 进入对话并自动执行本题

打开仪表盘
  → 校验 dashboard ACL
  → 校验全部必需 dataset:use
  → 通过后执行 chartQuery；失败则不返回业务数据

打开已发布报告
  → 只校验 report:view
  → 返回静态发布稿
  → 用户触发刷新 / 问数 / 洞察时再校验 dataset:use
```

## 5. 建议契约

实现分支先更新 `.teamai/docs/design/openapi.yaml`，至少覆盖：

- 工作台聚合：返回 `myDashboards`、`myReports`、`sharedWithMe`、`askableDatasets`、`todos`。
- 数据广场：返回 `assets`、`myData`、`requestableAssets`、`pendingRequests`，未获权资产只返回可公开展示的摘要。
- 资源项统一字段：`owner`、`permission`、`publishState`、`accessState`、`unavailableReason`。
- 报告发布稿：静态内容版本、生成时间、来源修订；读取接口不得隐式触发实时查询。
- 权限错误区分：无资源 ACL、底层数据集不可用、静态稿不存在，避免前端把所有失败显示成“系统错误”。

具体路径和 Schema 在实现前写入 OpenAPI；本提案不预先声明尚不存在的线上接口。

## 6. 兼容、迁移与风险

- P003 当前报告节点以 live 图为主；静态发布稿需要迁移策略和版本字段，不能原地改语义后假装兼容。
- 资源元数据可显示“不可用”，但不得携带图表结果、缩略指标或敏感筛选值。
- 多数据集仪表盘按最严格原则处理：任一必需数据集无权，整个仪表盘不可消费。
- 权限缓存必须可失效；撤销 `dataset:use` 后不能继续用旧缓存查询。
- 工作台聚合接口只聚合权限结果，不绕过各领域服务的最终鉴权。

## 7. 验收 ID

判据、路径、状态与证据只在 [acceptance.yaml](./test/acceptance.yaml)。

| ID | 标题 |
|----|------|
| PR-ACL-01 | 仪表盘双重权限才能出数 |
| PR-ACL-02 | 静态报告独立查看 |
| PR-ACL-03 | 报告不继承问数权 |
| PR-ACL-04 | 三入口可问集合一致 |
| PR-ACL-05 | 我的 / 共享资源分组 |
| PR-ACL-06 | 待办与失效资源不泄露数据 |
| PR-ACL-07 | 无权限空状态 |
| PR-ACL-08 | 客户端不能声明 user_id |
| PR-ACL-09 | 用户端数据广场可发现和申请数据 |
| PR-ACL-10 | 资源实例 ACL 落库，广场不再当权限源 |
| PR-ACL-11 | 公开 chartQuery / 导出与问数同一出数闸 |

## 8. 实现与交付映射

- 当前状态：权限边界已确认；**身份贯穿与 askable API 已编码（wip）**；用户端数据广场高保和 `/data-plaza` 第一版已补。资源 ACL 表、公开 chartQuery 数据集闸、行列注入、工作台「我的/共享」尚未开始。怎么做见 [permission-design-brief.html](./design/permission-design-brief.html)。
- 依赖：P003 报告发布模型、P006 问数、P007 工作台壳层。
- 实现后必须同步：OpenAPI → FE/BE → `architecture.html` → 验收 → `requirements.md`。
- 在 `gates.acceptance: passed` 前不得把本提案能力写入已交付基线。

## 9. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-08-17 | 补录历史多轮对话已确认的仪表盘、报告与可问数据权限边界 |
| 2026-08-17 | 明确不进 2026-08 月包；补波及表；验收细节只保留在 yaml |
| 2026-08-17 | 写入 design.md（有效权限、工作台 IA、建议契约、静态稿迁移、分期）；仍不实现 |
| 2026-08-18 | 身份贯穿：askable API + Harness/internal BI 使用 Auth SPI principal；禁止客户端声明 user_id。工作台「我的资源」高保仍未做 |
| 2026-08-19 | 补用户端数据广场高保：已获权 / 可申请 / 申请中，明确用户发现和申请消费入口 |
| 2026-08-19 | 参考 Quick BI 数据广场，将用户端入口升级为数据广场：资产分类、数据空间、我的数据、批量添加和申请抽屉 |
| 2026-08-20 | 落 `/data-plaza` Vue 页面与 Java `/api/workspaces/{id}/data-plaza` 第一版，支持发现、加入我的数据和申请消费 |
| 2026-08-20 | 用户端数据广场不再暴露工作区；数据空间只作为资产目录 |
| 2026-08-20 | 数据广场去掉左侧数据空间栏，改为企业资产 / 我的资产分区 + 筛选条 + 全宽列表；申请中只在我的资产 |
| 2026-08-20 | 数据广场局部加字号、压紧 hero 到列表间距，强化企业/我的分区和资产名称层级 |
| 2026-08-20 | 企业资产 / 我的资产分区（含状态筛选）上移到优选数据资产搜索对话框之上 |
| 2026-08-20 | 数据广场改为单行顶栏（分区+状态+类型+搜索），去掉居中 hero，默认全宽列表占满剩余视口 |
| 2026-08-20 | 落地 PR-ACL-04/08：AskableDatasetService 按角色收口可问集合；拒绝 body.userId；会话 GET 按 owner 隔离。`scripts/e2e-auth-ask.sh` 三账号 pass=14 |
| 2026-08-21 | 对齐 Quick BI：顶栏居中「我的 / 企业」由 AppShell 渲染并与数据广场共享状态；去掉不可靠的 Teleport |
| 2026-08-21 | 放大优选搜索框；列表名称区去掉标签堆叠，状态改为轻量文字样式 |
| 2026-08-21 | 去掉企业侧全部/已获权/可申请筛选条；「我的」下已添加/申请中改到工具栏右上角 |
| 2026-08-24 | 数据广场去掉内存 AssetSeed；`GET /data-plaza` 对接 `de_dataset` 目录，授权状态走 `od_resource_acl`，未获权不回表名/字段 |
| 2026-08-24 | 数据广场「仪表板」tab：列出已发布仪表盘并展示 `publishStatus`；未获权可「申请查看」，审批通过写 `dashboard` view ACL；修复编辑器全局 `.empty` 样式泄漏导致类型 tab 点不动 |
| 2026-08-24 | 广场「开始问数」与工作台问数框带入 `datasetId`；对话页顶栏展示并锁定可问数据集上下文，后续轮次 Agent 只用该表；切换数据集需在顶栏明确操作 |
