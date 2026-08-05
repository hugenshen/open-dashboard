# Docs

以**当前实现**为契约源。历史提案 / 分版本规格已迁入 [archive/](./archive/)，不再作为日常维护入口。

## 怎么读

| 你想… | 去读 |
|-------|------|
| 了解产品是什么、边界在哪 | [product/overview.md](./product/overview.md) |
| 看已交付需求（演进基线） | [product/requirements.md](./product/requirements.md) |
| 看下一步做什么 | [product/roadmap.md](./product/roadmap.md) |
| 改前端 / 懂模块结构 | [design/frontend.md](./design/frontend.md) |
| 改后端 / COLA / Profile | [design/backend.md](./design/backend.md) |
| 懂实体与发布态 | [design/domain.md](./design/domain.md) |
| 懂取数链路 | [design/data-query.md](./design/data-query.md) |
| 接客户鉴权 | [design/auth.md](./design/auth.md) |
| 查 REST | [api/rest.md](./api/rest.md) · [openapi.yaml](./openapi.yaml) |
| 部署开箱 | [deploy.md](./deploy.md) |
| 终端用户操作 | [user-manual/index.html](./user-manual/index.html)（在线：`/help/`，顶栏「帮助」） |
| 技术选型 | [tech-stack.md](./tech-stack.md) |

## 目录结构

```
docs/
├── product/           # 产品需求（现状 + 演进）
├── design/            # 前后端 / 领域 / 取数 / 鉴权设计
├── api/               # REST 人读总览
├── openapi.yaml       # OpenAPI 契约
├── tech-stack.md
├── deploy.md
├── user-manual/       # 操作手册（HTML + 截图）
└── archive/           # 历史提案、旧规格、对照材料（只读参考）
```

## 维护约定

1. **新功能**：先更新 `product/roadmap.md` → 实现 → 回写 `product/requirements.md` 与相关 `design/*`。  
2. **接口变更**：同步 `openapi.yaml` 与 `api/rest.md`。  
3. **不要**在 `archive/` 上继续迭代；需要时把结论提升到 `product/` 或 `design/`。  
4. OpenAPI 与实现冲突时：以**已上线行为**为准，并尽快修契约。

## 归档说明

`archive/` 含：早期 VERSIONING / CHANGELOG、P001–P003 提案、v0.2–v0.4 分册需求与规格、旧版 architecture / dashboard-api / schema.sql、DataEase 对照 HTML、commercial-mvp 草稿等。内容可能与现状不完全一致，仅供追溯。
