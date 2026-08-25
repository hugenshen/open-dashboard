---
title: Open Dashboard 文档导航
tags: [docs, index, retrieval, co-teamai]
domain: technical
---

# Docs

以**当前实现** + 本文档树为契约源。仓库路径：`.teamai/docs/`（Co-TeamAI 单仓）。对外介绍：[share.html](./share.html) · 协作规范：[process.md](./process.md) · 使用说明：[guide.html](./guide.html) · AI：[../../AGENTS.md](../../AGENTS.md)

## 谁读什么

同一套真相，按角色换入口，不复制文档。聊天记录不是长期真相。

| 角色 | 先打开 | 只回答 |
|------|--------|--------|
| 规划 & BA（需求） | [product/README.md](./product/README.md) · [roadmap/](./product/roadmap/) · 提案范围 · 可选 `req/` | 给谁、做什么、不做什么、验收 ID；**不写** 提案 `design/` / OpenAPI |
| 高保设计 | [hi-fi](./prototypes/hi-fi/) · [VERSIONS.md](./prototypes/VERSIONS.md) | BA：交互可对照；定稿快照交给开发做方案 |
| 方案设计 | 提案 `design/` · [openapi.yaml](./design/openapi.yaml) | **开发**写流程、模型、边界、契约 |
| 开发（实现） | README「开发入口」→ 快照或 hi-fi → OpenAPI | 对照哪一版、改哪些代码；交给 `@测试` |
| 测试 | `test/acceptance.yaml` + `prototype-snapshot` | 前置、动作、期望、证据；哪些阻塞上线 |
| AI | [AGENTS.md](../../AGENTS.md)，然后走**当前角色**同一条链 | 未验收不写 requirements / 4A；当轮回写 Pxxx |

## 怎么读（按问题）

| 你想… | 去读 |
|-------|------|
| 了解产品是什么 | [product/README.md](./product/README.md) |
| 已交付需求基线 | [product/requirements.md](./product/requirements.md) |
| 进度 / 状态 | [product/roadmap/](./product/roadmap/)（[进行中](./product/roadmap/in-progress/) / [已完成](./product/roadmap/done/) / [计划中](./product/roadmap/planned/) / [搁置](./product/roadmap/parked/) / [不做](./product/roadmap/wont/)） |
| 未交付需求与设计 | [proposals/](./proposals/)（Pxxx 主键不搬家；开发看「开发入口」） |
| 已实现 4A 架构 | [design/architecture.html](./design/architecture.html) |
| FE↔BE 硬契约 | [design/openapi.yaml](./design/openapi.yaml) |
| 给新人讲协同 / TeamAI 背景 | [share.html](./share.html) |
| 怎么协作 | [process.md](./process.md) · [guide.html](./guide.html) |
| 部署开箱 | 仓库根 `./scripts/up.sh`；各服务见 [backend/deploy.md](../../open-dashboard-backend/deploy.md) · [frontend/deploy.md](../../open-dashboard-frontend/deploy.md) |
| 技术选型 | [tech-stack.md](./tech-stack.md) |
| 终端用户操作 | [user-manual/index.html](./user-manual/index.html)（在线 `/help/`） |
| 高保原型 | [prototypes/](./prototypes/)（[hi-fi 增量](./prototypes/hi-fi/) · [冻结快照](./prototypes/snapshots/) · 账本 [VERSIONS.md](./prototypes/VERSIONS.md)） |

## 目录结构

```
.teamai/
├── teamai.yaml · culture.md · rules/ · skills/ · learnings/
└── docs/                    # 本树：唯一产品/工程契约
    ├── share.html           # 对外协同介绍
    ├── guide.html
    ├── process.md
    ├── product/
    ├── proposals/
    ├── design/              # architecture.html + architecture.md + openapi.yaml
    ├── user-manual/
    └── prototypes/
```

无 `archive/`：历史见 `proposals` 中 `done` 与 git tag。

## 维护约定（摘要）

1. **进度按状态夹**：当前开发看 `roadmap/in-progress/`。每条写给谁、要解决什么、范围；不要按月建文件，也不要为每条再建 `Pxxx.md`。
2. 新功能：在对应状态夹 README 挂条 → 提案写范围、波及、开发入口与 `test/acceptance.yaml` → 可选高保（定稿打 acceptance 快照）→ 跨端先 OpenAPI 后实现 → 同提交更新 `architecture.html` → pass 的 ID 回写 `requirements`；提案全部做完才标 `done` 并挪到 `done/`。
3. **验收唯一真相**是 `test/acceptance.yaml`。README 只留 ID + 一句话，不复制判据/状态/证据。提案根上只留 README；需求附录进 `req/`，方案进 `design/`，实测进 `test/reports/`。
4. `gates.hi-fi=accepted` 时开发对照 `prototype-snapshot`，不要对照最新 hi-fi。
5. Pxxx 目录不搬家；状态看文首，进度看 `roadmap/<状态>/README.md`。
6. `.teamai/docs/design/` 只留现行 4A HTML、OpenAPI 与检索用 `architecture.md`；未实现方案留在提案 `design/`；未验收能力不进 `requirements.md`。
7. Commit / PR 标题带 Pxxx；跨端契约与实现同 PR；架构变化与代码同 commit。
8. 改流转时同步：`AGENTS.md`、`process.md`、本文、`guide.html`、`share.html`、`proposals/README.md`。
9. Harness 改 `.teamai/rules|skills|culture`；会话踩坑写入 `.teamai/learnings/`（YAML frontmatter）；不要在仓库根再建 `docs/`。
