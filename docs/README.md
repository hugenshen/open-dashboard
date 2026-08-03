# Docs

开源项目文档按 **版本 / 提案** 管理，规则见 [VERSIONING.md](./VERSIONING.md)。变更摘要见 [CHANGELOG.md](./CHANGELOG.md)。

## 快速索引

### 演进中（proposals）

| 提案 | 说明 | 状态 |
|------|------|------|
| [P001 移动端布局 C 档](./proposals/P001-mobile-layout-c.md) | DataEase 对齐：独立布局 + 样式同步/分设 | draft |

全部提案目录：[proposals/README.md](./proposals/README.md)

### 架构与契约（当前）

| 文件 | 说明 |
|------|------|
| [backend-architecture.md](./backend-architecture.md) | 后端配置、取数、权限（含数据集行列权限与分享） |
| [data-query-architecture.md](./data-query-architecture.md) | 数据源→数据集→仪表盘取数→用户访问（自研 QuerySpec） |
| [domain.md](./domain.md) | 领域模型与发布状态机 |
| [schema.sql](./schema.sql) | 表结构 |
| [dashboard-api.md](./dashboard-api.md) | REST 说明 |
| [openapi.yaml](./openapi.yaml) | OpenAPI 3 |

### 商用规格（将逐步迁入 specs/）

| 文件 | 说明 |
|------|------|
| [commercial-mvp-spec.md](./commercial-mvp-spec.md) | 商用 Phase A/B/C（v0.1 基线；移动端细节以 P001 为准） |
| [capability-matrix.md](./capability-matrix.md) | 能力矩阵 |

## 版本怎么用

1. 新能力先写 `proposals/P00N-*.md`（draft）
2. 评审通过 → `status: accepted`，实现挂到高保原型
3. 里程碑冻结 → 写入 `specs/vX.Y.Z-*.md`，并在 CHANGELOG 记一笔
4. 根目录旧文档逐步迁入 `architecture/` / `specs/`，索引保持可点

下一规格目标：**v0.2.0**（含 P001 移动端 C 档，待实现后晋升）。
