# 后端部署与本地运行

本目录是产品 API。契约见 [`../.teamai/docs/design/openapi.yaml`](../.teamai/docs/design/openapi.yaml)。

- `Dockerfile`：容器内 Maven 构建
- `Dockerfile.runtime`：宿主机先打 JAR
- `docker-compose.yml`：Postgres + API
- `docker-compose.runtime.yml`：用已打好的 JAR，跳过镜像内 Maven

整栈（再加前端）用仓库根 `./scripts/up.sh`。

## 本地运行

需 JDK 21。配置库默认连本机 PostgreSQL。

```bash
# 仓库根：仅起库（本机 5432 占用时用 5433 / 5434）
./scripts/setup-pg-local.sh          # 或 ./scripts/setup-pg-docker.sh

cd open-dashboard-backend
mvn -pl open-dashboard-start -am spring-boot:run \
  -Dspring-boot.run.arguments='--spring.profiles.active=local --server.port=8082'
```

无库、只联调 API：

```bash
mvn -pl open-dashboard-start -am spring-boot:run \
  -Dspring-boot.run.arguments=--spring.profiles.active=stub
```

- Health：http://127.0.0.1:8082/actuator/health（compose 内为 8080）
- 入口：`/api/dashboard` · `/api/chartQuery/query` · `/api/datasetQuery/execute` · `/api/report`

## Docker

只起本服务（Postgres + API）：

```bash
cd open-dashboard-backend
docker compose --project-directory .. -f docker-compose.yml up --build
```

数据源要连**宿主机**上的库时，Host 填 `host.docker.internal`，不要填 `127.0.0.1`。

宿主机已打好 JAR、跳过镜像内 Maven：

```bash
mvn -pl open-dashboard-start -am -DskipTests package
docker compose --project-directory .. \
  -f docker-compose.yml -f docker-compose.runtime.yml up --build
```

`Dockerfile.runtime` 需要 `open-dashboard-start/target/open-dashboard-start-*.jar`。

## 生产注意

- 改 `POSTGRES_PASSWORD` 与 `opendashboard.datasource.crypto-key`
- 关闭 `opendashboard.auth.dev-fallback`
- TLS 由反向代理终结；compose 默认 HTTP
- 元库数据在 volume `od_pg_data`
