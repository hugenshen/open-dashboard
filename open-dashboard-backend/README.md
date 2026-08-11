# Open Dashboard Backend

JDK 21 · Spring Boot 3 · PostgreSQL · Flyway · **COLA 多模块**

产品 API 入口。契约见 [`../docs/design/openapi.yaml`](../docs/design/openapi.yaml)。

模块：`open-dashboard-domain` / `app` / `infrastructure` / `adapter` / `start`

## 运行

```bash
# 仓库根目录（需 Docker Desktop 已启动）
docker-compose up -d

cd backend
mvn -pl open-dashboard-start -am spring-boot:run
```

本地库（5433）+ 指定端口：

```bash
cd backend
mvn -pl open-dashboard-start -am spring-boot:run \
  -Dspring-boot.run.arguments='--spring.profiles.active=local --server.port=8082'
```

无 PostgreSQL 时可用 stub 配置（不连库）：

```bash
cd backend
mvn -pl open-dashboard-start -am spring-boot:run \
  -Dspring-boot.run.arguments=--spring.profiles.active=stub
```

- Health: http://127.0.0.1:8080/actuator/health  
- Dashboard: `GET /api/dashboard/1`  
- Chart query: `POST /api/chartQuery/query`  
- Dataset query: `POST /api/datasetQuery/execute`  
- Report: `GET/POST /api/report` · `GET /api/report/{id}` · `PUT /api/report/{id}/doc` · `POST /api/report/{id}/publish`

## 目录说明（COLA）

```
backend/
├── pom.xml                         # parent
├── open-dashboard-domain/          # DTO + Gateway 接口 + context
├── open-dashboard-app/             # 应用服务（用例编排）
├── open-dashboard-infrastructure/  # Gateway 实现、JDBC、Flyway(由 start 带资源)
├── open-dashboard-adapter/         # REST + Security 适配
└── open-dashboard-start/           # 启动入口 + application*.yml + db/migration
```
