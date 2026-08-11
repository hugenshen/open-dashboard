# Docs

以**当前实现** + 本文档树为契约源。协作规范：[process.md](./process.md) · 使用说明：[guide.html](./guide.html) · AI：[../AGENTS.md](../AGENTS.md)

## 怎么读

| 你想… | 去读 |
|-------|------|
| 了解产品是什么 | [product/overview.md](./product/overview.md) |
| 已交付需求基线 | [product/requirements.md](./product/requirements.md) |
| 下一步 / 里程碑 | [product/roadmap.md](./product/roadmap.md) |
| 进行中规格 | [proposals/](./proposals/) |
| 设计与 OpenAPI | [design/](./design/) |
| 怎么协作 | [process.md](./process.md) · [guide.html](./guide.html) |
| 部署开箱 | [deploy.md](./deploy.md) |
| 技术选型 | [tech-stack.md](./tech-stack.md) |
| 终端用户操作 | [user-manual/index.html](./user-manual/index.html)（在线 `/help/`） |

## 目录结构

```
docs/
├── guide.html           # 团队使用说明（HTML）
├── process.md           # 协作规范
├── product/             # overview · requirements · roadmap
├── design/              # 说明书 + openapi.yaml + rest.md
├── proposals/           # 规格（status: draft…done）
├── deploy.md
├── tech-stack.md
└── user-manual/         # 终端用户手册
prototypes/
├── hi-fi/               # 当前高保原型
└── snapshots/           # 可选冻结
```

无 `archive/`：历史见 `proposals` 中 `done` 与 git tag。

## 维护约定（摘要）

1. 新功能：`roadmap` → `proposals/Pxxx` → `design`/OpenAPI → 实现 → 回写 `requirements` → Pxxx 标 `done`。  
2. 未验收不写 `requirements.md`。  
3. OpenAPI 与实现冲突：以已上线行为为准，并尽快修契约。
