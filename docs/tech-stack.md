# 技术选型（v0.3 锁定）

> 状态：accepted · 日期：2026-08-03  
> 关联：[requirements/v0.3.0-core.md](./requirements/v0.3.0-core.md) · [specs/v0.3.0-core.md](./specs/v0.3.0-core.md)

本页为 **核心版本不可再摇摆** 的技术选择。变更须走提案（`docs/proposals/`）。

## 前端

| 项 | 选择 |
|----|------|
| 框架 | Vue 3（Composition API + `<script setup>`） |
| 构建 | Vite |
| 语言 | TypeScript |
| 状态 | Pinia |
| 路由 | Vue Router |
| 图表 | ECharts |
| 表格 | 轻量自研 / 原生表格优先；透视 S2 **不**作为本期硬依赖 |

产品入口：`frontend/`（Vite 应用）。  
交互参照：`prototypes/hi-fi/`（静态高保，非运行时）。

## 后端

| 项 | 选择 |
|----|------|
| 语言 / 运行时 | **JDK 21** |
| 框架 | **Spring Boot 3.3+**（Web、Validation、Actuator） |
| 持久化 | **Spring JDBC + 手写 Repository**（薄层，对齐 schema） |
| 迁移 | Flyway |
| 包名 | `io.opendashboard` |
| API | REST；契约源 [`openapi.yaml`](./openapi.yaml) |

配置 CRUD 与取数分层见 [backend-architecture.md](./backend-architecture.md)、[data-query-architecture.md](./data-query-architecture.md)。

## 数据库

| 项 | 选择 |
|----|------|
| 引擎 | **PostgreSQL 16** |
| 配置库 | 仪表盘树 / 布局 / 组件 / 图表 / 联动 / ACL / 分享 |
| JSON | 配置类字段用 `JSONB`；移动端布局：`de_dashboard_layout.mobile_json` |
| 业务库 | 与配置库逻辑分离；本期可同一实例、不同 schema（`config` / 后续 `engine`） |

## 取数协议（契约层）

| 接口 | 职责 |
|------|------|
| `POST /chartQuery/query` | 看板运行时：读图配置 + context → 编译 QuerySpec → 塑形 |
| `POST /datasetQuery/execute` | **唯一**触达数据源的查询入口：QuerySpec → ResultTable |

风格 / 高级配置 **永不**进入 SQL。

## 明确不选（本期）

- 单页 HTML 作为产品运行时
- DataEase 式「整份 ChartViewDTO = getData」
- MyBatis-Plus / JPA 重 ORM（可后议，非默认）
- 原生 App、完整工作台 / 数据源管理 UI（见 requirements Out of scope）

## 本地依赖

- Node.js 20+（前端与根目录 hi-fi / 旧 TS slice）
- JDK 21、Maven 3.9+
- Docker（PostgreSQL via `docker-compose.yml`）
