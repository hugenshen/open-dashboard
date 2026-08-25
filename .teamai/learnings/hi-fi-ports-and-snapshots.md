---
title: 高保、产品、dsh 三个端口不要混；定稿靠快照不是靠覆盖 html
author: hugenshen
date: 2026-08-25
tags: [prototype, hi-fi, workflow, debugging, 高保]
---

## 背景

高频事故：AI 改了高保，用户去 Vue 地址看；或改了 Vue，用户去高保地址看；或浏览器缓存导致「我怎么看还是一样」。另一类事故：破坏性改壳之前没打快照，好看的工作台版本找不回来。

## 解决方案

本仓三套界面，端口固定：

| 地址 | 是什么 | 怎么起 |
|------|--------|--------|
| `http://127.0.0.1:8765/`（或 8766） | 高保 `hi-fi/` | `.teamai/docs/prototypes/hi-fi/start.sh` |
| `http://127.0.0.1:5173/` | Vue 产品 | 仓库根 `./scripts/up.sh` 或前端 dev |
| `http://127.0.0.1:3080/` 或 `3090` | dsh 对话表面 | `opendashboard-dsh-harness/start.sh` |

改完必须把**可点击的 URL**告诉用户，并说明改的是哪一套。用户说「怎么访问」「你不是改的高保吗」= 上一轮没说清。

高保结构：

- 壳层只改 `prototypes/hi-fi/shared/`（左栏 + 顶栏）
- **一模块一页** html，不要在模块页再复制一份菜单
- 资源模块顶栏不放问数框；工作台才有入口问数
- `hi-fi/` 只有一份当前；历史用 `snapshots/` + `VERSIONS.md`
- `kind=acceptance` 才是实现对照；`increment` 只是过程档
- **禁止改** `snapshots/` 里的文件

打快照：破坏性改壳 / 拆文件之前；提案把高保当验收基线时。

```bash
cd .teamai/docs/prototypes
./snapshot.sh 2026-08-17-p007-app-shell-final "P007 高保定稿" P007 acceptance
```

## 经验总结

- 先改高保让用户看，得到「可以，实现吧」再改 Vue。两边一起改会无法验收。
- 空状态先设计：「新用户进来没有任何操作，这个页面长什么样」。数据多少都要美观，不要只画满数据的 demo。
- 左栏收折要各模块一致；不要点数据源就自动收起、点工作台又不收。
- 深色模式、对齐、密度、筛选+列表+分页分层，是反复返工点；对照互联网后台，不要发明第三种顶栏。
- 高保预览打不开，先查 start.sh 是否在跑、端口是否被占，不要先改业务代码。
- 仪表盘编辑器的数据/样式/高级交互，应对齐高保，而不是对齐 DataEase 品牌文案。

## 相关 Skills

- od-hi-fi
- od-local-verify
- od-rd-loop
