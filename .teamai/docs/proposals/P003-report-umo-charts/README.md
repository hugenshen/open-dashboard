---
id: P003
title: 在线报告 Umo 编辑器插入看板图与报告内新建图
status: done
milestone: v0.4.0
implemented_in: v0.4.0
date: 2026-08-03
done: 2026-08-03
acceptance: .teamai/docs/proposals/P003-report-umo-charts/test/acceptance.yaml
gates:
  proposal: accepted
  hi-fi: none
  code: merged
  acceptance: passed
architecture: .teamai/docs/design/architecture.html
contract: .teamai/docs/design/openapi.yaml
requirements: [PR-RPT-01, PR-RPT-02, PR-RPT-03, PR-RPT-04, PR-RPT-05, PR-RPT-06, PR-RPT-07]
implementation: [open-dashboard-frontend/src/report/, open-dashboard-backend/]
---

# P003 · 在线报告（Umo Editor）引用 / 新建仪表盘图表

> **状态** `done` · 路线图 [已完成](../../product/roadmap/done/) · 高保 none · 代码 merged · 验收 passed

## 开发入口

已交付，只追溯。现行 live 图行为看 [architecture.html](../../design/architecture.html#business) 与 `PR-RPT-01…07`。报告静态独立授权尚未交付，见 [P008](../P008-permission-aware-workbench)。

## 1. 背景

产品除仪表盘外还有 **在线报告**：正文排版用 [Umo Editor](https://dev.umodoc.com/cn/docs/editor)（Vue3 + Tiptap3）。报告需复用仪表盘侧的 **图表配置意图 + 双层取数协议**，而不是另造一套出数链路。

## 2. 已锁定决策

| # | 决策 | 说明 |
|---|------|------|
| D1 | **实时取数** | 阅读 / 编辑预览均走 `chartQuery` → `datasetQuery`；文档 **不**持久化 ResultTable |
| D2 | **新建图仅属报告** | 「新建图表」配置只存在于报告文档节点（`source: inline`），**不**写入仪表盘组件 / `de_chart_view` |
| D3 | 引用看板图 | 节点只存 `dashboardId + chartId`（+ view 策略），encode 以看板配置为准 |
| D4 | 编辑器 | Umo Editor；工具栏用插槽扩展；图表用自定义 Tiptap Node + Vue NodeView |

导出 Word/PDF 时是否「渲染瞬间快照」属后续议题，**默认产品行为仍是实时**。

## 3. 目标交互

> **交互参照**：`.teamai/docs/prototypes/hi-fi/dashboard-commercial.html`（`#/report/...`）。
> 已交付需求：[requirements.md](../../product/requirements.md) PR-RPT-01…07。
> 现行实现架构：[architecture.html](../../design/architecture.html#business) · [OpenAPI](../../design/openapi.yaml)。

工具栏 **「工具」** 分组槽位（Umo `#toolbar_tools`，**非** `#toolbar_insert`）增加两个入口：

### 3.1 引用仪表盘图表

```text
点击「引用仪表盘」
  → 三栏向导：左看板列表 → 中图表多选+搜索 → 右实时预览
  → 确认 → 按勾选顺序插入多个 reportChart（source=dashboard）
  → 非整盘导入；文档只存 dashboardId + chartId
```

- 数据 / encode / 联动定义以 **看板 published（或可配 draft）** 为准  
- 报告内可覆盖的仅限 **展示壳**：宽度、对齐、标题是否显示、固定高度等（不改 encode）

### 3.2 新建图表并插入

```text
点击「新建图表」
  → 左右分栏向导：左实时预览 · 右配置（数据集/类型/字段银行/维指/聚合/格式/高度/标题）
  → 确认后才插入 reportChart（source=inline，配置写在节点 attrs）
  → 插入后右侧 inspector（数据/样式/高级）可继续改
```

- 配置 **只活在报告**；删除节点即删除该配置  
- 不提供「同步到仪表盘」一期能力（可列二期）

### 3.3 节点内行为

| 态 | 行为 |
|----|------|
| 编辑选中 | 边框/工具条：刷新、（inline）编辑配置、删除；dashboard 源可「打开原看板」外链 |
| 编辑未选中 / 预览 | NodeView 调取数并渲染 ECharts（或 table） |
| 文档保存 | 只存节点 attrs + 正文 JSON；**不含** rows |

## 4. 文档节点模型

Tiptap Node：`reportChart`（atom, selectable, draggable）。

```ts
type ReportChartAttrs = {
  id: string                    // 节点稳定 id（报告内）
  source: 'dashboard' | 'inline'
  // source=dashboard
  dashboardId?: string
  chartId?: string
  view?: 'published' | 'draft'  // 默认 published
  // source=inline
  datasetId?: string
  chartType?: string            // bar | line | pie | kpi | table | …
  encode?: Record<string, unknown>
  style?: Record<string, unknown>
  senior?: Record<string, unknown>
  // 展示壳（两种 source 共用）
  title?: string                // 覆盖显示标题；空则用看板标题 / 默认
  width?: 'full' | 'half' | number
  height?: number               // px
}
```

报告实体（配置库，与看板分离）：

| 表 / 字段 | 说明 |
|-----------|------|
| `de_report` | id, name, status, … |
| `de_report_doc` | report_id, copy_type draft\|published, `content_json` JSONB（Umo/Tiptap doc） |

权限：报告 ACL（manage/edit/view）独立；取数时再过数据集 / 看板闸门。

## 5. 取数协议复用

```text
ReportChartNodeView.load():
  if source == dashboard:
    POST /chartQuery/query {
      dashboardId, chartId, view,
      context: reportContext   // 一期可空；二期接报告级筛选
    }
  if source == inline:
    POST /chartQuery/query {
      dashboardId: null 或约定 sentinel,
      inline: { datasetId, chartType, encode },
      context: reportContext
    }
    // 后端：无看板 ACL，仅数据集 USE + RLS/CLS
```

约定：

- **style 永不进 SQL**（与仪表盘一致）  
- inline 路径必须已支持（编辑器预览未保存图时本就需要 `inline`）  
- 报告 **不** 直连 `datasetQuery`；统一经 `chartQuery` 塑形，避免 NodeView 分叉

可选增强（非一期）：`POST /chartQuery/query` 增加 `client: 'report'` 便于审计。

## 6. 前端模块（Vue3）

```
frontend/src/report/
  views/ReportEditor.vue       # 挂 Umo Editor
  extensions/reportChart.ts    # Tiptap Node
  nodeviews/ReportChartView.vue
  components/
    InsertDashboardChartDialog.vue
    CreateInlineChartWizard.vue
  api/report.ts
```

Umo 接入要点（对照官方文档 / 高保）：

- Ribbon：开始/插入/表格/工具/页面/视图/导出；默认「开始」  
- `extensions: [ReportChart]`  
- 插槽 `#toolbar_tools`：两个业务按钮打开上述向导  
- 保存：`editor.getJSON()` → `PUT /report/{id}/doc`  
- 预览：Umo Viewer 或只读 Editor + 同一 NodeView  
- 页面大纲默认隐藏；标题文案「页面大纲」；A4 + 裁切线 + 状态栏（字数/缩放/视图）

与仪表盘共用：`chartQuery` client、encode 字段面板可抽 `shared/chart`（二期再抽也不阻塞一期向导简化版）。

## 7. 后端模块

```
io.opendashboard
  api/ReportController
  application/ReportDocService
  application/ChartQueryService   # 已有：分支 dashboard | inline
```

| API | 说明 |
|-----|------|
| CRUD `/api/report/**` | 报告元数据 + draft/published doc |
| 既有 `/api/chartQuery/query` | 扩展：允许无 `dashboardId` 的纯 `inline`（权限只校验 dataset） |
| 既有树/画布 API | 供「引用」弹层列看板与图表 |

## 8. 权限矩阵（摘要）

| 动作 | 报告 | 看板 | 数据集 |
|------|------|------|--------|
| 插入引用图 | edit | view | （取数时 USE） |
| 插入新建图 | edit | — | USE |
| 阅读含图报告 | view | 引用图需看板 view**或**分享策略（见下） | USE + RLS |
| 编辑 inline 配置 | edit | — | USE |

**引用图与看板权限**：若读者有报告 view、无看板 view —— 一期建议 **拒绝出数并显示占位**（安全默认）；二期可做「发布时快照权限」或「报告发布连带授权」。

### 后续权限边界（不回写本提案已交付基线）

历史对话已确认：未来报告发布稿按**静态资源独立授权**，`report:view` 可查看静态正文，但不会继承底层 `dataset:use` 或问数权；刷新 live 图、继续问数和生成洞察时重新校验数据集权限。该变化属于 [P008 权限感知工作台与消费边界](../P008-permission-aware-workbench)，在 P008 交付前，P003 仍以当前 live 图与无权限占位行为为准。

## 9. 非范围（一期）

- 报告级全局筛选器联动多图（可留 `context` 扩展点）  
- 新建图「保存到仪表盘」  
- 文档内持久化查询结果 / 离线包  
- Umo 协同服务器、批注深度集成  
- 移动端 Umo Mobile（可后接同一 Node attrs）

## 10. 与 v0.3 的关系

- **依赖**：Vue/Java 脚手架、OpenAPI 中 `chartQuery` + `inline`、数据集 USE 闸门  
- **不阻塞**：仪表盘编辑器高保迁 Vue 可并行；报告可先做 Node + stub 取数  
- 交付版本：**v0.4.0**；稳定实现已沉淀到 `.teamai/docs/design/`

## 11. 验收（设计落地后）

已交付基线见 [requirements.md](../../product/requirements.md) PR-RPT-01…07；逐项判据与证据见 [acceptance.yaml](./test/acceptance.yaml)。验收摘要：

1. 工具槽可见「引用仪表盘」「新建图表」（`#toolbar_tools`）  
2. 引用三栏多选按序插入；新建左右向导确认后插入  
3. 两种插入均生成 `reportChart`，保存再打开 attrs 不丢、无结果行  
4. 预览实时出数；inline 插入后 inspector 可改  
5. 删除 inline 不影响看板；无权限错误占位不白屏  

## 12. 修订

| 日期 | 说明 |
|------|------|
| 2026-08-03 | draft：锁定实时取数 + inline 仅报告；整体交互与模型 |
| 2026-08-03 | accepted → v0.4.0；脚手架：Report API + 报告编辑器插图工具 / NodeView |
| 2026-08-03 | 高保：`dashboard-commercial.html` 顶栏仪表盘后增加「报告」列表/Umo 风编辑器 |
| 2026-08-03 | **状态说明**：交互以高保为基准；已交付需求归入 `product/requirements.md`，稳定实现归入 `design/`；槽位由 `#toolbar_insert` 更正为 `#toolbar_tools` |
