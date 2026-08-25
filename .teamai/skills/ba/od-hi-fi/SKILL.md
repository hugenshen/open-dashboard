---
name: od-hi-fi
description: 修改 Open Dashboard 高保原型（hi-fi、8765、workbench.html、snapshot、先看效果）。用户要对齐交互、改原型、打快照时使用。不要改 Vue 产品代码，不要改冻结快照。
---

# 高保原型

踩坑与端口：[hi-fi-ports-and-snapshots.md](../../../learnings/hi-fi-ports-and-snapshots.md)。规范：[process.md](../../../docs/process.md) 高保章节。

## 只改这些

- 当前增量：`.teamai/docs/prototypes/hi-fi/`
- 壳层：`shared/shell.css`、`shared/shell.js`、`shared/shell` 相关资源
- 一模块一页 html；新一级入口先建 html，再写入 `shared/shell.js` 的 `PAGES`
- 同时更新 `MANIFEST.md` 与 `VERSIONS.md`
- 提案文首 `prototype:`（增量）和定稿后的 `prototype-snapshot:`

## 禁止

- 修改 `.teamai/docs/prototypes/snapshots/`
- 在模块 html 里再复制一份左栏菜单
- 把未验收高保写进 `architecture.html` / `requirements.md`
- 用户只要看高保时去改 `open-dashboard-frontend/`

## 给用户看

```bash
./.teamai/docs/prototypes/hi-fi/start.sh
```

回复里写明完整 URL（例如 `http://127.0.0.1:8765/workbench.html`），并说明**这是高保不是 Vue（5173）**。若用户说「我怎么看还是一样」，先排除缓存、错端口、服务没起来。

`hi-fi: accepted` 的提案，实现对照 snapshot，不要继续拿最新 hi-fi 当验收基线。

## 打快照

破坏性改壳 / 拆文件之前；或提案要把高保当验收基线时：

```bash
cd .teamai/docs/prototypes
./snapshot.sh YYYY-MM-DD-<slug> "说明" Pxxx increment    # 过程档
./snapshot.sh YYYY-MM-DD-<slug> "说明" Pxxx acceptance   # 交付基线，写入 prototype-snapshot
```

用户确认「可以，帮我实现吧」之后，再交给 `dev` 角色走 [od-implement-proposal](../../dev/od-implement-proposal/SKILL.md)。
