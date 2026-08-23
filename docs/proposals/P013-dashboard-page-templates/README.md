---
id: P013
title: 仪表盘页面模板、阅读态主题与多端即默认
status: in-progress
milestone: v0.6
date: 2026-08-23
prototype: docs/prototypes/hi-fi/dashboard.html
prototype-snapshot: docs/prototypes/snapshots/2026-08-23-pre-p013/
design: [docs/proposals/P013-dashboard-page-templates/design.md]
acceptance: docs/proposals/P013-dashboard-page-templates/acceptance.yaml
gates:
  proposal: accepted
  hi-fi: wip
  code: wip
  acceptance: none
depends: [P001, P007]
---

# P013 · 仪表盘页面模板、阅读态主题与多端即默认

> **状态** `in-progress` · 路线图 [进行中](../../product/roadmap/in-progress/) · 高保 wip · 代码 wip · 验收 none
>
> 对照 Tabler（响应式即默认 / 变量主题 / 开箱模板）与 DataEase 模板市场交互。**页面模板 = 仪表盘稿面**，不是后台邮件/登录页。

## 开发入口

| 你要 | 去看 |
|------|------|
| 范围与非目标 | 本文 |
| 交互与模板清单 | [design.md](./design.md) |
| 怎么验收 | [acceptance.yaml](./acceptance.yaml) |
| 当前增量 | [`hi-fi/dashboard.html`](../../prototypes/hi-fi/dashboard.html) · `#/templates` |
| 开工前冻结 | [`2026-08-23-pre-p013`](../../prototypes/snapshots/2026-08-23-pre-p013/)（increment，不是本提案验收基线） |
| 代码落点 | `DashboardTemplateCatalog` · `TemplateMarket.vue` · `/dashboards/templates` · `shell/theme.ts` · `editorCore.js` / `editor.css` 阅读态 |
| 不要做 | 整仓引入 `@tabler/core`；替换 72 列编辑器；改对话出板（P012） |

## 波及

| 列 | 内容 |
|----|------|
| 依赖 | P001 移动画布保留给手改板；P007 外观切换扩展品牌色 |
| 改动面 | 高保仪表盘模板市场、壳层 CSS 变量、阅读态卡片 chrome；实现时 OpenAPI 模板列表扩字段 |
| 不改 | P007 已定稿快照；P012 出板算法；冻结 `snapshots/` |
| 回归 | PR-DASH-03（从模板创建）；PR-DASH-11（移动端 C 档不回退） |
| 冲突修订 | P001：模板**自带**移动布局，不要求用户再勾选上板；空白画布仍走 C 档。planned「分析体验」里主题/KPI/模板市场收到本提案 |

## 为什么开这条

现有「从模板创建」是 4 张文字磁贴（blank / sales / ops / finance），没有预览、没有分类、应用后还要再做移动端。Tabler 的卖点（响应式即默认、改变量换主题、20+ 开箱稿面）应对齐到 **BI 仪表盘模板**，交互学 DataEase 模板市场：左分类、封面卡、预览/应用。

## 范围

### 高保（本期）

- 新建看板进入 **模板市场**（全页，不是四格弹窗）
- ≥20 张开箱模板：销售 / 运营 / 财务 / 零售 / 客户 / 供应 / 空白
- 封面悬停：预览、应用；预览可切 PC / 平板 / 手机（证明模板自带多端）
- 应用后进入编辑器，`mobile.enabled=true` 且已铺移动组件
- 壳层 CSS 变量驱动浅色 / 深色 / 品牌色（飞书蓝、Indigo、Tabler 蓝、青绿）
- 阅读态（预览/分享）去掉 `bar`/`pie` 类型角标，标题栏不再用编辑器灰条

### 实现（本期已编码，未验收）

- `GET /api/dashboard/templates` 扩分类、封面、`responsive` / `recommended`
- Catalog ≥20；非 blank 应用时写入 `mobile.enabled=true` 与组件
- 主题 token 与品牌色进产品壳（CSS 变量，无 Sass）
- 新建入口进入全页模板市场 `/dashboards/templates`

## 非目标

- 邮件、登录、Kanban、用户名片等 Tabler admin 杂质页
- Bootstrap 12 栅格替换 72 列拖拽编辑器
- `@tabler/core` / ApexCharts 整仓替换
- 对话 `/board` 生成算法（P012）
- 模板市场联网下载第三方包

## 产品需求

分析师点「新建」后像 DataEase 一样逛模板：分类、搜索、看封面、预览多端、一键应用。应用出来的板在手机上直接能读，不用再做一遍移动端改造。改品牌色/明暗只动 CSS 变量。

## 交互与原型

见 [design.md](./design.md)。高保入口：`dashboard.html#/templates`；工作台「新建看板」进同一市场。

## 验收 ID

判据只在 [acceptance.yaml](./acceptance.yaml)。

| ID | 标题 |
|----|------|
| PR-TPL-01 | 评审接受：模板市场 + 变量主题 + 模板自带多端 |
| PR-TPL-02 | 新建走模板市场，≥20 张、可分类搜索 |
| PR-TPL-03 | Quick BI 质感市场：浮卡、封面悬停预览/应用、全页预览；封面图种与稿面一致 |
| PR-TPL-04 | 模板应用后移动端已启用，无需再勾选上板 |
| PR-TPL-05 | CSS 变量可切明暗与品牌色 |
| PR-TPL-06 | 阅读态去掉类型角标与灰标题栏 |
| PR-TPL-07 | 空白画布仍可走 P001 C 档手改移动布局 |
| PR-TPL-08 | 开工前 hi-fi 已冻结 increment 快照 |
| PR-TPL-09 | 应用后图表卡片 chrome 统一为 DataQ 默认 |
| PR-TPL-10 | 模板稿面自带画布筛选（日期 + 维度切片） |
| PR-TPL-11 | 再点说明条不撑空画布，右栏仍有文本配置 |

## 修订记录

| 日期 | 说明 |
|------|------|
| 2026-08-23 | 对照 Quick BI 模板市场：市场壳改为渐变舞台 + 精选 Hero + 浮卡；经营驾驶舱/门店/KPI 墙增加渐变主视觉，图/表仍白卡 |
| 2026-08-23 | 高保落地：`#/templates` 24 张、CSS 变量品牌色、阅读态去角标；PR-TPL-02…07 手验 pass。hi-fi 仍 wip，待评审 accepted |
| 2026-08-23 | 按用户意见去掉本月精选；封面底栏与应用后稿面统一为排行/趋势/饼，去掉封面独有仪表盘/地图/热力；明细表分页钉在卡片底 |
| 2026-08-23 | 模板画布补日期+维度切片；点说明条时按当前列宽重排，避免 data-ops 收起后右侧留白 |
