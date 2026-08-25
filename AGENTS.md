# AGENTS.md

本仓以 **Co-TeamAI**（目录 `.teamai/`，命令 `teamai`）承载协同；产品与工程契约在 `.teamai/docs/`。实现位于 `open-dashboard-frontend/`、`open-dashboard-backend/`、`opendashboard-dsh-harness/`（P011 对话 Agent）。Python `opendashboard-harness/` 已在 P011 M4 删除。

## 必读

1. [.teamai/docs/process.md](.teamai/docs/process.md) — 完整协作与流转规范
2. [.teamai/docs/README.md](.teamai/docs/README.md) — 文档导航
3. [.teamai/docs/share.html](.teamai/docs/share.html) — 给新人的协同介绍
4. [.teamai/docs/guide.html](.teamai/docs/guide.html) — 人类可读使用说明
5. `.teamai/rules/` — 注入各 AI 工具的短规则（与 process 同一套，不另写真相）
6. `.teamai/skills/` · `.teamai/learnings/` — 怎么干活，以及 0→1 踩坑；新任务先走 `od-rd-loop`

## 文档真相分层

| 路径 | 只存什么 |
|------|----------|
| `.teamai/docs/product/README.md` | 稳定产品定位、用户、模块与边界（不含仓库/实现） |
| `.teamai/docs/product/roadmap/` | 按状态分夹；每条写给谁、要解决什么、范围（Now / Shipped / Later / Won’t） |
| `.teamai/docs/proposals/Pxxx-name/` | **未交付需求 + 详细设计 + 验收**；主键不搬家；根 README 是地图；内部 `req/` · `design/` · `test/` |
| `.teamai/docs/prototypes/` | `hi-fi/` 当前增量；`snapshots/` 历史冻结；`VERSIONS.md` 记提案、kind、相对上一版 |
| `.teamai/docs/design/architecture.html` | **已实现**的 4A 现行架构；只写代码中可证实的稳定结果 |
| `.teamai/docs/design/architecture.md` | 4A 检索索引（HTML 不进 BM25） |
| `.teamai/docs/design/openapi.yaml` | FE↔BE 机器可读硬契约 |
| `.teamai/docs/product/requirements.md` | **已实现且已验收**的产品能力基线 |

禁止把未来设计提前写进 `design/`，禁止把未验收能力写进 `requirements.md`。

## 唯一流转

```text
roadmap/<状态>/README.md 挂条
  → proposal 目录（需求 + 详细设计 + 验收 + 开发入口）
  → prototype（hi-fi 增量；定稿打 acceptance 快照）
  → implementation（跨端先更新 OpenAPI，后 FE/BE）
  → 代码验证时同提交更新 architecture.html
  → 验收后 requirements 回写；把该行挪到 done/
  → proposal status: done
```

人按角色交接，不按工种并行另写一套真相：

```text
发起人 @需求(BA) → @高保(BA) → @方案设计(开发) → @实现(开发) → @测试
```

| 棒 | 谁做 | 产出 | 下一棒 |
|----|------|------|--------|
| 需求 | BA | 范围/非目标、yaml `criterion` | `@高保` |
| 高保设计 | BA | hi-fi / acceptance 快照 | `@方案设计` |
| 方案设计 | **开发** | `Pxxx/design/`、OpenAPI 草案、代码落点 | 同一人实现 |
| 实现 | 开发 | 代码；architecture 同提交 | `@测试` |
| 测试 | 测试 | yaml `status` / `evidence` | pass 才回写 requirements |

AI 走**当前棒**的入口和产出。teamai Role：`ba`（需求+高保）/ `dev`（方案+实现）/ `test`。选角：`teamai roles set ba|dev|test`。BA 不写技术方案。

实现某个提案时，人工入口是 `.teamai/docs/proposals/Pxxx-name/README.md` 的「开发入口」：它会指向 acceptance、design、该对照 hi-fi 还是 snapshot、代码落点与波及。不要从聊天或最新 hi-fi 猜测。不在 `roadmap/in-progress/` 的条目不要当当前开发任务。

`gates.hi-fi=accepted` 时实现对照 `prototype-snapshot`；`wip` 时才对照 `hi-fi/`。提案目录不随状态移动，只改文首并把该行挪到 `roadmap/<新状态>/README.md`。

实现阶段：跨 FE/BE 时在同一实现分支中先按提案更新 `design/openapi.yaml`，再改 FE/BE；代码验证并提交时同步更新 `design/architecture.html`。契约、代码与现行架构必须在同一交付收敛。纯 UI 且无契约变化可省略 OpenAPI。

