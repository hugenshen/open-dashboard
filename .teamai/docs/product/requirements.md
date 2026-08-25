# 产品需求（现状基线）

> **状态**：as-built（与已验收能力对齐）· 日期：2026-08-23  
> 本文只登记「当前已交付」的产品需求。产品是什么见 [README.md](./README.md)，下一步见 [roadmap/README.md](./roadmap/README.md)。

## 追溯映射

这里只登记已交付能力。完整 `Pxxx ↔ architecture ↔ implementation ↔ PR-*` 映射见
[`../proposals/README.md`](../proposals/README.md)。

| 已交付需求 | 来源提案 | 现行架构 |
|------------|----------|----------|
| PR-DASH-11 | [P001](../proposals/P001-mobile-layout-c/) | [AA](../design/architecture.html#application) · [DA](../design/architecture.html#data) |
| NFR-05 | [P002](../proposals/P002-vue-java-scaffold/) | [4A](../design/architecture.html) |
| PR-RPT-01…07 | [P003](../proposals/P003-report-umo-charts/) | [BA](../design/architecture.html#business) · [AA](../design/architecture.html#application) |
| PR-DSH-02…06 · PR-DSH-09 | [P011](../proposals/P011-dsh-conversation-surface/) | [问数](../design/architecture.html#ask) · [生成](../design/architecture.html#gen) |
| PR-QG-02…05 · PR-QG-09…12 | [P012](../proposals/P012-ask-gen-quality/) | [问数](../design/architecture.html#ask) · [生成](../design/architecture.html#gen) |

---

## 1. 目标

提供可开箱运行的 BI 画布产品，覆盖：

1. 数据接入（数据源）与语义建模（数据集）  
2. 仪表盘编排、取数、发布、分享  
3. 在线报告撰写与插图实时取数  

---

## 2. 功能需求

### 2.1 工作台

| ID | 需求 | 验收要点 |
|----|------|----------|
| PR-WB-01 | 提供模块化入口与四步流水线引导 | 顶栏：工作台 / 数据源 / 数据集 / 仪表盘 / 报告 |
| PR-WB-02 | 展示资源概览与最近看板 | 可跳转至对应模块 |

### 2.2 数据源

| ID | 需求 | 验收要点 |
|----|------|----------|
| PR-DS-01 | CRUD JDBC 数据源（MySQL / PostgreSQL） | `GET/POST/PATCH/DELETE /api/datasource` |
| PR-DS-02 | 未保存探库与已保存连通性检测 | `POST /probe`、`POST /{id}/ping` |
| PR-DS-03 | 浏览库 / schema / 表 / 列 | 元数据只读 API |
| PR-DS-04 | 表数据预览 | `POST /{id}/preview` |
| PR-DS-05 | Docker 开箱自动注册「元数据库」 | `MetaDatasourceBootstrap`；示例连配置库 |

权限：读需登录；写需 `datasource:manage`。

### 2.3 数据集

| ID | 需求 | 验收要点 |
|----|------|----------|
| PR-SET-01 | CRUD 数据集（绑定数据源 + 表） | `/api/dataset` |
| PR-SET-02 | 字段银行：维度 / 指标语义、可编辑 | `PUT /{id}/fields` |
| PR-SET-03 | 计算字段（expression） | 字段带 expression 持久化 |
| PR-SET-04 | 预览取数 | `POST /{id}/preview`；底层走 QuerySpec |
| PR-SET-05 | 血缘 / 关联视图（UI） | 数据集详情 tab 可查看来源 |

权限：写需 `dataset:manage`。

### 2.4 仪表盘 — 资源树与生命周期

| ID | 需求 | 验收要点 |
|----|------|----------|
| PR-DASH-01 | 文件夹树 CRUD / 重命名 / 移动 / 删除 | `/api/dashboardTree/*` |
| PR-DASH-02 | 侧栏摘要 | `GET .../barInfo/{id}` |
| PR-DASH-03 | 从模板创建（blank / sales / ops / finance） | `create` 带 `templateId`；模板列表 API |
| PR-DASH-04 | 发布状态：`draft` / `published` / `publishedWithDraft` | `GET .../status` |
| PR-DASH-05 | 发布 / 丢弃草稿 | `publish` / `discardDraft`；双副本 |

### 2.5 仪表盘 — 编辑器与取数

| ID | 需求 | 验收要点 |
|----|------|----------|
| PR-DASH-06 | PC 网格画布：增删、拖放、缩放组件 | 读写 draft components |
| PR-DASH-07 | 图表绑定 dataset + encode（与 style/senior 分离） | `PUT .../charts/{chartId}` |
| PR-DASH-08 | 布局 / 组件批量保存 | `PUT .../layout`、`PUT .../components` |
| PR-DASH-09 | 单图刷新取数 | `POST /api/chartQuery/query`；filters / linkages 进 context |
| PR-DASH-10 | 图间联动配置 | `GET/PUT .../linkages`；运行时前端拼 context |
| PR-DASH-11 | 移动端独立布局（6 列） | `mobile_json`；PC/移动画布切换；styleSync |
| PR-DASH-12 | 预览 draft / published | `/dashboards/:id/preview` |
| PR-DASH-13 | 图表 CSV 导出 | `POST /api/chartQuery/export` |

图表类型基线：柱 / 条 / 线 / 面 / 饼 / KPI / 表（ECharts）。

交互参照：`.teamai/docs/prototypes/hi-fi/dashboard-commercial.html`；产品编辑器经 `frontend/src/dashboard/hifi/` host 挂载高保内核。

### 2.6 分享

| ID | 需求 | 验收要点 |
|----|------|----------|
| PR-SHARE-01 | 创建 / 查询分享 Token | `POST/GET /api/dashboard/{id}/share` |
| PR-SHARE-02 | 公开观看已发布看板 | `GET /api/share/{token}`；页 `/share/:token` 无壳 |
| PR-SHARE-03 | Token 下取数与 CSV 导出 | `POST .../chartQuery`、`.../export`；强制 published |

说明：过期时间有校验；密码分享未完整实现（见 roadmap）。

### 2.7 在线报告

| ID | 需求 | 验收要点 |
|----|------|----------|
| PR-RPT-01 | 报告列表 / 创建 / 元数据更新 | `/api/report` |
| PR-RPT-02 | 文档保存（content + contentId） | `PUT /{id}/doc`；冲突 409 |
| PR-RPT-03 | 发布 | `POST /{id}/publish` |
| PR-RPT-04 | 引用仪表盘图表插入正文 | Catalog API + Umo `reportChart` 节点 |
| PR-RPT-05 | 报告内新建图（不写回看板） | 向导选数据集 + encode；inline chartQuery |
| PR-RPT-06 | 阅读 / 编辑预览实时取数 | 文档只存配置，不存结果行 |
| PR-RPT-07 | 插图目录 | `GET /api/catalog`（看板图 + 数据集字段） |

编辑器：`@umoteam/editor`（Tiptap）。路由：`/reports`、`/reports/:id/edit`、`/reports/:id/preview`。

### 2.8 鉴权与菜单

| ID | 需求 | 验收要点 |
|----|------|----------|
| PR-AUTH-01 | 可插拔身份解析，无登录页 | `AuthProvider`；默认 Header + 开发 fallback |
| PR-AUTH-02 | 写操作权限码 | `dashboard:manage` / `datasource:manage` / `dataset:manage` / `report:manage` |
| PR-AUTH-03 | 当前用户与菜单 | `GET /api/auth/me`、`/api/auth/menus` |
| PR-AUTH-04 | 分享接口可匿名 | `/api/share/**` 无类级鉴权 |

### 2.9 对话（DeepSeek Harness 表面）

| ID | 需求 | 验收要点 |
|----|------|----------|
| PR-DSH-02 | OD 壳「对话」打开 dsh Web | `/conversations` → `ConversationDshSurface`；Vite `/dsh` → :3090 |
| PR-DSH-03 | 问数出表（Conversation Node） | `od_run_query` → `odKind=answer_table` |
| PR-DSH-04 | 问数出临时图；浏览器无裸 SQL | `od_run_sql` + TS sql-guard；`answer_chart` |
| PR-DSH-05 | 一句话生成看板 | 主路径 `od_generate_board` → Java `apply-patch`（[P012](../proposals/P012-ask-gen-quality/)）；`od_emit_patch` 仅兼容/DEPRECATED；右侧编辑器可打开 draft |
| PR-DSH-06 | 默认禁用 bash / 任意写盘工具 | `cordis.patch.yml` 裁剪 |
| PR-DSH-09 | 无 Python Agent sidecar | 仓内仅 `opendashboard-dsh-harness/` |

来源：[P011](../proposals/P011-dsh-conversation-surface/) · 架构 [问数](../design/architecture.html#ask) / [生成](../design/architecture.html#gen)。写板质量与问数加厚见 §2.10。

### 2.10 对话出板 / 问数质量闸

| ID | 需求 | 验收要点 |
|----|------|----------|
| PR-QG-02 | 出板主题句影响选维 / 度量 | `/board` 的 `message` 进入 `od_plan_charts` / `od_generate_board` 规划加权 |
| PR-QG-03 | 生成稿去掉碎饼与毛线 | 同维柱+饼不同时保留；高基数饼降级；无日/月桶的裸时间戳折线不落稿 |
| PR-QG-04 | 布局无半行空洞；查询条不填假区间 | 对比最多并排 2；单张对比/折线全宽；日期默认仅来自 profile min/max |
| PR-QG-05 | KPI 与金额单位可读 | 无「订单」语义时不用「订单数」；label 含「单位分」带分→元 formatter |
| PR-QG-09 | last-resort 无业务词典 | Java 规划/角色只认 schema · profile · 用户原文与字段名/label 重叠 |
| PR-QG-10 | 问数 schema 加厚 | `od_get_schema` 含 sample(≤3) / confirmed terms / few-shot questions |
| PR-QG-11 | 空结果诚实；失败不造假行 | 0 行带 insight；无华东/华北 stub；list 失败 fail-closed |
| PR-QG-12 | 出板 Goal 规划主路径 | LLM（或降级规则）产出 goals → bind 闸 → 确认后再 `od_generate_board` |

来源：[P012](../proposals/P012-ask-gen-quality/) · 架构 [问数](../design/architecture.html#ask) / [生成](../design/architecture.html#gen)。不在基线：sqlglot AST、问数完整 ECharts 预览（原 M3）、对话改图循环与斜杠菜单个案。

---

## 3. 非功能需求

| ID | 需求 |
|----|------|
| NFR-01 | 配置层禁止直查业务库；取数仅经 Dataset |
| NFR-02 | JSON 中 ID 为 string |
| NFR-03 | 契约以 `.teamai/docs/design/openapi.yaml` + 本文为准；实现差异须在设计文档标明 |
| NFR-04 | 支持 `stub`（无库联调）与真实 JDBC（docker / local）两种运行时 |
| NFR-05 | 一键部署：`./scripts/up.sh` 拉起 PG + API + Web |

---

## 4. Out of scope（当前版本不做）

详见 [roadmap.md](./roadmap.md)。摘要：

- 内置登录 / OAuth  
- 资源级 ACL、RLS/CLS 引擎  
- 跳转、告警、嵌入、`explainSql`、PNG 导出  
- 原生 App、数据大屏 free 布局深化  
- 把高保 HTML 业务逻辑一次性重写为纯 Vue 组件
