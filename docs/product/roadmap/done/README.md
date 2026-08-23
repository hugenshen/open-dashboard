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

## P012 对话出板 / 问数质量闸

| | |
|--|--|
| 给谁 | 用对话一句话出板 / 问数的分析师：板要能读，问数不造假行 |
| 交付了什么 | Java last-resort 去业务词典；出板 `od_generate_board` 内置 review+layout + Goal 规划（LLM/降级）；问数 schema 加厚与 0 行 insight；主写路径不再依赖模型拼 `od_emit_patch` |
| 范围外 | sqlglot / 问数完整 ECharts（原 M3）；对话改图循环与斜杠菜单个案；Eval E0.2+ 真连 BI |
| 里程碑 | v0.6 |
| 证据 | PR-QG-02…05 · PR-QG-09…12 · [提案](../../../proposals/P012-ask-gen-quality/) · [architecture 问数/生成](../../../design/architecture.html#ask) |

## P011 对话表面迁到 DeepSeek Harness Web

| | |
|--|--|
| 给谁 | 用自然语言问数、生成看板的分析师 |
| 交付了什么 | 对话主表面 = dsh Web+Agent（`opendashboard-dsh-harness`）；问数表/图 Node；写板表面已由 [P012](../../../proposals/P012-ask-gen-quality/) 收成 `od_generate_board`；删 Python harness |
| 范围外 | 替换仪表盘编辑器 / 数据集管理；vendor 整仓 dsh 源码 |
| 里程碑 | v0.6 |
| 证据 | PR-DSH-02…06 · PR-DSH-09 · [提案](../../../proposals/P011-dsh-conversation-surface/) · [architecture 问数/生成](../../../design/architecture.html#ask) |
