# Open Dashboard

开源的**仪表盘 / BI 画布**：Vue 3 + Spring Boot。对标飞书式编排与 Quick BI 式分析治理。

核心 **v0.3**：编辑器 + `chartQuery` / `datasetQuery` + 移动端布局。  
**v0.4**：在线报告（Umo）引用看板图 / 报告内新建图（实时取数）。

## 开箱即用（推荐）

一条命令拉起 **PostgreSQL + API + Web**（中间件、迁移、示例数据源均已打包）：

```bash
chmod +x scripts/*.sh
./scripts/up.sh
# 等价: make up
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

端口与密码见 `.env.example`；详细说明见 [docs/deploy.md](docs/deploy.md)。

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
npm run hi-fi
# → http://127.0.0.1:8765/dashboard-commercial.html
```

## 仓库结构

```
open-dashboard/
├── docs/                         # 产品 / 设计 / API / 部署 / 用户手册
├── prototypes/hi-fi/             # 静态高保参照
├── open-dashboard-frontend/      # Vue 3 产品应用
├── open-dashboard-backend/       # Spring Boot COLA 多模块
│   ├── open-dashboard-domain/
│   ├── open-dashboard-app/
│   ├── open-dashboard-infrastructure/
│   ├── open-dashboard-adapter/
│   └── open-dashboard-start/
├── scripts/                      # up / down / smoke / PG 初始化
├── docker-compose.yml
├── Makefile
└── .env.example
```

## 文档导读

完整索引：[docs/README.md](docs/README.md)。

| 文档 | 内容 |
|------|------|
| [docs/product/overview.md](docs/product/overview.md) | 产品定位与模块地图 |
| [docs/product/requirements.md](docs/product/requirements.md) | **已交付需求基线**（演进起点） |
| [docs/product/roadmap.md](docs/product/roadmap.md) | 后续演进 |
| [docs/design/frontend.md](docs/design/frontend.md) | 前端设计 |
| [docs/design/backend.md](docs/design/backend.md) | 后端设计 |
| [docs/design/auth.md](docs/design/auth.md) | 鉴权 SPI |
| [docs/api/rest.md](docs/api/rest.md) · [docs/openapi.yaml](docs/openapi.yaml) | REST |
| [docs/deploy.md](docs/deploy.md) | 部署与开箱 |
| [docs/user-manual/index.html](docs/user-manual/index.html) | 用户操作手册（在线 `/help/`，顶栏「帮助」） |

## 设计要点（摘要）

1. **配置与取数分离**：画布/encode 存库；出数走 `POST /chartQuery/query`。  
2. **datasetQuery 唯一触达数据源**：`QuerySpec` → `ResultTable`。  
3. **draft / published 双副本**；移动端独立 `mobile_json`。  
4. **鉴权可插拔**（Auth SPI + 权限码）；分享 Token 公开观看；资源 ACL / RLS 见路线图。
