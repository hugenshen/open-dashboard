# Open Dashboard 部署指南

## 开箱即用（推荐）

本仓库已打包：PostgreSQL + 后端 API + 前端 Nginx。一条命令拉起全栈。

### 前置

- Docker（Docker Desktop 或 Colima：`colima start`）
- 约 2GB 空闲内存（首次构建会拉镜像并编译）

### 启动

```bash
chmod +x scripts/*.sh
./scripts/up.sh
# 或: make up
```

首次会自动复制 `.env.example` → `.env`。启动完成后：

| 入口 | 默认地址 |
|------|----------|
| Web UI | http://127.0.0.1:8088 |
| API | http://127.0.0.1:8080/api |
| Health | http://127.0.0.1:8080/actuator/health |
| Postgres | localhost:5434（user/db/password 见 `.env`） |

启动后后端会：

1. Flyway 自动建表 / 迁移
2. 若尚无数据源，自动注册「元数据库」（连 compose 内 Postgres）
3. 若尚无数据集，自动建示例数据集「数据源清单」（表 `de_datasource`）

### 冒烟

```bash
./scripts/smoke.sh
# 或: make smoke
```

### 日志 / 停止

```bash
./scripts/logs.sh              # 全部
./scripts/logs.sh backend      # 仅 API
./scripts/down.sh              # 停容器，保留数据卷
./scripts/down.sh --volumes    # 停并清空数据库
```

### 改端口 / 密码

编辑 `.env`（由 `.env.example` 复制）：

```bash
OD_WEB_PORT=8088
OD_API_PORT=8080
OD_PG_PORT=5434
POSTGRES_PASSWORD=opendashboard
OD_BOOTSTRAP_META_DATASOURCE=true
```

改完后 `./scripts/up.sh`（内部为 `docker-compose build && up -d`）。

关闭自动注册元库：`OD_BOOTSTRAP_META_DATASOURCE=false`。

> 说明：脚本优先使用 `docker-compose`，若无则回退到 `docker compose`。

## 仅数据库（本地开发 API / 前端）

见仓库根目录 README「本地开发」小节：

- `scripts/setup-pg-local.sh` — Homebrew PG @ 5433
- `scripts/setup-pg-docker.sh` — 仅起 Postgres 容器 @ 5434

## 生产注意

- 务必改 `POSTGRES_PASSWORD` 与 `opendashboard.datasource.crypto-key`
- 关闭 `opendashboard.auth.dev-fallback`（勿用演示用户）
- 通过反向代理终结 TLS；本 compose 默认 HTTP
- 数据持久化在 Docker volume `od_pg_data`
