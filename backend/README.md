# Open Dashboard Backend

JDK 21 · Spring Boot 3 · PostgreSQL · Flyway

产品 API 入口。契约见 [`../docs/openapi.yaml`](../docs/openapi.yaml)。

## 运行

```bash
# 仓库根目录（需 Docker Desktop 已启动）
docker-compose up -d

cd backend
mvn spring-boot:run
```

无 PostgreSQL 时可用 stub 配置（不连库）：

```bash
cd backend
mvn spring-boot:run -Dspring-boot.run.arguments=--spring.profiles.active=stub
```

- Health: http://127.0.0.1:8080/actuator/health  
- Dashboard: `GET /api/dashboard/1`  
- Chart query: `POST /api/chartQuery/query`（支持纯 `inline`，报告用）  
- Dataset query: `POST /api/datasetQuery/execute`  
- Report: `GET/POST /api/report` · `GET /api/report/{id}` · `PUT /api/report/{id}/doc` · `POST /api/report/{id}/publish`

## 目录说明

| 路径 | 说明 |
|------|------|
| `src/main/java/io/opendashboard/` | **产品代码** |
| `demo/` · `manage/` · `store/` · `server/` | **旧 TypeScript 垂直切片（reference only）**，勿当产品入口 |
| `java/io/product/dashboard/` | 早期 Java 契约标记（deprecated） |

根目录仍可用 `npm run slice` 跑旧 TS 演示，与本 Spring 服务无关。