## Pxxx 统一映射

Pxxx 是需求、设计、原型、实现、验收的主键。每个提案文首必须维护：

```yaml
id: Pxxx
status: draft | accepted | in-progress | done
milestone: v0.x
prototype: .teamai/docs/prototypes/hi-fi/...       # 无则省略
prototype-snapshot: .teamai/docs/prototypes/snapshots/... # 高保冻结后填写
design: [.teamai/docs/proposals/Pxxx-name/design/design.md] # 未实现详细设计（可选）
acceptance: .teamai/docs/proposals/Pxxx-name/test/acceptance.yaml
gates:
  proposal: draft | accepted
  hi-fi: none | wip | frozen | accepted
  code: none | wip | merged
  acceptance: none | blocked | passed
architecture: .teamai/docs/design/architecture.html  # 实现后填写
contract: .teamai/docs/design/openapi.yaml            # 有跨端契约时填写
requirements: [PR-XXX-01]                  # 验收后填写
implementation: [open-dashboard-frontend/..., open-dashboard-backend/...] # 实现后填写
done: YYYY-MM-DD                           # done 时填写
```

映射总表维护在 `.teamai/docs/proposals/README.md`。architecture 对应章节须能追溯到代码或 Pxxx；requirements 使用稳定 PR-* ID，并反链 Pxxx/architecture。

## 交付硬规则

- 提案内先写需求与验收（BA）、交互高保（BA）、技术方案与契约（开发）；评审接受后再写产品代码。
- `design/` 只保留现行 4A HTML、OpenAPI，以及供检索用的 `architecture.md`；详细设计始终留在提案目录。
- 能力地图、模块边界、数据流、技术栈或部署变化，必须和代码在同一提交更新 `architecture.html`。
- 在途提案必须维护 `acceptance.yaml`；README 只留 ID + 标题，不复制判据/状态；高保、代码、产品验收分别记 gate，不能互相替代。
- 提案 README 必须有「开发入口」和「波及」（依赖、改动面、回归 ID、不要动）。
- Commit / PR 标题带 Pxxx；跨端 OpenAPI 与实现同 PR；架构变化与代码同 commit。
- 当前开发只做 `roadmap/in-progress/` 里的条目；验收 ID 以该提案 `acceptance.yaml` 为准。
- `done` 前所有阻塞验收项必须为 `pass`，且 architecture、requirements 与提案映射一致。部分交付时提案保持 `in-progress`，只回写已 pass 的 ID。
- 用户在多轮对话中确认的范围、权限、交互或技术边界，必须在本轮结束前回写 Pxxx 和 acceptance；不得只留在聊天记录。
- 新决策替代旧方案时，必须搜索并修正依赖提案中的冲突表述，同时记录修订原因。
- 交付顺序：OpenAPI → 实现与验证 → architecture 同步 → requirements 回写 → 该行挪到 `roadmap/done/` → proposal `done`。
- 实现某个提案时，只以该提案 README「开发入口」为人工入口；`hi-fi: accepted` 对照 snapshot，不要对照最新 hi-fi。
- 提案目录按 Pxxx 固定不搬家；状态只改文首，并把该行挪到 `.teamai/docs/product/roadmap/<状态>/README.md`。
- `done` 提案只追溯，不驱动新开发；新变化新建 Pxxx。
- 无 `archive/`；历史依赖 done 提案、高保快照与 git tag。
- 契约与线上冲突时，以已上线行为为准，立即修正 design/OpenAPI。
- 不擅自修改冻结的 `.teamai/docs/prototypes/snapshots/`。

## Co-TeamAI

单仓模式：知识在 `.teamai/`（随 clone 带走）。成员在仓库根执行 `teamai init .`（需 git 已登录）。会话开始会 `teamai pull`。

| 路径 | 角色 |
|------|------|
| `.teamai/docs/` | 原来的产品 docs 树（唯一契约） |
| `.teamai/rules/` · `skills/` · `learnings/` | harness：短规则、研发技能（先对齐再实现）、会话踩坑 |
| `.teamai/culture.md` | pull 时注入各工具 |

不要对 `.teamai/docs/` 跑 `teamai uninstall` 的 docs 清理。不要符号链接。不要把文档再复制一份到仓库根 `docs/`。

## 常用命令

```bash
./scripts/up.sh
./.teamai/docs/prototypes/hi-fi/start.sh
cd opendashboard-dsh-harness && pnpm install && pnpm approve-builds --all && ./start.sh
teamai init .          # 本仓第一次 / 队友 clone 后未认证时
teamai pull            # 立刻同步 harness
```
