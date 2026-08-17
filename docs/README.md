# Docs

以**当前实现** + 本文档树为契约源。协作规范：[process.md](./process.md) · 使用说明：[guide.html](./guide.html) · AI：[../AGENTS.md](../AGENTS.md)

## 谁读什么

同一套真相，按角色换入口，不复制文档。聊天记录不是长期真相。

| 角色 | 先打开 | 只回答 |
|------|--------|--------|
| 规划 | [product/README.md](./product/README.md) · [roadmap/](./product/roadmap/) | 产品是什么、给谁、现在推什么、不做什么 |
| BA | [product/README.md](./product/README.md) · 提案范围 / 非目标 / 流程 + 高保 | 产品边界、用户怎么走、验收 ID |
| 开发 | README「开发入口」→ 快照或 hi-fi → design → OpenAPI | 对照哪一版、改哪些代码、回归哪些 ID |
| 测试 | `acceptance.yaml` + `prototype-snapshot` | 前置、动作、期望、证据；哪些阻塞上线 |
| AI | [AGENTS.md](../AGENTS.md)，然后走和人对同一条链 | 未验收不写 requirements / 4A；当轮回写 Pxxx |

## 怎么读（按问题）

| 你想… | 去读 |
|-------|------|
| 了解产品是什么 | [product/README.md](./product/README.md) |
| 已交付需求基线 | [product/requirements.md](./product/requirements.md) |
| 进度 / 状态 | [product/roadmap/](./product/roadmap/)（[进行中](./product/roadmap/in-progress/) / [已完成](./product/roadmap/done/) / [计划中](./product/roadmap/planned/) / [搁置](./product/roadmap/parked/) / [不做](./product/roadmap/wont/)） |
| 未交付需求与设计 | [proposals/](./proposals/)（Pxxx 主键不搬家；开发看「开发入口」） |
| 已实现 4A 架构 | [design/architecture.html](./design/architecture.html) |
| FE↔BE 硬契约 | [design/openapi.yaml](./design/openapi.yaml) |
| 怎么协作 | [process.md](./process.md) · [guide.html](./guide.html) |
| 部署开箱 | 仓库根 `./scripts/up.sh`；各服务见 [backend/deploy.md](../open-dashboard-backend/deploy.md) · [frontend/deploy.md](../open-dashboard-frontend/deploy.md) |
| 技术选型 | [tech-stack.md](./tech-stack.md) |
| 终端用户操作 | [user-manual/index.html](./user-manual/index.html)（在线 `/help/`） |
| 高保原型 | [prototypes/](./prototypes/)（[hi-fi 增量](./prototypes/hi-fi/) · [冻结快照](./prototypes/snapshots/) · 账本 [VERSIONS.md](./prototypes/VERSIONS.md)） |

## 目录结构

```
docs/
├── guide.html           # 人类可读使用说明（角色、验收、状态推进）
├── process.md           # 协作规范正文
├── product/
│   ├── README.md            # 产品定位、用户、模块、边界
│   ├── requirements.md      # 已交付能力基线
│   └── roadmap/             # 状态夹；每条写给谁 / 解决什么 / 范围
│       ├── in-progress/
│       ├── done/
│       ├── planned/
│       ├── parked/
│       └── wont/
├── proposals/           # Pxxx-name/ 主键不搬家；README + acceptance.yaml
├── design/              # 仅 architecture.html + openapi.yaml
├── tech-stack.md
├── user-manual/
└── prototypes/
    ├── VERSIONS.md      # 提案 · kind · 相对上一版
    ├── hi-fi/           # 当前增量（可改）
    └── snapshots/       # 历史冻结（只读）
```

无 `archive/`：历史见 `proposals` 中 `done` 与 git tag。

## 维护约定（摘要）

1. **进度按状态夹**：当前开发看 `roadmap/in-progress/`。每条写给谁、要解决什么、范围；不要按月建文件，也不要为每条再建 `Pxxx.md`。
2. 新功能：在对应状态夹 README 挂条 → 提案写范围、波及、开发入口与 `acceptance.yaml` → 可选高保（定稿打 acceptance 快照）→ 跨端先 OpenAPI 后实现 → 同提交更新 `architecture.html` → pass 的 ID 回写 `requirements`；提案全部做完才标 `done` 并挪到 `done/`。
3. **验收唯一真相**是 `acceptance.yaml`。README 只留 ID + 一句话，不复制判据/状态/证据。
4. `gates.hi-fi=accepted` 时开发对照 `prototype-snapshot`，不要对照最新 hi-fi。
5. Pxxx 目录不搬家；状态看文首，进度看 `roadmap/<状态>/README.md`。
6. `design/` 只留现行 4A 与 OpenAPI；未验收能力不进 `requirements.md`。
7. Commit / PR 标题带 Pxxx；跨端契约与实现同 PR；架构变化与代码同 commit。
8. 改流转时同步：`AGENTS.md`、`process.md`、本文、`guide.html`、`proposals/README.md`。
