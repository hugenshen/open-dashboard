# Open Dashboard

[![Vue](https://img.shields.io/badge/Vue-3-4FC08D?logo=vue.js&logoColor=white)](./open-dashboard-frontend/)
[![Spring Boot](https://img.shields.io/badge/Spring%20Boot-3-6DB33F?logo=springboot&logoColor=white)](./open-dashboard-backend/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](./open-dashboard-backend/)

> 开源的 **BI 仪表盘 / 分析画布**：分析师接数、建模、编排看板与报告；业务读者打开分享链接即可观看。

Open Dashboard（内部产品名 **DataQ**）是一套可嵌入、可开箱运行的数据分析产品骨架。它把 **数据源 → 数据集 → 仪表盘 / 报告** 串成清晰流水线，编排体验接近飞书式排版，治理语义对齐 Quick BI 式「配置与取数分离」——看板只描述「看什么」，样式不进查询，业务数据一律经数据集取出。

---

## 目录

- [Open Dashboard](#open-dashboard)
  - [目录](#目录)
  - [它能做什么](#它能做什么)
  - [给谁用](#给谁用)
  - [产品结构](#产品结构)
  - [设计原则](#设计原则)
  - [当前版本能力](#当前版本能力)
  - [快速开始](#快速开始)
  - [本地开发](#本地开发)
  - [仓库结构](#仓库结构)
  - [技术栈](#技术栈)
  - [对话 Agent（可选）](#对话-agent可选)

## 它能做什么

| 能力 | 说明 |
|------|------|
| **数据接入** | 连接 MySQL / PostgreSQL，探库、预览表结构与样例数据 |
| **语义建模** | 在数据集上定义维度、指标与计算字段，统一取数入口 |
| **仪表盘编排** | 网格画布编辑、模板创建、PC / 移动端独立布局、发布与分享 |
| **在线报告** | 撰写正文，引用看板图或在报告内新建图，实时取数后发布 |
| **分享观看** | 无编辑壳的只读看板，支持导出表格 |
| **对话问数** | 基于 dsh 的对话 Agent 运行时（进行中，见 [dsh harness](./opendashboard-dsh-harness/README.md)） |

## 给谁用

| 角色 | 典型场景 |
|------|----------|
| **分析师** | 连接数据、建数据集、用模板或空白画布做看板、发布与分享 |
| **业务读者** | 打开分享链接只读观看已发布看板，需要时导出表格 |
| **报告作者** | 在线撰写正文，插入看板图或在报告里新建图，取数后发布 |
| **接入方** | 用企业现有身份接入，不强制自带完整账号中心 |

## 产品结构

```text
工作台 → 数据源 → 数据集 → 仪表盘 / 在线报告 → 分享观看
```

| 模块 | 做什么 |
|------|--------|
| 工作台 | 进入各模块、看资源与待办 |
| 数据源 | 连接业务库、探库、预览表 |
| 数据集 | 选表、定义维度/指标与计算字段、预览 |
| 仪表盘 | 文件夹管理、模板、编辑、发布、联动、分享 |
| 在线报告 | 写正文、插图或新建图、发布 |
| 分享观看 | 无编辑壳的只读看板 |

## 设计原则

1. **配置与取数分离** — 画布只存布局、字段绑定和样式；出数走 `POST /chartQuery/query`。
2. **看板只绑数据集** — 图表不能直连数据源；业务数据一律经 `datasetQuery` 取出。
3. **草稿 / 已发布** — 编辑写草稿；观看与分享只读已发布版本；移动端独立 `mobile_json`。
4. **可嵌入、鉴权可插拔** — 写操作靠权限码；登录由接入方提供（Auth SPI）。

## 当前版本能力

**已交付（v0.3 / v0.4）**

- 编辑器 + `chartQuery` / `datasetQuery` + 移动端布局
- 在线报告（Umo）引用看板图 / 报告内新建图（实时取数）
- Docker 一条命令开箱：PostgreSQL + API + Web + 示例数据源

**明确未做 / 进行中**

- 内置完整 IAM、资源级权限、行列权限 — 见路线图
- 对话问数 / 对话生成看板 — 开发中，尚未对业务验收开放

---

## 快速开始

一条命令拉起 **PostgreSQL + API + Web**（中间件、迁移、示例数据源均已打包）：

```bash
chmod +x scripts/*.sh
./scripts/up.sh
```

完成后打开：

- **Web**：http://127.0.0.1:8088
- **API**：http://127.0.0.1:8080/api

常用脚本：

```bash
./scripts/smoke.sh    # 冒烟
./scripts/logs.sh     # 日志
./scripts/down.sh     # 停止（保留数据）
```

端口与密码见 [`.env.example`](./.env.example)。各服务单独部署说明：

- [后端 deploy](./open-dashboard-backend/deploy.md)
- [前端 deploy](./open-dashboard-frontend/deploy.md)

## 本地开发

本机 **5432** 若被占用，可用 Homebrew PG **5433** 或 Docker 仅起库 **5434**。

```bash
# 数据库
./scripts/setup-pg-local.sh          # 或 ./scripts/setup-pg-docker.sh

# 后端
cd open-dashboard-backend && mvn -pl open-dashboard-start -am spring-boot:run \
  -Dspring-boot.run.arguments='--spring.profiles.active=local --server.port=8082'

# 前端（代理 /api → 8082；可用 OD_API_PROXY 覆盖）
cd open-dashboard-frontend && npm install && npm run dev
# → http://127.0.0.1:5173
```

无库 stub：`--spring.profiles.active=stub`（仅 API 联调，无真实 JDBC）。

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
├── scripts/                      # up / down / smoke / PG 初始化
└── .env.example
```

## 技术栈

| 层 | 选择 |
|----|------|
| 前端 | Vue 3 · Vite · TypeScript · Pinia · Vue Router · ECharts |
| 后端 | JDK 21 · Spring Boot 3 · Spring JDBC · Flyway · COLA 多模块 |
| 数据库 | PostgreSQL 16 |
| Agent | [@deepseek-ai/dsh](https://www.npmjs.com/package/@deepseek-ai/dsh) + 本仓薄插件 |

## 对话 Agent（可选）

对话问数与生成看板能力由 [opendashboard-dsh-harness](./opendashboard-dsh-harness/README.md) 提供，需单独启动 dsh 运行时并与后端联调。产品 Web 壳在 `open-dashboard-frontend/src/conversation/`。

```bash
cd opendashboard-dsh-harness && pnpm install && pnpm approve-builds --all && ./start.sh
```
