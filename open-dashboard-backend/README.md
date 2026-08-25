# Open Dashboard Backend

JDK 21 · Spring Boot 3 · PostgreSQL · Flyway · COLA 多模块。

契约：[`../.teamai/docs/design/openapi.yaml`](../.teamai/docs/design/openapi.yaml)。  
运行、Docker、生产注意：[`deploy.md`](./deploy.md)。

```
open-dashboard-domain/          # DTO + Gateway
open-dashboard-app/             # 用例编排
open-dashboard-infrastructure/  # JDBC、Gateway 实现
open-dashboard-adapter/         # REST + Security
open-dashboard-start/           # 启动入口、yml、Flyway
```
