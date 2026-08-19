---
id: P008
title: 权限感知工作台与资源消费边界
status: accepted
milestone: v0.5
date: 2026-08-17
acceptance: docs/proposals/P008-permission-aware-workbench/acceptance.yaml
design: [docs/proposals/P008-permission-aware-workbench/design.md]
gates:
  proposal: accepted
  hi-fi: none
  code: wip
  acceptance: none
depends: [P003, P006, P007]
---

# P008 · 权限感知工作台与资源消费边界

> **状态** `accepted` · 路线图 [进行中](../../product/roadmap/in-progress/) · 高保 none · 代码 wip · 验收 none

## 开发入口

权限边界已确认。身份贯穿与 `GET /api/dataset/askable` 已编码；工作台「我的资源」高保仍没有。不要把 P007 工作台快照当成已有「我的 / 共享」IA。

| 你要 | 去看 |
|------|------|
| 已确认原则 | 本文 §2 |
| 详细设计 | [design.md](./design.md)（有效权限、IA、建议契约、静态稿迁移、分期） |
| 怎么验收 | [acceptance.yaml](./acceptance.yaml) |
| 工作台壳层 | [P007 冻结快照](../../prototypes/snapshots/2026-08-17-p007-app-shell-final/)（只提供壳，不含本提案 IA） |
| 契约 | 实现分支先更新 [`openapi.yaml`](../../design/openapi.yaml)；路径见 design §3，现网尚不存在 |
| 依赖 | P003 报告模型、P006 问数、P007 壳层 |
| 当前范围 | 身份贯穿与 askable API 已编码；工作台「我的资源」高保仍无 |

## 波及

| 列 | 内容 |
|----|------|
| 依赖 | P003 报告发布模型、P006 问数、P007 壳层 |
| 改动面 | 实现时先改 OpenAPI，再 FE/BE；高保尚未开始 |
| 不改 | 把本提案 IA 写进 P007 快照或 requirements；P003 当前 live 图语义在本提案交付前保持 |
| 回归 | PR-ACL-01…08；P006 的 PR-ASK-07；P004 的 PR-CONV-08；P003 报告查看 |

## 1. 背景与目标

工作台不能只展示“最近内容”，还要回答用户最关心的三个问题：

1. 我能查看、编辑或管理哪些仪表盘和报告？
2. 哪些资源是我创建的，哪些是共享给我的？
3. 哪些数据集允许在对话或 SQLBot 中继续消费？

本提案固化历史对话已确认的权限边界，避免把“能看到资源”“能查看静态内容”“能继续问底层数据”混成同一种权限。

## 2. 已确认的权限原则

### 2.1 仪表盘复用数据集权限

- 仪表盘访问必须同时满足资源 ACL（owner / manage / edit / view）和其引用数据集的 `dataset:use`。
- 用户有仪表盘 ACL、但任一必需数据集已失去 `use` 时，不得打开或预览数据。
- 工作台可显示不含业务数据的“权限已失效”元数据卡，用于解释资源为何不可用；禁止返回缩略数据、指标值或查询结果。
- 仪表盘权限不反向授予数据集权限。

### 2.2 报告是独立静态资源

- 已发布报告保存为可独立查看的静态资源；`report:view` 足以查看已发布静态正文。
- 查看静态报告不要求底层 `dataset:use`，也不触发 `chartQuery` / `datasetQuery`。
- 编辑报告、刷新 live 图、重新生成洞察或“继续问数”时，必须重新校验相关 `dataset:use`。
- 报告查看权不得把底层数据集加入可问集合，不得反向获得仪表盘或数据集权限。
- P008 交付前，P003 仍保持当前 live 图与无权限占位行为；本提案不得被提前写入 requirements。

### 2.3 可问数据

- `askableDatasets = conversation:use ∩ dataset:use`。
- 工作台问数框、对话数据上下文和编辑器 SQLBot 必须使用同一可问集合。
- 数据源是管理对象，不是直接可问对象；用户只能消费经过数据集语义层暴露的数据。
- 无可问数据时展示连接/申请权限引导，不使用演示数据伪装为用户资产。

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
- 列表、对话和 SQLBot 的可问集合必须一致，禁止三个入口各算一套权限。

## 4. 用户流程

```text
进入工作台
  → 获取当前用户资源与权限摘要
  → 查看「我的 / 共享给我」仪表盘和报告
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

实现分支先更新 `docs/design/openapi.yaml`，至少覆盖：

- 工作台聚合：返回 `myDashboards`、`myReports`、`sharedWithMe`、`askableDatasets`、`todos`。
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

判据、路径、状态与证据只在 [acceptance.yaml](./acceptance.yaml)。

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

## 8. 实现与交付映射

- 当前状态：权限边界已确认；**身份贯穿与 askable API 已编码（wip）**；工作台「我的/共享」高保和资源 ACL 表尚未开始。
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
