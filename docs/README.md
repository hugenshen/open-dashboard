# Docs

开源项目文档按 **版本 / 提案** 管理，规则见 [VERSIONING.md](./VERSIONING.md)。变更摘要见 [CHANGELOG.md](./CHANGELOG.md)。

## 快速索引

### 核心版本（v0.3）

| 文件 | 说明 |
|------|------|
| [tech-stack.md](./tech-stack.md) | **技术选型锁定**（Vue3 / JDK21 Spring Boot / PostgreSQL） |
| [requirements/v0.3.0-core.md](./requirements/v0.3.0-core.md) | 窄范围需求与验收 |
| [specs/v0.3.0-core.md](./specs/v0.3.0-core.md) | 设计规格（编辑器 + 取数 + 移动端工程） |

### 演进中（proposals）

| 提案 | 说明 | 状态 |
|------|------|------|
| [P001 移动端布局 C 档](./proposals/P001-mobile-layout-c.md) | 独立布局 + 样式同步/分设 | accepted → [v0.2.0](./specs/v0.2.0-mobile-layout.md) |
| [P002 Vue/Java 脚手架](./proposals/P002-vue-java-scaffold.md) | 真前后端工程落地 | accepted → [v0.3.0](./specs/v0.3.0-core.md) |
| [P003 报告 Umo 插图](./proposals/P003-report-umo-charts.md) | 引用看板图 + 报告内新建图（实时取数） | accepted → [v0.4.0](./specs/v0.4.0-report-umo-charts.md) |

全部提案目录：[proposals/README.md](./proposals/README.md)

### 已冻结规格（specs）

| 规格 | 说明 |
|------|------|
| [v0.4.0 报告 Umo 插图](./specs/v0.4.0-report-umo-charts.md) | 引用看板图 + 报告内新建图；实时取数 |
| [v0.3.0 Core](./specs/v0.3.0-core.md) | 编辑器 + chartQuery/datasetQuery + 移动端 + 脚手架 |
| [v0.2.0 移动端布局](./specs/v0.2.0-mobile-layout.md) | C 档：独立布局 + styleSync |

### 架构与契约（当前）

| 文件 | 说明 |
|------|------|
| [backend-architecture.md](./backend-architecture.md) | 后端配置、取数、权限 |
| [data-query-architecture.md](./data-query-architecture.md) | 数据源→数据集→仪表盘取数 |
| [chart-getdata-comparison.html](./chart-getdata-comparison.html) | DataEase getData vs 自研 chartQuery |
| [domain.md](./domain.md) | 领域模型与发布状态机 |
| [schema.sql](./schema.sql) | 表结构（历史参考；PG 以 Flyway 为准） |
| [dashboard-api.md](./dashboard-api.md) | REST 说明 |
| [openapi.yaml](./openapi.yaml) | OpenAPI 3（含 datasetQuery） |

### 商用规格（将逐步迁入 specs/）

| 文件 | 说明 |
|------|------|
| [commercial-mvp-spec.md](./commercial-mvp-spec.md) | 商用 Phase A/B/C（v0.1 基线；移动端以 P001 为准） |
| [capability-matrix.md](./capability-matrix.md) | 能力矩阵 |

## 版本怎么用

1. 新能力先写 `proposals/P00N-*.md`（draft）
2. 评审通过 → `status: accepted`，实现挂到产品或高保
3. 里程碑冻结 → 写入 `specs/vX.Y.Z-*.md`，并在 CHANGELOG 记一笔
4. 根目录旧文档逐步迁入 `architecture/` / `specs/`，索引保持可点

下一规格目标：后续提案自 **v0.5.0** 起编号。
