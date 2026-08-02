# 仪表盘后端 API 契约（一期）

风格对齐已重构的 Dataset：专用 Request/Response、薄 Controller、鉴权资源名统一为 `DASHBOARD`。

## 约定

- ID 在 JSON 中序列化为 **string**。
- 编辑默认 `view=draft`；观看 / 分享强制 `view=published`。
- 禁止 `Request extends VO`。
- 禁止对外字段名 `resourceTable` / `snapshot` / `PANEL`。

---

## 1. `/dashboardTree` — 资源树

| Method | Path | Request | Response | 权限 |
|--------|------|---------|----------|------|
| POST | `/dashboardTree/tree` | `BusiNodeRequest` | `BusiNodeVO[]` | read |
| POST | `/dashboardTree/create` | `DashboardCreateRequest` | `DashboardNodeVO` | `pid:manage` |
| POST | `/dashboardTree/rename` | `DashboardRenameRequest` | `DashboardNodeVO` | `id:manage` |
| POST | `/dashboardTree/move` | `DashboardMoveRequest` | `DashboardNodeVO` | `id+pid:manage` |
| POST | `/dashboardTree/perDelete/{id}` | — | `boolean` | `id:manage` |
| POST | `/dashboardTree/delete/{id}` | — | void | `id:manage` |
| GET | `/dashboardTree/barInfo/{id}` | — | `DashboardBarVO` | read |

### DTO 摘要

```ts
DashboardCreateRequest {
  pid: string
  name: string
  nodeType: 'folder' | 'dashboard'
  layoutMode?: 'grid' // default grid
}

DashboardRenameRequest { id: string; name: string }
DashboardMoveRequest   { id: string; pid: string }

DashboardNodeVO {
  id, pid, name, nodeType, status, layoutMode, contentId, version, updateTime
}

DashboardBarVO {
  id, name, nodeType, status, createBy, createTime, updateBy, updateTime, chartCount
}
```

---

## 2. `/dashboard` — 画布读写

| Method | Path | Request | Response | 权限 |
|--------|------|---------|----------|------|
| GET | `/dashboard/{id}?view=draft\|published` | — | `DashboardDetailVO` | read / manage |
| PUT | `/dashboard/{id}/layout` | `DashboardLayoutUpdateRequest` | `DashboardLayoutVO` | manage |
| PUT | `/dashboard/{id}/components` | `DashboardComponentsUpdateRequest` | `DashboardComponentVO[]` | manage |
| PUT | `/dashboard/{id}/charts/{chartId}` | `ChartViewSaveRequest` | `ChartViewVO` | manage |
| GET/PUT | `/dashboard/{id}/linkages` | `DashboardLinkageVO[]` | 同上 | manage |

### DashboardDetailVO

```ts
{
  meta: DashboardNodeVO
  layout: DashboardLayoutVO
  components: DashboardComponentVO[]
  charts: Record<string, ChartViewVO>  // 可后续改为按需拉取
  linkages: DashboardLinkageVO[]
}
```

### 写请求

```ts
DashboardLayoutUpdateRequest {
  gridCols?: number
  gridRows?: number
  themeRef?: string
  refreshSec?: number
  extStyle?: object
  contentId: string  // 乐观锁（二期强制；一期可透传）
}

DashboardComponentsUpdateRequest {
  upsert: DashboardComponentVO[]
  deleteIds: string[]
  contentId: string
}

ChartViewSaveRequest {
  datasetId: string | null
  chartType: string
  title?: string
  encode: object
  style?: object
  senior?: object
  contentId: string
}

DashboardComponentVO {
  id, type, parentId?, chartViewId?, x, y, w, h, zIndex, props
}

ChartViewVO {
  id, dashboardId, datasetId, chartType, title, encode, style, senior
}

DashboardLinkageVO {
  id?, sourceChartId, sourceField, targetChartId, targetField, enabled
}
```

保存任一幅画布写接口后：若原 `status=published` → 变为 `publishedWithDraft`。

---

## 3. `/dashboard` — 发布

| Method | Path | Response |
|--------|------|----------|
| POST | `/dashboard/{id}/publish` | `DashboardStatusVO` |
| POST | `/dashboard/{id}/discardDraft` | `DashboardStatusVO` |
| GET | `/dashboard/{id}/status` | `DashboardStatusVO` |

```ts
DashboardStatusVO {
  id: string
  status: 'draft' | 'published' | 'publishedWithDraft'
  contentId: string
  version: number
}
```

---

## 4. `/chartQuery` — 运行时取数

| Method | Path | Request | Response |
|--------|------|---------|----------|
| POST | `/chartQuery/query` | `ChartQueryRequest` | `ChartQueryResult` |

```ts
ChartQueryRequest {
  // 优先用已保存图表
  chartId?: string
  dashboardId: string
  view?: 'draft' | 'published'  // 预览草稿用 draft；观看 published
  // 编辑器未保存时可内联
  inline?: {
    datasetId: string
    chartType: string
    encode: object
  }
  context: {
    filters: Array<{
      componentId: string
      field: string
      operator: string
      value: unknown
    }>
    linkages: Array<{
      sourceChartId: string
      sourceField: string
      value: unknown
      targetChartId: string
      targetField: string
    }>
  }
}

ChartQueryResult {
  fields: Array<{ name: string; type: string }>
  data: unknown[][]
  series?: object
  extra?: object
}
```

权限：仪表盘读权限 **且** 数据集读权限。

---

## 分层

```
api/*Api.java          ← 契约（本文件 / OpenAPI）
server/*Server.java    ← 薄 RestController
manage/*Manage.java    ← 业务：树、画布、发布、取数、联动
dao / store            ← 持久化（一期可用内存实现演示垂直切片）
```

参考薄控制器：DataEase `DatasetTreeServer`。  
反例：`DataVisualizationServer`、`DatasourceServer`。
