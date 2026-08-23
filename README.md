# Open Dashboard

开源的**仪表盘 / BI 画布**：Vue 3 + Spring Boot。对标飞书式编排与 Quick BI 式分析治理。

核心 **v0.3**：编辑器 + `chartQuery` / `datasetQuery` + 移动端布局。  
**v0.4**：在线报告（Umo）引用看板图 / 报告内新建图（实时取数）。

## 开箱即用（推荐）

一条命令拉起 **PostgreSQL + API + Web**（中间件、迁移、示例数据源均已打包）：

```bash
chmod +x scripts/*.sh
./scripts/up.sh
```

完成后打开：

- Web：http://127.0.0.1:8088  
- API：http://127.0.0.1:8080/api  

自动完成：Flyway 建表、注册「元数据库」真实 JDBC 连接、示例数据集「数据源清单」。

```bash
./scripts/smoke.sh    # 冒烟
./scripts/logs.sh     # 日志
./scripts/down.sh     # 停止（保留数据）
```

端口与密码见 `.env.example`。各服务的 Docker / 本地运行：

- [后端](open-dashboard-backend/deploy.md)
- [前端](open-dashboard-frontend/deploy.md)
- [对话 Agent（dsh）](opendashboard-dsh-harness/README.md)

## 技术栈

见 [docs/tech-stack.md](docs/tech-stack.md)。

| 层 | 选择 |
|----|------|
| 前端 | Vue 3 · Vite · TypeScript · Pinia · Vue Router · ECharts |
| 后端 | JDK 21 · Spring Boot 3 · Spring JDBC · Flyway · COLA 多模块 |
| 数据库 | PostgreSQL 16 |

## 本地开发（可选）

本机 **5432** 若被占用，可用 Homebrew PG **5433** 或 Docker 仅起库 **5434**。

```bash
# 库
./scripts/setup-pg-local.sh          # 或 ./scripts/setup-pg-docker.sh

# 后端
cd open-dashboard-backend && mvn -pl open-dashboard-start -am spring-boot:run \
  -Dspring-boot.run.arguments='--spring.profiles.active=local --server.port=8082'

# 前端（代理 /api → 8082；可用 OD_API_PROXY 覆盖）
cd open-dashboard-frontend && npm install && npm run dev
# → http://127.0.0.1:5173
```

无库 stub：`--spring.profiles.active=stub`（仅 API 联调，无真实 JDBC）。

## 高保交互参照（非产品运行时）

```bash
./docs/prototypes/hi-fi/start.sh
# → http://127.0.0.1:8765/workbench.html
```

目录：`docs/prototypes/hi-fi/`（当前）· `docs/prototypes/snapshots/`（冻结）· [VERSIONS.md](docs/prototypes/VERSIONS.md)。

## 仓库结构

```
open-dashboard/
├── docs/                         # 产品 / 设计 / 用户手册 / 高保原型
│   └── prototypes/               # hi-fi（当前）+ snapshots（冻结）
├── open-dashboard-frontend/      # Vue 3 产品应用
├── open-dashboard-backend/       # Spring Boot COLA 多模块
│   ├── open-dashboard-domain/
│   ├── open-dashboard-app/
│   ├── open-dashboard-infrastructure/
│   ├── open-dashboard-adapter/
│   └── open-dashboard-start/
├── scripts/                      # up / down / smoke / PG 初始化
└── .env.example
```

## 文档导读

完整索引：[docs/README.md](docs/README.md)。

| 文档 | 内容 |
|------|------|
| [AGENTS.md](AGENTS.md) | 给 AI 的协作短地图（Cursor 只读仓库根这份） |
| [docs/product/README.md](docs/product/README.md) | 产品定位、用户、模块与边界 |
| [docs/product/requirements.md](docs/product/requirements.md) | **已交付需求基线**（演进起点） |
| [docs/product/roadmap/](docs/product/roadmap/) | 进度（进行中 / 已完成 / 计划中） |
| [docs/guide.html](docs/guide.html) | 规划 / BA / 开发 / 测试 / AI 怎么读、怎么迭代 |
| [docs/design/architecture.html](docs/design/architecture.html) | 4A 现行架构（业务 / 应用 / 数据 / 技术） |
| [docs/design/openapi.yaml](docs/design/openapi.yaml) | REST / OpenAPI 硬契约 |
| [docs/proposals/README.md](docs/proposals/README.md) | 未实现需求与详细设计 |
| [docs/process.md](docs/process.md) | 协作规范正文 |
| [open-dashboard-backend/deploy.md](open-dashboard-backend/deploy.md) | 后端本地运行与 Docker |
| [open-dashboard-frontend/deploy.md](open-dashboard-frontend/deploy.md) | 前端本地运行与 Docker |
| [opendashboard-dsh-harness/README.md](opendashboard-dsh-harness/README.md) | 对话 Agent（dsh）本地运行 |
| [docs/user-manual/index.html](docs/user-manual/index.html) | 终端用户手册（在线 `/help/`，顶栏「帮助」） |

## 设计要点（摘要）

1. **配置与取数分离**：画布/encode 存库；出数走 `POST /chartQuery/query`。  
2. **datasetQuery 唯一触达数据源**：`QuerySpec` → `ResultTable`。  
3. **draft / published 双副本**；移动端独立 `mobile_json`。  
4. **鉴权可插拔**（Auth SPI + 权限码）；分享 Token 公开观看；资源 ACL / RLS 见路线图。
