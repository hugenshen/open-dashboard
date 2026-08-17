# 已完成

用户已经能用。只追溯，不驱动新开发。现行行为见 [requirements.md](../../requirements.md)。

## P001 移动端布局

| | |
|--|--|
| 给谁 | 用手机打开已发布看板的业务读者；要给移动端单独排版的分析师 |
| 交付了什么 | 独立移动画布（与 PC 坐标分离），可勾选上板、样式跟 PC 或分设 |
| 范围外 | 原生 App；移动端上再造一套取数 |
| 里程碑 | v0.2 |
| 证据 | PR-DASH-11 · [提案](../../../proposals/P001-mobile-layout-c/) |

## P002 工程脚手架

| | |
|--|--|
| 给谁 | 接入方与研发：把高保交互做成可运行、可部署的产品 |
| 交付了什么 | Vue 3 + Spring Boot + PostgreSQL 开箱；编辑器与 `chartQuery` / `datasetQuery` 真链路 |
| 范围外 | 一次搬完所有高保业务逻辑 |
| 里程碑 | v0.3 |
| 证据 | NFR-05 · [提案](../../../proposals/P002-vue-java-scaffold/) |

## P003 在线报告

| | |
|--|--|
| 给谁 | 报告作者：在正文里插图或新建图；读者打开报告看到的是现数 |
| 交付了什么 | Umo 报告里引用看板图 / 报告内新建图，预览与阅读都走实时 `chartQuery` |
| 范围外 | 导出 Word/PDF、报告独立授权（后者见进行中 [P008](../../../proposals/P008-permission-aware-workbench/)） |
| 里程碑 | v0.4 |
| 证据 | PR-RPT-01…07 · [提案](../../../proposals/P003-report-umo-charts/) |
