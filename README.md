# Open Dashboard

[![Vue](https://img.shields.io/badge/Vue-3-4FC08D?logo=vue.js&logoColor=white)](./open-dashboard-frontend/)
[![Spring Boot](https://img.shields.io/badge/Spring%20Boot-3-6DB33F?logo=springboot&logoColor=white)](./open-dashboard-backend/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](./open-dashboard-backend/)

> 开源、可嵌入的智能 BI 与数据分析底座：从数据库连接、数据集建模，到仪表盘、在线报告和对话分析，让可信数据真正成为可持续运营的业务资产。

Open Dashboard（产品名 **DataQ**）面向分析师、业务读者和报告作者。它把 **数据源 → 数据集 → 查询 → 仪表盘 / 报告** 串成一条完整链路：分析师可以接数、建模和编排内容，业务读者打开发布页即可查看、筛选和下载结果。

[产品介绍：DataQ × WorkBuddy](./.teamai/docs/proposals/P018-workbuddy-open-capabilities/req/dataq-workbuddy-introduction.html) · [快速开始](#快速开始) · [前端部署](./open-dashboard-frontend/deploy.md) · [后端部署](./open-dashboard-backend/deploy.md)

![Open Dashboard 已发布仪表盘](./open-dashboard-frontend/public/help/screenshots/07-dashboard-preview.png)

## 为什么是 Open Dashboard

- **完整的数据产品链**：数据库接入、数据集语义、受控查询、可视化编排和内容发布在一个产品内闭环。
- **面向业务的编辑体验**：通过网格画布、拖拽字段、PC / 移动端布局和模板快速完成专业看板。
- **仪表盘与报告并重**：既支持实时刷新、筛选联动的看板，也支持正文与 live 图结合的在线报告。
- **AI 能力建立在治理之上**：对话问数和生成看板复用同一数据集与查询链路，不绕开权限和业务口径。
- **适合嵌入现有系统**：身份由接入方提供，数据、查询和发布能力保持清晰边界。

## 产品体验

### 连接数据，建立统一语义

连接 MySQL / PostgreSQL，探查 Schema、表结构和样例数据；再把业务表整理为带维度、指标和计算字段的数据集。图表只绑定数据集，业务口径不散落在每一张图里。

| 数据源连接与探库 | 数据集字段与语义 |
|:---:|:---:|
| ![数据源连接与探库](./open-dashboard-frontend/public/help/screenshots/02-datasources.png) | ![数据集字段与语义](./open-dashboard-frontend/public/help/screenshots/03-datasets.png) |

### 编排、发布与分享仪表盘

在网格画布中组合查询控件、指标卡、图表、表格和文本，拖入维度与指标完成配置。编辑写入草稿，发布后生成稳定的只读视图；PC 与移动端可以分别编排布局。

| 可视化画布 | 发布后的业务看板 |
|:---:|:---:|
| ![可视化仪表盘编辑器](./open-dashboard-frontend/public/help/screenshots/06-dashboard-edit.png) | ![发布后的业务看板](./open-dashboard-frontend/public/help/screenshots/07-dashboard-preview.png) |

### 把数据写进报告，也带进对话

在线报告支持撰写正文、引用已有看板图和新建图表，并在预览与发布时实时取数。对话分析能力正在持续建设：用户可以从自然语言问题得到查询结果、图表与明细，并将确认后的结果保存为看板草稿。

| 在线报告编辑 | 对话问数与生成看板（在途） |
|:---:|:---:|
| ![在线报告编辑器](./open-dashboard-frontend/public/help/screenshots/08-report-edit.png) | ![对话问数与生成看板](./open-dashboard-frontend/public/help/screenshots/24-conversation-gen-board.png) |

## 产品结构

```text
数据源 → 数据集 → 受控查询 → 仪表盘 → 发布 / 分享
                         └→ 在线报告
                         └→ 对话分析（在途）
```

| 模块 | 面向谁 | 解决什么问题 |
|------|--------|--------------|
| 数据源 | 数据管理员、分析师 | 连接数据库，探库并预览表结构与样例数据 |
| 数据集 | 分析师 | 统一维度、指标、计算字段和查询入口 |
| 仪表盘 | 分析师、业务读者 | 编排图表与筛选，发布、分享和下载数据 |
| 在线报告 | 报告作者、管理者 | 在正文中引用实时图表，形成可发布的数据报告 |
| 对话分析 | 业务读者、分析师 | 用自然语言问数、查看证据并生成看板草稿（在途） |

更完整的产品关系、目标用户、能力边界和开放路径，见 [DataQ × WorkBuddy 产品介绍](./.teamai/docs/proposals/P018-workbuddy-open-capabilities/req/dataq-workbuddy-introduction.html)。该文档会明确区分已交付、在途和规划能力。

## 设计原则

1. **配置与取数分离** — 画布只存布局、字段绑定和样式；出数统一走 `POST /chartQuery/query`。
2. **看板只绑定数据集** — 图表不能直连数据源；业务数据一律经 `datasetQuery` 取出。
3. **草稿与发布分离** — 编辑写草稿；观看与分享只读已发布版本；移动端维护独立布局。
4. **身份可插拔，权限不绕过** — 登录由接入方提供，写操作由权限码约束。
5. **AI 不制造事实** — 对话能力必须复用受治理的数据链路；空结果与失败要如实呈现。

## 当前版本

**已交付基线（v0.3 / v0.4）**

- 数据库数据源与数据集建模
- 仪表盘编辑、查询、移动端布局、发布、分享与表格导出
- 在线报告编辑、引用看板图、报告内新建图和实时取数
- PostgreSQL + API + Web + 示例数据的一键 Docker 启动

**正在建设 / 尚未开放**

- 完整的对话问数与对话生成看板产品闭环
- 对话分析报告与过程工作区
- 内置完整 IAM、资源级权限、行列权限和知识治理
- WorkBuddy Connector / Skill 与跨产品授权

## 快速开始

一条命令拉起 **PostgreSQL + API + Web**，中间件、迁移和示例数据源均已打包：

```bash
git clone https://github.com/hugenshen/open-dashboard.git
cd open-dashboard
chmod +x scripts/*.sh
./scripts/up.sh
```

启动完成后访问：

- Web：http://127.0.0.1:8088
- API：http://127.0.0.1:8080/api

```bash
./scripts/smoke.sh    # 运行冒烟检查
./scripts/logs.sh     # 查看服务日志
./scripts/down.sh     # 停止服务（保留数据）
```

端口和密码见 [`.env.example`](./.env.example)。各服务的独立部署说明见 [前端 deploy](./open-dashboard-frontend/deploy.md) 与 [后端 deploy](./open-dashboard-backend/deploy.md)。

## 本地开发

本机 **5432** 若被占用，可使用 Homebrew PostgreSQL **5433**，或用 Docker 只启动数据库 **5434**。

```bash
# 数据库
./scripts/setup-pg-local.sh          # 或 ./scripts/setup-pg-docker.sh

# 后端
cd open-dashboard-backend
mvn -pl open-dashboard-start -am spring-boot:run \
  -Dspring-boot.run.arguments='--spring.profiles.active=local --server.port=8082'

# 前端（代理 /api → 8082，可用 OD_API_PROXY 覆盖）
cd ../open-dashboard-frontend
npm install
npm run dev
# → http://127.0.0.1:5173
```

无数据库联调可使用 `--spring.profiles.active=stub`，该模式只提供 API stub，不执行真实 JDBC 查询。

## 对话 Agent（可选）

对话问数、生成看板与分析报告由 [opendashboard-dsh-harness](./opendashboard-dsh-harness/README.md) 提供，需要单独启动 dsh 运行时并与后端联调。产品 Web 壳位于 `open-dashboard-frontend/src/conversation/`。

```bash
cd opendashboard-dsh-harness
pnpm install
pnpm approve-builds --all
./start.sh
```

## 仓库结构

```text
open-dashboard/
├── open-dashboard-frontend/      # Vue 3 产品应用
├── open-dashboard-backend/       # Spring Boot COLA 多模块
│   ├── open-dashboard-domain/
│   ├── open-dashboard-app/
│   ├── open-dashboard-infrastructure/
│   ├── open-dashboard-adapter/
│   └── open-dashboard-start/
├── opendashboard-dsh-harness/    # 对话 Agent（dsh）运行时
├── scripts/                      # 启停、冒烟与 PostgreSQL 初始化
└── .env.example
```

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Vue 3 · Vite · TypeScript · Pinia · Vue Router · ECharts |
| 后端 | JDK 21 · Spring Boot 3 · Spring JDBC · Flyway · COLA 多模块 |
| 数据库 | PostgreSQL 16 |
| Agent | [@deepseek-ai/dsh](https://www.npmjs.com/package/@deepseek-ai/dsh) + 本仓薄插件 |
