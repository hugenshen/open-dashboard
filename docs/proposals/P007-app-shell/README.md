---
id: P007
title: 产品壳（左侧模块栏）与高保按模块拆分
status: in-progress
milestone: v0.5
date: 2026-08-17
prototype: docs/prototypes/hi-fi/workbench.html
prototype-snapshot: docs/prototypes/snapshots/2026-08-17-p007-app-shell-final/
acceptance: docs/proposals/P007-app-shell/acceptance.yaml
gates:
  proposal: accepted
  hi-fi: accepted
  code: wip
  acceptance: blocked
depends: P004
design: [docs/proposals/P007-app-shell/design.md]
implementation: [open-dashboard-frontend/src/shell/AppShell.vue, open-dashboard-frontend/src/workbench/views/Workbench.vue, open-dashboard-frontend/src/workbench/components/RecentReportIcon.vue, open-dashboard-frontend/src/datasource/views/DatasourceManage.vue, open-dashboard-frontend/src/dataset/views/DatasetManage.vue, open-dashboard-frontend/src/dashboard/views/DashboardList.vue, open-dashboard-frontend/src/report/views/ReportList.vue, open-dashboard-frontend/src/dashboard/hifi/editor.css, open-dashboard-frontend/src/dashboard/hifi/editorCore.js]
architecture: docs/design/architecture.html
---

# P007 · 产品壳 + 高保分模块

> **状态** `in-progress` · 路线图 [进行中](../../product/roadmap/in-progress/) · 高保 **accepted** · 代码 **wip** · 验收 blocked

## 开发入口

高保已定稿。实现对照**冻结快照**，不要只看 hi-fi 后来的增量。产品壳与三行工作台已编码，`PR-SH-10` 待手验。

| 你要 | 去看 |
|------|------|
| 范围与非目标 | 本文 |
| 怎么验收 | [acceptance.yaml](./acceptance.yaml)（PR-SH-01…09 是高保门；PR-SH-10 才是产品门） |
| 冻结交互 | [`2026-08-17-p007-app-shell-final`](../../prototypes/snapshots/2026-08-17-p007-app-shell-final/) |
| 当前增量 | [`hi-fi/workbench.html`](../../prototypes/hi-fi/workbench.html)（可能含未冻结改动） |
| 相对上一版改了什么 | [VERSIONS.md](../../prototypes/VERSIONS.md) 中 P007 两行 |
| 代码落点 | [design.md](./design.md) · `open-dashboard-frontend/src/shell/AppShell.vue` · `src/workbench/views/Workbench.vue` |
| 不要做 | 我的仪表盘 / 可问数据（[P008](../P008-permission-aware-workbench/)） |
| 当前范围 | [路线图 · 进行中](../../product/roadmap/in-progress/)：产品门 **PR-SH-10**（01…09 高保已过） |

## 波及

| 列 | 内容 |
|----|------|
| 依赖 | 对话页嵌入主题（[P004](../P004-conversation/)） |
| 改动面 | 高保 `shared/shell*`（已定稿）；产品 FE `AppShell` 与工作台；最近问数 `GET /api/conversations?limit`；最近报告 `GET /api/report?limit` |
| 不改 | 权限 IA / 可问数据（P008）；问数结果卡（P006）；Harness |
| 回归 | PR-SH-01…10；P004 的 PR-CONV-05；P006 的 PR-ASK-06 |

## 定位

宽屏工作台左右留白，是因为首页内容卡在 1280px 居中，一级模块又全堆在顶栏。  
本期把 **产品壳** 改成：左侧一级模块、顶栏通用能力、右上账号；并把高保从单文件拆开，便于按模块改交互、做 diff。

## 范围

### Shell-1（已定稿 · 高保）

- 左侧一级导航：工作台 / 对话 / 数据源 / 数据集 / 仪表盘 / 报告；用户可手动收起，偏好记在 `localStorage['od.rail.slim']`；收起/展开不弹「侧栏已收起」类 toast
- 工作台 / 对话 / 数据源 / 数据集 / 报告默认保持展开；仪表盘编辑器进入时自动收成图标轨，可再展开（与其它页一样占位推内容，非浮层）
- 顶栏固定帮助、外观切换、右上账号；SQLBot 仅在仪表盘编辑器展示（编辑态并入编辑器顶条，隐藏空产品顶栏）
- 工作台使用页内问数框；对话页与资源模块（数据源 / 数据集 / 仪表盘 / 报告）顶栏都不放问数框
- 外观：浅色（默认，侧栏与内容统一）/ 深色侧栏 / 深色；记在 localStorage `od.theme`
- 深色主题同步进入嵌入式对话工作区，禁止出现深色外壳包裹白色 iframe
- 仪表盘编辑器：产品固定完整能力（原 Phase C），不展示 Phase A/B/C；布局工具留在画布工具条；壳层操作与编辑操作同一顶条，避免双顶栏空白
- 对话：嵌入页不再显示内侧栏；新对话 / 历史放在对话顶条，落地页「最近对话」即历史

### Workbench-1（已定稿 · 高保）

- 工作台铺满剩余宽度，桌面端采用主工作区 + 状态侧栏，并按三行成对对齐：
  1. 问数 / 今日概览
  2. 常用入口 / 待处理
  3. 最近看板 / 最近报告
