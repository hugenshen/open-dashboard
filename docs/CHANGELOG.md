# Changelog

文档与高保原型的可见变更。产品实现细节以代码为准。

格式参考 [Keep a Changelog](https://keepachangelog.com/)。

## [Unreleased]

### Added

- 文档版本规范：[`VERSIONING.md`](./VERSIONING.md)、[`proposals/`](./proposals/)
- 取数对照页：[`chart-getdata-comparison.html`](./chart-getdata-comparison.html)（DataEase getData vs chartQuery）
## [0.4.0] - 2026-08-03

### Added

- 提案 [P003](./proposals/P003-report-umo-charts.md) accepted → 规格 [`specs/v0.4.0-report-umo-charts.md`](./specs/v0.4.0-report-umo-charts.md)
- 在线报告：引用看板图 / 报告内新建图（实时取数；inline 仅属报告）
- Report API stub + 前端 `report/` 编辑器插图工具与 `reportChart` 节点
- 高保顶栏「报告」：列表 + Umo 风编辑器（引用看板图 / 新建图表 · 实时演示）

## [0.3.0] - 2026-08-03

### Added

- 技术选型锁定：[`tech-stack.md`](./tech-stack.md)（Vue 3 + JDK 21 Spring Boot + PostgreSQL）
- 需求 [`requirements/v0.3.0-core.md`](./requirements/v0.3.0-core.md) · 规格 [`specs/v0.3.0-core.md`](./specs/v0.3.0-core.md)
- 提案 [P002](./proposals/P002-vue-java-scaffold.md)：真前后端脚手架；高保迁至 `prototypes/hi-fi/`
- OpenAPI：`POST /datasetQuery/execute`；LayoutVO.mobile

## [0.2.0] - 2026-08-03

### Added

- [P001](./proposals/P001-mobile-layout-c.md) 落地：独立移动端布局（6 列）+ 组件池勾选上板 + `styleSync` / 样式覆盖
- 规格 [`specs/v0.2.0-mobile-layout.md`](./specs/v0.2.0-mobile-layout.md)
- 高保：PC/移动画布切换、手机外框预览、列表「移动端」标识、`dash_sales` 移动种子布局

## [0.1.0] - 2026-07-01

### Added

- 初始规格集：商用 MVP Phase A/B/C、领域模型、API、取数架构、能力矩阵
- 高保原型 `dashboard-commercial.html`
