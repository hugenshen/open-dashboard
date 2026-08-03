# 仪表盘一期能力清单（从 DataEase 拆解）

> 目标：另产品重做。本仓库仅作能力与语义参考，不复制 `/dataVisualization` 路径与 `PANEL` 鉴权名。

## 一期必须有

| 能力 | DataEase 对应 | 目标产品契约 | 说明 |
|------|---------------|--------------|------|
| 资源树 CRUD / 移动 / 重命名 | `POST /dataVisualization/tree` 等 | `POST /dashboardTree/*` | 对齐 Dataset 树模型 |
| 侧栏摘要 | dataset `barInfo` | `GET /dashboardTree/barInfo/{id}` | 列表页右侧信息 |
| 打开草稿 / 已发布版 | `findById` + `resourceTable` | `GET /dashboard/{id}?view=draft\|published` | 对外不暴露 snapshot 表名 |
| 保存布局 | `updateCanvas`（混在一起） | `PUT /dashboard/{id}/layout` | 局部写 |
| 保存组件 | 同上 | `PUT /dashboard/{id}/components` | 组件行 upsert/delete |
| 保存单图配置 | chart upsert 混在 canvas | `PUT /dashboard/{id}/charts/{chartId}` | 编辑器高频路径 |
| 首次创建叶子 | `saveCanvas` | `POST /dashboardTree/create` | 空仪表盘即可 |
| 发布 | `updatePublishStatus` | `POST /dashboard/{id}/publish` | 草稿 → 已发布 |
| 丢弃草稿 | `recoverToPublished` | `POST /dashboard/{id}/discardDraft` | 已发布副本覆盖草稿 |
| 发布状态查询 | 散落在 VO.status | `GET /dashboard/{id}/status` | `draft \| published \| publishedWithDraft` |
| 图表取数 | `POST /chartData/getData` | `POST /chartQuery/query` | 瘦 QueryRequest |
| 筛选器进查询 | `chartExtRequest` + VQuery | `dashboardContext.filters` | 统一 filterState |
| 图间联动配置 | `/linkage/*` | `GET/PUT /dashboard/{id}/linkages` | 简化源→目标映射 |
| 联动运行时 | 前端拼条件 | `dashboardContext.linkages` | 一期后端不做图遍历 |

## 一期后置

| 能力 | DataEase 对应 | 原因 |
|------|---------------|------|
| 跳转 | `/linkJump/*` | 非最小闭环 |
| 外参 / 嵌入 | `/outerParams/*` | 非最小闭环 |
| 水印 / 主题库 | watermark / subject | 可后置配置中心 |
| 模板解压 / App 导出 | decompression / export2App | 导入导出单独阶段 |
| 数据大屏 dataV | `type=dataV` | `layoutMode=free` 仅预留字段 |
| Mobile 布局 | `mobile_layout` | PC 网格先行 |
| 并发 contentId 校验 | `checkCanvasChange` | 二期加乐观锁 |

## 商用对标落地（飞书 / Quick BI）

详见 [commercial-mvp-spec.md](./commercial-mvp-spec.md)。可运行原型：

`prototypes/hi-fi/dashboard-commercial.html`

| Phase | 状态（蓝图包） |
|-------|----------------|
| A 画布拖拽缩放 / 字段银行聚合 / ECharts / 查询控件 / 分享导出 | 原型 + Manage 桩已交付 |
| B Tab / 切片器 / 下钻 / 主题 / 移动预览 | 原型已交付 |
| C 跳转 / 同环比 / 告警 / 查看 SQL / 嵌入 | 原型 + Explain/Alert Manage 已交付 |

## 与数据集边界

- 仪表盘 **只依赖** Dataset：树、字段、权限、枚举值、查询执行。
- 图表绑定字段：`ChartView.datasetId`（禁止直连 Datasource）。
- 取数编排：`ChartQueryManage` → Dataset 查询能力；把 `filters` / `linkages` 编译为数据集过滤条件。