- 问数框下方展示最近问数（`GET /api/conversations?limit=8`）；无记录时才显示「试试」示例。点芯片进入该会话，不新开一轮。
- 右栏最近报告来自 `GET /api/report?limit=4`（按 `updateTime` 倒序），条目用文档图标（无「报」字：已发布绿、草稿紫），点条目进入报告编辑器
- 今日概览展示数据源状态、待发布看板、同步时间与近期业务动态；动态必须能进入对应问数或看板，不放泛互联网资讯
- 最近看板桌面最多展示 3 个、窄屏最多 2 个，其余经「全部」进入列表；仅 1–2 个时补「创建新看板」入口
- 封面按名称/分组推断领域（销售、财务、订单、供应、运营、问数、分析），使用差异化插画，不用重复假柱图
- 新用户空状态按「连接数据源 → 准备数据集 → 问数或建看板」引导；右栏同步显示无待办、无问数记录，不留空白卡
- 支持高保状态参数：`?state=empty`、`?count=1|2|10`，用于验收空 / 少 / 多数据
- 字号、文本对比、焦点环与点击区域按 WCAG 2.2 可读性基线处理；桌面、窄屏、浅色、深色均不得横向溢出

### Shell-2（后续 · 产品实现）

- Vue `ModuleTopbar` 改为 `AppShell`（左栏 + 顶栏）
- 菜单仍走 `GET /api/auth/menus`
- 编辑器路由可 `meta.shell = 'editor'`：左栏 slim 或隐藏

### Proto-1（已定稿 · 高保拆分）

| 文件 | 模块 |
|------|------|
| `shared/shell.css` · `shared/shell.js` | 全站壳（菜单与通用配置的唯一来源） |
| `workbench.html` | 工作台（本提案交互真相） |
| `conversation.html` | 对话 |
| `datasource.html` | 数据源 |
| `dataset.html` | 数据集 |
| `dashboard.html` | 仪表盘列表 / 编辑器 / 预览 |
| `report.html` | 报告 |
| `shared/commercial.css` · `shared/commercial.js` | 资源模块内核 |
| `dashboard-commercial.html` | 旧 hash 兼容跳转 |

禁止在模块 html 里再复制一份左栏菜单。新模块先建独立 html，再写入 `shared/shell.js` 的 `PAGES`。

定稿快照：[`2026-08-17-p007-app-shell-final`](../../prototypes/snapshots/2026-08-17-p007-app-shell-final/)。

## 非目标

- 本期不改 OpenAPI / 权限模型
- 不把编辑器画布逻辑再拆出 `shared/commercial.js`（体积大，另开拆分）
- 不实现真实多账号 IAM

权限感知工作台（我的仪表盘 / 我的报告 / 共享给我 / 可问数据）及其消费闸门已迁到 [P008](../P008-permission-aware-workbench/)。P007 只锁定壳层、布局与空状态，不把权限草案冒充本期已交付能力。

## 验收 ID

判据、路径、状态与证据只在 [acceptance.yaml](./acceptance.yaml)。PR-SH-01…09 是高保门，不能代表产品已交付；PR-SH-10 是本月产品门。

| ID | 标题 |
|----|------|
| PR-SH-01 | 产品壳与满宽工作台 |
| PR-SH-02 | 模块壳层一致 |
| PR-SH-03 | 编辑器画布不被遮挡 |
| PR-SH-04 | 一模块一页 |
| PR-SH-05 | 原型版本治理 |
| PR-SH-06 | 工作台空少多状态 |
| PR-SH-07 | 左栏收缩规则 |
| PR-SH-08 | SQLBot 仅编辑器 |
| PR-SH-09 | 深浅主题一致 |
| PR-SH-10 | Vue AppShell 产品交付 |

## 实现状态

- **已完成**：`docs/prototypes/hi-fi/` 高保定稿与快照。
- **已编码、待验收**：Vue `AppShell` 与工作台（问数框下最近问数走 Java 会话表；`?state=empty`、`?count=1|2|10`）。对照冻结快照时，最近问数位置以本轮产品确认为准。
- `PR-SH-10` 手验通过前不把本提案标 `done`，也不回写 `requirements.md`。

## 关联

- 协作：[../../process.md](../../process.md)
- 原型账本：[../../prototypes/VERSIONS.md](../../prototypes/VERSIONS.md)
- 现行产品架构：[architecture.html](../../design/architecture.html#application)
- 对话：[P004 对话设计](../P004-conversation/design.md) · [P004](../P004-conversation/README.md)

## 修订记录

| 日期 | 说明 |
|------|------|
| 2026-08-18 | 产品编辑器隐藏 Phase A/B/C（能力固定 C）；编辑顶栏改为 flex，避免标题与操作按钮叠在 236px 格子里 |
| 2026-08-18 | 左栏选中态与顶栏改走 `--od-bg`，与模块画布同色，去掉淡紫选中块和顶栏白条的割裂 |
| 2026-08-18 | 数据源 / 数据集 / 仪表盘 / 报告列表页画布与选中态对齐壳 token（`--od-bg` / `--od-brand-soft`），与工作台、对话一致 |
| 2026-08-18 | 对话页对齐壳规则：隐藏内侧栏与本会话产物列，新对话/历史/探索只留对话顶条 |
| 2026-08-17 | 明确高保 gate 与产品代码 gate 分离；权限感知工作台迁入 P008 |
| 2026-08-17 | Vue AppShell 与工作台三行布局已编码；PR-SH-10 仍待对照快照手验 |
