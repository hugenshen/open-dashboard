# AGENTS.md

本仓以 docs 为产品与工程契约入口；实现位于 `open-dashboard-frontend/`、`open-dashboard-backend/`、`opendashboard-dsh-harness/`（P011 对话 Agent）。Python `opendashboard-harness/` 已在 P011 M4 删除。

## 必读

1. [docs/process.md](docs/process.md) — 完整协作与流转规范
2. [docs/README.md](docs/README.md) — 文档导航
3. [docs/guide.html](docs/guide.html) — 人类可读使用说明

## 文档真相分层

| 路径 | 只存什么 |
|------|----------|
| `docs/product/README.md` | 稳定产品定位、用户、模块与边界（不含仓库/实现） |
| `docs/product/roadmap/` | 按状态分夹；每条写给谁、要解决什么、范围（Now / Shipped / Later / Won’t） |
| `docs/proposals/Pxxx-name/` | **未交付需求 + 详细设计 + 验收**；目录按 Pxxx 固定不搬家；文首 `status` + README「开发入口」 |
| `docs/prototypes/` | `hi-fi/` 当前增量；`snapshots/` 历史冻结；`VERSIONS.md` 记提案、kind、相对上一版 |
| `docs/design/architecture.html` | **已实现**的 4A 现行架构；只写代码中可证实的稳定结果 |
| `docs/design/openapi.yaml` | FE↔BE 机器可读硬契约 |
| `docs/product/requirements.md` | **已实现且已验收**的产品能力基线 |

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

实现某个提案时，人工入口是 `docs/proposals/Pxxx-name/README.md` 的「开发入口」：它会指向 acceptance、design、该对照 hi-fi 还是 snapshot、代码落点与波及。不要从聊天或最新 hi-fi 猜测。不在 `roadmap/in-progress/` 的条目不要当当前开发任务。

`gates.hi-fi=accepted` 时实现对照 `prototype-snapshot`；`wip` 时才对照 `hi-fi/`。提案目录不随状态移动，只改文首并把该行挪到 `roadmap/<新状态>/README.md`。

实现阶段：跨 FE/BE 时在同一实现分支中先按提案更新 `design/openapi.yaml`，再改 FE/BE；代码验证并提交时同步更新 `design/architecture.html`。契约、代码与现行架构必须在同一交付收敛。纯 UI 且无契约变化可省略 OpenAPI。

## Pxxx 统一映射

Pxxx 是需求、设计、原型、实现、验收的主键。每个提案文首必须维护：

```yaml
id: Pxxx
status: draft | accepted | in-progress | done
milestone: v0.x
prototype: docs/prototypes/hi-fi/...       # 无则省略
prototype-snapshot: docs/prototypes/snapshots/... # 高保冻结后填写
design: [docs/proposals/Pxxx-name/design.md] # 未实现详细设计（可选）
acceptance: docs/proposals/Pxxx-name/acceptance.yaml
gates:
  proposal: draft | accepted
  hi-fi: none | wip | frozen | accepted
  code: none | wip | merged
  acceptance: none | blocked | passed
architecture: docs/design/architecture.html  # 实现后填写
contract: docs/design/openapi.yaml            # 有跨端契约时填写
requirements: [PR-XXX-01]                  # 验收后填写
implementation: [open-dashboard-frontend/..., open-dashboard-backend/...] # 实现后填写
done: YYYY-MM-DD                           # done 时填写
```

映射总表维护在 `docs/proposals/README.md`。architecture 对应章节须能追溯到代码或 Pxxx；requirements 使用稳定 PR-* ID，并反链 Pxxx/architecture。

## 交付硬规则

- 提案内先写需求、交互、技术设计、契约变化和验收；评审接受后再实现。
- `design/` 只保留 `architecture.html` 与 `openapi.yaml`；详细设计始终留在提案目录。
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
- 提案目录按 Pxxx 固定不搬家；状态只改文首，并把该行挪到 `docs/product/roadmap/<状态>/README.md`。
- `done` 提案只追溯，不驱动新开发；新变化新建 Pxxx。
- 无 `archive/`；历史依赖 done 提案、高保快照与 git tag。
- 契约与线上冲突时，以已上线行为为准，立即修正 design/OpenAPI。
- 不擅自修改冻结的 `docs/prototypes/snapshots/`。

## 常用命令

```bash
./scripts/up.sh
./docs/prototypes/hi-fi/start.sh
cd opendashboard-dsh-harness && pnpm install && pnpm approve-builds --all && ./start.sh
```
