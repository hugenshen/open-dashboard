# P008 · 权限感知工作台详细设计

> 状态：未实现详细设计，不属于现行 4A 架构。实现并验收后只把稳定结果沉淀到 [`architecture.html`](../../design/architecture.html)。  
> 需求与原则：[README](./README.md) §2 · 验收：[acceptance.yaml](./acceptance.yaml)  
> 壳层对照：[P007 冻结快照](../../prototypes/snapshots/2026-08-17-p007-app-shell-final/)（只提供壳，不含本提案 IA）  
> 本月不实现、不改 OpenAPI、不改冻结快照。

## 1. 有效权限

```text
dashboard.consume = dashboard ACL in {owner, manage, edit, view}
                  AND every required dataset has dataset:use
report.viewStatic = report ACL in {owner, manage, edit, view}   // 不查数据集
report.refreshOrAsk = report.viewStatic AND related dataset:use
askableDatasets = conversation:use ∩ dataset:use
```

| `accessState` | 含义 | 列表可见 | 可出数 |
|---------------|------|----------|--------|
| `available` | 资源 ACL 与必需数据集权限均满足 | 是 | 是 |
| `unavailable` | 有资源 ACL，缺 `dataset:use` | 是，仅元数据卡 | 否 |
| `forbidden` | 无资源 ACL | 否 | 否 |

`unavailable` 只回 id、名称、所有者、`unavailableReason`。禁止缩略图、KPI、筛选值和查询结果。

多数据集看板按最严格原则：任一必需数据集无权，整盘 `unavailable`。

数据源不是可问对象，只向有管理权限的用户展示维护入口。

仪表盘权限不反向授予数据集；报告查看权不把数据集加入可问集合。

## 2. 工作台 IA（相对 P007 的增量）

在 P007 三行壳上改消费面，不改左栏壳：

| P007 区块 | P008 增量 |
|-----------|-----------|
| 最近看板 | 「我的仪表盘」：我的 / 共享给我；卡片含所有者、更新时间、draft/published、我的权限、`accessState` |
| （新增） | 「我的报告」同样分组；published 静态稿可直接读 |
| 问数 hero | 当前可问数据集上下文，只能选 `askableDatasets`；空则引导申请/连接，不用演示集 |
| 待处理 | 仅 `edit \| manage \| owner` 的 draft / 待发布 |
| 空态 | 无资源或无可问数据时引导连接/申请，不展示伪造业务动态 |

高保角色验收参数（标明为模拟，非真实 ACL）：`?role=admin|analyst|viewer|empty`。

高保在 [`docs/prototypes/hi-fi/workbench.html`](../../prototypes/hi-fi/workbench.html) 做增量；**不改** `p007-app-shell-final`。定稿后再打 P008 acceptance 快照。

## 3. 建议契约（实现分支才写入 OpenAPI）

现网不存在以下路径，评审用：

```text
GET /api/workbench/summary
  → myDashboards, myReports, sharedWithMe, askableDatasets, todos, overview

列表 scope=mine|shared|accessible
资源项：owner, permission, publishState, accessState, unavailableReason

GET /api/datasets/askable
  工作台、对话、编辑器 SQLBot 共用
  服务端拒绝手工 ID 绕过（run / chartQuery / datasetQuery 同样闸门）

GET /api/report/{id}/published
  只读静态稿，不得触发 chartQuery / datasetQuery
  刷新 / 洞察 / 继续问数走单独写接口并重验 dataset:use
```

错误码：

| 码 | 场景 |
|----|------|
| `RESOURCE_FORBIDDEN` | 无资源 ACL |
| `DATASET_UNAVAILABLE` | 有资源 ACL，缺数据集 `use` |
| `STATIC_SNAPSHOT_MISSING` | 已发布报告尚无静态稿 |

工作台聚合只拼权限结果。最终闸门仍在各领域服务（`chartQuery`、报告读、harness run）。权限缓存必须可失效；撤销 `dataset:use` 后不得继续用旧缓存查询。

## 4. 报告静态稿迁移

P003 当前以 live 图为主。P008 不能原地把 view 改成静态。

新字段：`publishedSnapshotId`、`generatedAt`、`sourceRevision`。

- 发布时生成快照。
- 未迁移的旧报告：有 `dataset:use` 仍可 live 预览并标记「待生成静态稿」；无 `dataset:use` 则不可看数，直到补快照。
- P008 验收前，P003 requirements 语义不变。

## 5. 分期

1. 高保增量（PR-ACL-05）
2. OpenAPI + Java ACL / summary / askable + 报告快照读路径
3. Vue 工作台、对话、SQLBot 接同一 askable API（覆盖 PR-ACL-04、PR-CONV-08、PR-ASK-07）
4. 同步 `architecture.html`；验收后再写 `requirements.md`

依赖：P007 产品壳、P006 问数轨、P003 报告模型。Auth SPI 已有，缺资源级 ACL 表（见 [路线图 · 治理补齐](../../product/roadmap/in-progress/)）。
