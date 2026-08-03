# Open Dashboard

开源的**仪表盘 / BI 画布**：Vue 3 + Spring Boot 产品脚手架，附高保交互参照、领域模型、OpenAPI 与取数架构。

对标飞书式编排体验与 Quick BI 式分析治理。核心版本 **v0.3**：编辑器 + `chartQuery` / `datasetQuery` + 移动端布局工程化。  
**v0.4**：在线报告（Umo）引用看板图 / 报告内新建图（实时取数）。

## 技术栈（已锁定）

见 [docs/tech-stack.md](docs/tech-stack.md)。

| 层 | 选择 |
|----|------|
| 前端 | Vue 3 · Vite · TypeScript · Pinia · Vue Router · ECharts |
| 后端 | JDK 21 · Spring Boot 3 · Spring JDBC · Flyway |
| 数据库 | PostgreSQL 16 |

## 快速启动（产品脚手架）

```bash
# 1) PostgreSQL（需 Docker Desktop 已运行）
docker-compose up -d

# 2) 后端
cd backend && mvn spring-boot:run

# 无库时可：
# mvn spring-boot:run -Dspring-boot.run.arguments=--spring.profiles.active=stub

# 3) 前端（另开终端）
cd frontend && npm install && npm run dev
# → http://127.0.0.1:5173
# 报告：http://127.0.0.1:5173/reports
```

API 健康检查：http://127.0.0.1:8080/actuator/health

## 高保交互参照（非产品运行时）

完整编辑 / 绑定 / 图表 / 透视 / 移动端交互骨架：

```bash
npm install   # 仓库根，仅需 tsx 等可选
npm run hi-fi
# → http://127.0.0.1:8765/dashboard-commercial.html
```

或：

```bash
cd prototypes/hi-fi && ./start.sh
```

## 仓库结构

```
open-dashboard/
├── docs/                      # 需求 / 规格 / 架构 / OpenAPI
│   ├── tech-stack.md
│   ├── requirements/v0.3.0-core.md
│   └── specs/v0.3.0-core.md
├── prototypes/hi-fi/          # 静态高保参照（视觉与交互）
├── frontend/                  # Vue3 产品应用
├── backend/                   # Spring Boot 产品应用
│   ├── src/main/java/io/opendashboard/
│   └── demo|manage|store/     # 旧 TS 垂直切片（reference only）
├── docker-compose.yml
└── package.json               # hi-fi / 旧 slice 脚本
```

## 文档导读

| 文档 | 内容 |
|------|------|
| [docs/tech-stack.md](docs/tech-stack.md) | 技术选型锁定 |
| [docs/requirements/v0.3.0-core.md](docs/requirements/v0.3.0-core.md) | 窄范围需求 |
| [docs/specs/v0.3.0-core.md](docs/specs/v0.3.0-core.md) | 设计规格 |
| [docs/specs/v0.4.0-report-umo-charts.md](docs/specs/v0.4.0-report-umo-charts.md) | 在线报告 Umo 插图 |
| [docs/data-query-architecture.md](docs/data-query-architecture.md) | 取数两层协议 |
| [docs/openapi.yaml](docs/openapi.yaml) | REST 契约 |
| [docs/VERSIONING.md](docs/VERSIONING.md) | 文档版本规范 |
| [prototypes/hi-fi/README-分享.md](prototypes/hi-fi/README-分享.md) | 高保打包分享 |

## 旧 TypeScript 垂直切片（参照）

```bash
npm run slice
npm run slice:commercial
```

行为对照用，**不是**产品入口。产品后端见 `backend/src/main/java`。

## 设计要点（摘要）

1. **配置与取数分离**：画布/encode 存库；出数走 `POST /chartQuery/query`。  
2. **datasetQuery 唯一触达数据源**：`QuerySpec` → `ResultTable`。  
3. **draft / published 双副本**；移动端独立 `mobile_json`（6 列 + styleSync）。  
4. **权限三道闸**：仪表盘 ACL → 数据集 USE → RLS/CLS（脚手架可 stub）。
