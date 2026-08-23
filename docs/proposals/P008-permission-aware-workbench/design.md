# P008 · 权限感知工作台详细设计

> 状态：工作台「我的/共享」IA 尚未实现。**身份贯穿与 `GET /api/dataset/askable` 已编码（code: wip）**。验收前不把本提案写入 [`architecture.html`](../../design/architecture.html)。  
> 人读主文（改动前闸门、四层、QueryGuard、分期）：[permission-design-brief.html](./permission-design-brief.html)  
> 需求与原则：[README](./README.md) §2 · 验收：[acceptance.yaml](./acceptance.yaml)  
> 壳层对照：[P007 冻结快照](../../prototypes/snapshots/2026-08-17-p007-app-shell-final/)（只提供壳，不含本提案 IA）

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
| 问数 hero | 当前可问数据集上下文，只能选 `askableDatasets`；空则引导到数据广场申请，不用演示集 |
| （新增） | 「数据广场」：用户端按企业资产 / 我的资产分区，资产分类、已获权 / 可申请、已添加 / 申请中；未获权只展示摘要，不给 schema 和样例数据 |
| 待处理 | 仅 `edit \| manage \| owner` 的 draft / 待发布 |
| 空态 | 无资源或无可问数据时引导连接/申请，不展示伪造业务动态 |

高保角色验收参数（标明为模拟，非真实 ACL）：`?role=admin|analyst|viewer|empty`。

高保在 [`docs/prototypes/hi-fi/workbench.html`](../../prototypes/hi-fi/workbench.html) 与 [`data-market.html`](../../prototypes/hi-fi/data-market.html) 做增量；**不改** `p007-app-shell-final`。定稿后再打 P008 acceptance 快照。

## 3. 建议契约（实现分支才写入 OpenAPI）

现网不存在以下路径，评审用：

```text
GET /api/workbench/summary
  → myDashboards, myReports, sharedWithMe, askableDatasets, todos, overview

列表 scope=mine|shared|accessible
资源项：owner, permission, publishState, accessState, unavailableReason

GET /api/dataset/askable
  工作台、对话、编辑器 SQLBot 共用（已编码）
  服务端拒绝手工 ID 绕过（internal BI schema / query / sql 同样闸门）

GET /api/workspaces/{workspaceId}/data-plaza
  用户端数据广场：assets, myData, requestableAssets, pendingRequests
  requestable 只返回业务说明、负责人、敏感等级、申请条件，不返回 schema 明细和样例数据

POST /api/workspaces/{workspaceId}/dataset-requests
  提交数据消费申请：datasetId, purpose, expireAt, requestedActions
  审批通过后由 Java 权限中心写入 dataset:use、行列策略和必要工具权限

GET /api/report/{id}/published
  只读静态稿，不得触发 chartQuery / datasetQuery
  刷新 / 洞察 / 继续问数走单独写接口并重验 dataset:use
```

错误码：

| 码 | 场景 |
|----|------|
| `RESOURCE_FORBIDDEN` | 无资源 ACL |
| `DATASET_UNAVAILABLE` | 有资源 ACL，缺数据集 `use` |
| `DATASET_REQUEST_PENDING` | 数据消费申请已提交，暂不可问 |
| `STATIC_SNAPSHOT_MISSING` | 已发布报告尚无静态稿 |

工作台聚合只拼权限结果。最终闸门仍在各领域服务（`chartQuery`、报告读、harness run）。权限缓存必须可失效；撤销 `dataset:use` 后不得继续用旧缓存查询。

## 4. 报告静态稿迁移

P003 当前以 live 图为主。P008 不能原地把 view 改成静态。

新字段：`publishedSnapshotId`、`generatedAt`、`sourceRevision`。

- 发布时生成快照。
- 未迁移的旧报告：有 `dataset:use` 仍可 live 预览并标记「待生成静态稿」；无 `dataset:use` 则不可看数，直到补快照。
- P008 验收前，P003 requirements 语义不变。

## 5. 分期

已完成：身份贯穿 + askable API + 广场第一版（PR-ACL-04 / 08 / 09）。

后续按 [brief §13](./permission-design-brief.html#phases)，**ACL 表在本提案落地，不再推到「治理补齐 / P011+」**：

0. **B0 止血**：删除 `AskableDatasetService` 回落 `live.get(0)`；公开 `POST /api/chartQuery/query` 与 export 接到同一 `QueryGuard`（PR-ACL-11）。**已编码。**
1. **B1 表**：`od_resource_acl` / `od_dataset_request`；创建写 owner；广场 approve 写 `use`（PR-ACL-10、PR-WS-03）。**已编码。**
2. **B2 IA**：工作台 my/shared；unavailable 元数据卡（PR-ACL-05/06/07）。未编码。
3. **B3 双重出数 + 写闸**：chartQuery 带 dashboardId 时验盘 ACL；apply 要实例 edit（PR-ACL-01、PR-WS-06）。**已编码。**
4. **C 行列**：`od_data_policy` + Java `QueryGuard` 注入；schema 先 CLS。**已编码。** 验收 ID 在 P009 `PR-WS-05`。
5. **D 分享**：匿名默认静态快照；禁止发布者凭证问数。不阻塞 B/C。未编码（分享路径暂 bypass QueryGuard）。

依赖：P007 产品壳、P006 问数轨、P003 报告模型。OpenAPI 与实现同 PR。

## 6. 有效权限服务与查询闸

唯一实现类（名称可微调，职责不可拆成问数一份、看盘一份）：

- `EffectiveAccessService`：算 `askableIds`、`actions(type,id)`、`accessState(dashboard)`。
- `QueryGuard`：在 `chartQuery` / `datasetQuery` / internal `/query/*` / CSV 前 `apply(principal, datasetId, spec|sql)`。

判定公式见本文 §1 与 brief §4。SQL 路径：Java 再跑只读检查 + 表白名单 + `SELECT projected FROM (user_sql) t WHERE rls`。禁止 LLM 改写权限 SQL。

## 7. 数据模型

```text
od_resource_acl (workspace_id, resource_type, resource_id, subject_type, subject_id, action)
od_data_policy  (workspace_id, dataset_id, kind, subject, effect, predicate_json, enabled)
od_dataset_request (… status pending|approved|denied)  -- approve 写 ACL，不把 pending 当权
```

`resource_type`：`dataset | dashboard | report | conversation`。  
数据集 `action`：`use | manage | owner`。盘/报告：`view | edit | manage | owner`。  
主体：`user | group | role`。工作区管理员对本 ws 资源短路 manage。  
广场是 ACL 的视图，不再用内存 `AssetSeed.status` 当授权真相。

## 8. 契约增量

实现分支写入 OpenAPI（现网无 ACL 写接口）：

- `GET /api/dataset/askable`：集合改为实例 `use`，空集不得回落。
- `POST /api/chartQuery/query` 与 `/export`：登录用户主路径要求 `dashboardId`；双重权限 + QueryGuard。
- `GET /api/workbench/summary`：my / shared / askable / todos。
- `POST /api/workspaces/{id}/acl`：写实例授权。
- 错误码：`RESOURCE_FORBIDDEN`（对外 404）、`DATASET_UNAVAILABLE`、`DATASET_COLUMN_FORBIDDEN`、`DASHBOARD_WRITE_FORBIDDEN`、`POLICY_BIND_FAILED`。
