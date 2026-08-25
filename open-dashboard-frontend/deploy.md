# 前端部署与本地运行

本目录是 Vue 3 产品应用。交互参照：[`../.teamai/docs/prototypes/hi-fi/start.sh`](../.teamai/docs/prototypes/hi-fi/start.sh)。

- `Dockerfile`：容器内 npm build + Nginx（build context 为仓库根，以便打进 `.teamai/docs/user-manual`）
- `Dockerfile.runtime`：宿主机先 `npm run build`
- `docker-compose.yml`：Nginx Web，依赖后端服务名 `backend`
- `docker-compose.runtime.yml`：用已有 `dist/`，跳过镜像内 Node
- `nginx.conf`：`/api/` 反代后端，`/help/` 用户手册

整栈用仓库根 `./scripts/up.sh`。

## 本地运行

```bash
cd open-dashboard-frontend
npm install
npm run dev
# → http://127.0.0.1:5173
```

`/api` 默认代理到 `http://127.0.0.1:8082`（可用环境变量 `OD_API_PROXY` 覆盖）。请同时启动后端，见 [`../open-dashboard-backend/deploy.md`](../open-dashboard-backend/deploy.md)。

## Docker

需要与后端 compose 一起起（本文件 `depends_on: backend`）：

```bash
# 仓库根
docker compose --project-directory . \
  -f open-dashboard-backend/docker-compose.yml \
  -f open-dashboard-frontend/docker-compose.yml \
  up --build
```

宿主机已构建 dist、跳过镜像内 Node：

```bash
npm run build
docker compose --project-directory .. \
  -f ../open-dashboard-backend/docker-compose.yml \
  -f docker-compose.yml -f docker-compose.runtime.yml \
  up --build
```

在本目录执行时 `--project-directory ..` 指向仓库根（读 `.env`）。`Dockerfile.runtime` 需要本目录下的 `dist/` 与 `nginx.conf`。
