# REST API 总览

> 以当前 Controller 实现为准。机器可读契约：[../openapi.yaml](../openapi.yaml)（若冲突以已上线行为为准并修契约）。  
> 鉴权见 [../design/auth.md](../design/auth.md)。

约定：

- 前缀 `/api`  
- JSON 中 ID 为 **string**  
- 管理态默认 draft；分享强制 published  

---

## Auth · `/api/auth`

| Method | Path | 鉴权 | 说明 |
|--------|------|------|------|
| GET | `/auth/me` | 可选 | 当前主体 |
| GET | `/auth/menus` | 可选 | 可见菜单 |

---

## Dashboard · `/api` · `@RequireAuth`

| Method | Path | 权限 | 说明 |
|--------|------|------|------|
| GET | `/dashboard/templates` | auth | 模板列表 |
| GET | `/dashboard/{id}?view=` | auth | 详情 draft/published |
| PUT | `/dashboard/{id}/layout` | `dashboard:manage` | 布局（含 mobile） |
| PUT | `/dashboard/{id}/components` | manage | 组件 upsert/delete |
| PUT | `/dashboard/{id}/charts/{chartId}` | manage | 单图配置 |
| DELETE | `/dashboard/{id}/charts/{chartId}` | manage | 删除草稿图 |
| POST | `/dashboard/{id}/publish` | manage | 发布 |
| POST | `/dashboard/{id}/discardDraft` | manage | 丢弃草稿 |
| GET | `/dashboard/{id}/status` | auth | 发布状态 |
| GET/PUT | `/dashboard/{id}/linkages` | 写需 manage | 联动 |
| POST/GET | `/dashboard/{id}/share` | 写需 manage | 分享 Token |

### Tree · `/dashboardTree`

| Method | Path | 权限 | 说明 |
|--------|------|------|------|
| POST | `/dashboardTree/tree` | auth | 文件夹树 |
| POST | `/dashboardTree/create` | manage | 创建（可带 templateId） |
| POST | `/dashboardTree/rename` | manage | 重命名 |
| POST | `/dashboardTree/move` | manage | 移动 |
| POST | `/dashboardTree/delete/{id}` | manage | 删除 |
| POST | `/dashboardTree/perDelete/{id}` | manage | 硬删 |
| GET | `/dashboardTree/barInfo/{id}` | auth | 侧栏摘要 |

---

## Share（公开）· `/api/share`

| Method | Path | 说明 |
|--------|------|------|
| GET | `/share/{token}` | 已发布看板 + 数据集摘要 |
| POST | `/share/{token}/chartQuery` | Token 取数 |
| POST | `/share/{token}/export` | Token CSV 导出 |

---

## Query

| Method | Path | 说明 |
|--------|------|------|
| POST | `/chartQuery/query` | 图表取数 |
| POST | `/chartQuery/export` | CSV 导出 |
| POST | `/datasetQuery/execute` | QuerySpec 执行 |

---

## Datasource · `/api/datasource` · `@RequireAuth`

| Method | Path | 权限 | 说明 |
|--------|------|------|------|
| GET/POST | `/datasource` | 写需 `datasource:manage` | 列表 / 创建 |
| POST | `/datasource/probe` | manage | 未保存探库 |
| GET/PATCH/DELETE | `/datasource/{id}` | 写需 manage | CRUD |
| POST | `/datasource/{id}/ping` | auth | 连通性 |
| GET | `.../databases` · `schemas` · `tables` · `tables/{table}/columns` | auth | 元数据 |
| POST | `/datasource/{id}/preview` | manage | 表预览 |

---

## Dataset · `/api/dataset` · `@RequireAuth`

| Method | Path | 权限 | 说明 |
|--------|------|------|------|
| GET/POST | `/dataset` | 写需 `dataset:manage` | 列表 / 创建 |
| GET/PATCH/DELETE | `/dataset/{id}` | 写需 manage | CRUD |
| PUT | `/dataset/{id}/fields` | manage | 字段银行 |
| POST | `/dataset/{id}/preview` | auth | 预览 |

---

## Catalog · `/api/catalog`

| Method | Path | 说明 |
|--------|------|------|
| GET | `/catalog` | 报告插图：看板图目录 + 数据集字段 |

---

## Report · `/api/report` · `@RequireAuth`

| Method | Path | 权限 | 说明 |
|--------|------|------|------|
| GET/POST | `/report` | 写需 `report:manage` | 列表 / 创建 |
| GET | `/report/{id}` | auth | 详情（含 doc） |
| PATCH | `/report/{id}` | manage | 元数据 |
| PUT | `/report/{id}/doc` | manage | 文档；contentId 冲突 409 |
| POST | `/report/{id}/publish` | manage | 发布 |

---

## Conversation · `/api/conversations` · `@RequireAuth`（feature flag）

开关：`opendashboard.conversation.enabled`。关闭时除 `/feature` 外返回 404。权限：`conversation:use`。

| Method | Path | 说明 |
|--------|------|------|
| GET | `/conversations/feature` | `{ enabled }` |
| GET | `/conversations/styles` | 风格目录 |
| GET/POST | `/conversations` | 列表 / 创建 |
| GET/PATCH/DELETE | `/conversations/{id}` | 详情 / 更新 / 删除 |
| GET | `/conversations/{id}/messages` | 消息 |
| POST | `/conversations/{id}/runs` | SSE 启动 run |
| POST | `/conversations/{id}/runs/{runId}/confirm-plan` | SSE 确认 Plan |
| POST | `/conversations/{id}/runs/{runId}/cancel` | 取消 |
| GET | `/conversations/{id}/revisions` | 版本列表 |
| POST | `/conversations/{id}/revisions/{rev}/restore` | 恢复 snapshot |

设计：[conversation.md](./conversation.md) · [ai-harness.md](./ai-harness.md)

---

## 未实现但曾规划的路径

以下在历史商用规格中出现，**当前无 API**：`/embed/*`、`/chartQuery/explainSql`、alerts、jumps、画布级 PNG export。见 [../product/roadmap.md](../product/roadmap.md)。
