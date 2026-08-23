# P013 详细设计

成功标准只反链 [README](./README.md) 验收 ID / [acceptance.yaml](./acceptance.yaml)。

## 1. 用户流程

```text
工作台「新建看板」或仪表盘列表「+ 新建」
  → 模板市场（渐变舞台 + 左分类 + 搜索 + 浮卡网格）
    悬停封面中央：预览 | 应用
  → 预览：PC / 平板 / 手机 切端
  → 应用：命名 → 创建 draft → 进入编辑器

市场壳质感对齐 Quick BI（渐变底、软阴影浮卡、官方徽标、封面悬停中央按钮）。不做「本月精选」Hero。
封面 SVG 的图种必须与应用后稿面一致（KPI / 柱 / 条 / 线 / 饼 / 表），禁止封面独有仪表盘、地图、热力。
交互仍学 DataEase：左分类、全页预览、返回市场。
不做独立「数据大屏」产品；经营驾驶舱允许深色封面 + 一条渐变主视觉，其余图表保持白卡。
明细表卡片内分页条钉在底部，不需要滚出卡片才看见。
模板应用后的画布自带筛选组件（日期区间 + 一个业务维度切片），不只依赖编辑器顶栏查询条。
点选说明条/文本时收起图表数据作业栏，并按当前列宽重排组件，避免画布右侧留白。
```

## 2. 模板 ≠ Tabler 后台页

| Tabler 原话 | OD 映射 |
|-------------|---------|
| 20+ 页面模板（仪表盘、分析、邮件…） | **≥20 张仪表盘稿面**（经营/销售/财务/运营/零售/客户/供应） |
| 响应式即默认 | 模板写入 `mobile.components`，预览三端同一套数据 |
| Sass 变量换主题 | CSS 自定义属性 `--od-brand` / `--od-radius` / 明暗；高保无 Sass 构建 |

不要做：邮件 inbox、登录封面、用户名片、Kanban。

## 3. 模板清单（高保 ≥20）

分类：推荐、销售、运营、财务、零售、客户、供应、空白。

| id | 名称 | 分类 | 布局家族 | 多端 |
|----|------|------|----------|------|
| blank | 空白画布 | 空白 | 空 | 否（C 档） |
| sales | 销售分析 | 销售 | kpi4-split | 是 |
| ops | 运营看板 | 运营 | kpi4-trend | 是 |
| finance | 财务概览 | 财务 | kpi3-books | 是 |
| region | 区域作战 | 销售 | kpi3-geo | 是 |
| inventory | 库存周转 | 供应 | kpi3-stock | 是 |
| crm | 客户分层 | 客户 | kpi3-crm | 是 |
| promo | 促销监控 | 运营 | kpi4-campaign | 是 |
| exec | 经营驾驶舱 | 推荐 | kpi8-wall | 是 |
| gmv | 商户入账 | 零售 | kpi4-split | 是 |
| store | 门店零售 | 零售 | kpi4-split | 是 |
| funnel | 转化漏斗 | 运营 | kpi3-funnel | 是 |
| traffic | 流量获客 | 运营 | kpi4-trend | 是 |
| channel | 渠道对比 | 销售 | kpi4-split | 是 |
| product | 产品贡献 | 销售 | kpi3-geo | 是 |
| cohort | 留存分析 | 客户 | kpi3-crm | 是 |
| nps | 满意度 | 客户 | kpi3-crm | 是 |
| cash | 现金流 | 财务 | kpi3-books | 是 |
| cost | 费用管控 | 财务 | kpi3-books | 是 |
| sla | 服务时效 | 运营 | kpi4-trend | 是 |
| quality | 质量缺陷 | 供应 | kpi3-stock | 是 |
| supply | 供应履约 | 供应 | kpi3-stock | 是 |
| hr | 人力编制 | 推荐 | kpi8-wall | 是 |
| kpi-wall | KPI 墙 | 推荐 | kpi8-wall | 是 |

高保用已有 `demoDash` / `demoOpsDash` 等家族克隆改名；`kpi-wall` / `exec` / `hr` 封面是八格 KPI 墙，应用后暂时复用销售四 KPI 稿（实现再拆独立蓝图）。实现时 `DashboardTemplateCatalog` 按同表扩蓝图。

## 4. 多端即默认

模板应用时调用 `autoSeedMobileLayout(dash)`：

1. `mobile.enabled = true`
2. 查询条 / 切片 / 文本通栏 `w=6 h=1`
3. KPI 两列 `3×2`
4. 其余图/表通栏 `6×4` 纵向叠

**不替代 P001 C 档**：空白板与用户手改板仍可关移动端、勾选上板、样式分设。模板只是「开箱已有一份可用的移动稿」。

预览器三端是 **同一 `mobile`/`components` 数据** 的不同画布，不是另做一套移动改造。

## 5. 主题变量

壳层 `:root` 增加：

```css
--od-brand / --od-brand-hover / --od-brand-soft
--od-radius / --od-radius-lg / --od-gap
--od-ink / --od-bg / --od-card / --od-line
```

`html[data-od-theme]`：light / dark-rail / dark（P007 已有）。  
`html[data-od-brand]`：`indigo`（默认）| `feishu` | `tabler` | `teal`。

商业内核 `--brand` 改为 `var(--od-brand)`，避免壳与画布两套蓝。高保用 CSS 变量，实现阶段不强制引入 Sass；若 FE 构建已有预处理，可把变量源写成 `.scss` 再编译，对外仍是同一组 token。

**卡片 chrome 统一、场景配色分开**：图/表卡片白底 + 浅标题栏共用（不再整页换花底）。允许经营驾驶舱 / KPI 墙 / 门店零售在顶部放一条渐变主视觉，或 1 张渐变 KPI，其余图仍白卡。系列色与 KPI 强调色按场景。封面以浅灰画布上的成品稿为主，经营驾驶舱可用深色驾驶舱封面。市场壳对齐 Quick BI 质感。

## 6. 阅读态卡片

预览 / 分享 / `preview-readonly`：

- 不渲染 `ch.chartType` 角标（`bar` / `pie` 是编辑器泄漏）
- `.widget .hd` 背景透明、无灰底分割线
- 画布不再套一层白底板+阴影（灰页底直接铺卡片）

编辑态保持现有拖拽手柄与类型角标。

## 7. 契约（实现时）

`DashboardTemplateVO` 增：

```yaml
category: string
thumbnail: string   # 可选
responsive: boolean
recommended: boolean
```

`create.templateId` 行为不变；未知 id 回落 `blank`。OpenAPI 与 Catalog 同 PR。

## 8. 风险

- 模板数量多但数据仍绑演示集：可接受，应用后用户改数据集
- 自动移动布局可能挤：用户可再进 C 档微调
- 品牌色与编辑器内写死 `#3370ff` 的 splashes 可能短暂不一致，阅读态优先吃 token
