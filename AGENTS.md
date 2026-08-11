# AGENTS.md

本仓 docs / 原型为产品契约入口。实现见 `open-dashboard-frontend/`、`open-dashboard-backend/`（将来可分仓）。

## 必读

1. [docs/process.md](docs/process.md) — 协作规范  
2. [docs/guide.html](docs/guide.html) — 使用说明（HTML）  
3. [docs/README.md](docs/README.md) — 文档导航  

## 地图

| 路径 | 用途 |
|------|------|
| `docs/product/requirements.md` | 已交付基线（禁止写入未验收能力） |
| `docs/product/roadmap.md` | 下一步 + 里程碑 |
| `docs/proposals/` | 规格；仅 `draft\|accepted\|in-progress` 指导开发 |
| `docs/design/` | 说明书 + `openapi.yaml`（硬契约） |
| `prototypes/hi-fi/` | 当前原型；勿改 `snapshots/` |

## 硬规则

- 跨 FE/BE：先更新 `docs/design/openapi.yaml`（及 design），再改实现。  
- 交付后：回写 `requirements.md`，proposal 标 `status: done`。  
- `done` 的 proposal 只追溯，不驱动新开发。  
- 无 `archive/`；历史靠 proposal 标记与 git tag。  
- OpenAPI 与实现冲突：以已上线行为为准，并尽快修契约。  

## 命令（单体仓）

```bash
./scripts/up.sh
npm run hi-fi
```
