# 技术选型（锁定）

> 状态：accepted · 随 v0.3/v0.4 实现冻结  
> 变更须更新本文，并同步 [product/roadmap.md](./product/roadmap.md)

## 前端

| 项 | 选择 |
|----|------|
| 框架 | Vue 3（Composition API + `<script setup>`） |
| 构建 | Vite |
| 语言 | TypeScript |
| 状态 | Pinia |
| 路由 | Vue Router |
| 图表 | ECharts |
| 报告 | `@umoteam/editor`（Tiptap） |
| 表格 | 轻量自研 / 原生表格；透视 S2 **非**硬依赖 |

产品入口：`frontend/`。交互参照：`prototypes/hi-fi/`（非运行时）。

## 后端

| 项 | 选择 |
|----|------|
| 语言 / 运行时 | **JDK 21** |
| 框架 | **Spring Boot 3.3+**（Web、Validation、Actuator） |
| 持久化 | **Spring JDBC + 手写 Repository** |
| 迁移 | Flyway |
| 架构 | COLA 多模块（domain / app / infrastructure / adapter / start） |
| 包名 | `io.opendashboard` |
| API | REST；契约 [`openapi.yaml`](./openapi.yaml) |

详见 [design/backend.md](./design/backend.md)、[design/data-query.md](./design/data-query.md)。

## 数据库

| 项 | 选择 |
|----|------|
| 引擎 | **PostgreSQL 16** |
| 配置库 | 看板 / 数据源 / 数据集 / 报告 / 分享 |
| JSON | 配置类字段用 `JSONB`；移动端：`mobile_json` |
| 业务库 | 经 Dataset JDBC 访问；可与配置库同实例 |

## 取数协议

| 接口 | 职责 |
|------|------|
| `POST /chartQuery/query` | 看板 / 报告运行时取数 |
| `POST /datasetQuery/execute` | **唯一**触达数据源的通用查询入口 |

风格 / 高级展示配置 **永不**进入 SQL。

## 明确不选

- 单页 HTML 作为产品运行时  
- DataEase 式「整份 ChartViewDTO = getData」路径拷贝  
- MyBatis-Plus / JPA 作为默认 ORM  
- 内置登录页 / 绑定单一 OAuth 实现（用 Auth SPI）  

## 本地依赖

- Node.js 20+  
- JDK 21、Maven 3.9+  
- Docker（推荐一键：`./scripts/up.sh`）
