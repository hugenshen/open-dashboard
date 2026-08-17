# 协作规范（process）

所有人（含 AI）按本文推进需求。使用说明（HTML）：[guide.html](./guide.html)。

## 目录角色

| 路径 | 角色 |
|------|------|
| `product/README.md` | 产品定位、用户、模块与边界 |
| `product/requirements.md` | **仅已交付**基线（as-built） |
| `product/roadmap/` | 按状态分夹，每夹一份 README |
| `proposals/Pxxx-name/` | 未交付需求 + 详细设计 + 验收；主键不搬家；开发入口 + 波及 |
| `design/architecture.html` | **已实现**的 4A 现行架构，只写代码事实 |
| `design/openapi.yaml` | FE↔BE 机器可读硬契约 |
| `prototypes/` | 高保：当前 `hi-fi/` · 冻结 `snapshots/` · 账本 `VERSIONS.md` |

人类可读的角色入口、月度节奏见 [guide.html](./guide.html)。

## 新需求主路径

```text
roadmap/<状态>/README.md 挂条
  → proposals/Pxxx-name/（需求 + 详细设计 + 验收 + 开发入口）
  →（可选）原型：hi-fi 增量；定稿打 acceptance 快照
  → 实现（跨端先 OpenAPI，后 FE/BE）
  → 验证
  → 同提交更新 architecture.html
  → 验收后 requirements 回写；把该行挪到 roadmap/done/
  → Pxxx 标 done
```

1. **立项**：在 `product/roadmap/planned/` 或 `in-progress/` 的 README 加一行（尚无提案时用描述性名称）。
2. **提案**：新建 `proposals/Pxxx-name/README.md`，文首写 `status`，正文第一段必须是「开发入口」；`draft` → `accepted` → `in-progress`。
3. **映射**：提案用 Pxxx 关联 prototype、snapshot、design、architecture、requirements；总表按状态分组在 `proposals/README.md`。
4. **原型**：改 `hi-fi/` 对应模块。过程冻结 kind=`increment`；当作验收/实现基线时 kind=`acceptance`，并写入 `prototype-snapshot`。
5. **实现**：开发打开该提案「开发入口」。跨 FE/BE 先更新 OpenAPI。`hi-fi: accepted` 时对照快照，不对照最新 hi-fi。
6. **架构同步**：代码验证提交时更新 `architecture.html`。
7. **交付**：回写 requirements；把该行从 `roadmap/in-progress/` 挪到 `done/`；提案 `status: done`。**不要移动提案目录。**

历史追溯：看 `proposals` 里 `done` 条目，或 git tag（如 `v0.5.0`）。**不保留 `archive/`。**

## 统一映射

Pxxx 是全链路主键。提案文首按实际阶段维护：

```yaml
id: Pxxx
status: draft | accepted | in-progress | done
milestone: v0.x
prototype: docs/prototypes/hi-fi/...         # 可选
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
requirements: [PR-XXX-01]                    # 验收后填写
implementation: [open-dashboard-frontend/..., open-dashboard-backend/...] # 实现后填写
done: YYYY-MM-DD                             # done 时填写
```

- proposal：保留当时为什么做、方案取舍和验收证据。
- architecture：只描述最终怎么实现、模块怎么协作、数据怎么流转。
- requirements：只回答产品现在已支持什么。
- `proposals/README.md`：按状态分组维护 `Pxxx ↔ prototype ↔ snapshot ↔ architecture ↔ PR-*`。
- `roadmap/<状态>/README.md` 与提案 `status` 必须一致；提案目录永不因状态变更而改名或搬家。
- acceptance：区分 `hi-fi`、`code`、`acceptance` 三层；高保通过或代码存在都不能替代产品验收。

每个在途提案必须有 `acceptance.yaml`、README「开发入口」和「波及」表。验收项必须包含稳定 ID、gate、可复现判据、方法、期望结果、证据、状态和是否阻塞 done。`status: done` 要求全部阻塞项为 `pass`，并已回写 architecture 与 requirements。

`acceptance.yaml` 是验收状态**唯一真相**。README 只保留 ID + 一句话标题，禁止复制 criterion / expected / status / evidence。BA 改范围时改 yaml 的 `criterion`；测试只改 `status` / `evidence`；开发改 `command_or_path`。`done` 之后 yaml 冻结。一条在途提案建议 5～12 条阻塞项。

## 开发怎么找到该读的东西

实现 `Pxxx` 时只走这一条人工路径：

1. `docs/product/roadmap/in-progress/` 确认它仍是进行中。
2. 打开 `docs/proposals/Pxxx-name/README.md` 顶部的状态行和 **开发入口** 表。
3. 按表去读 `acceptance.yaml`、`design*.md`、指定原型。
4. 原型识别：
   - `hi-fi/` = 当前增量，随时会变；
   - `snapshots/<id>/` = 冻结历史；`SNAPSHOT.md` 写提案、kind、相对上一版；
   - `kind=acceptance` 且提案 `prototype-snapshot` 指向它 → 实现对照此版；
   - `kind=increment` → 过程档，不是交付基线。
5. 账本 [`prototypes/VERSIONS.md`](./prototypes/VERSIONS.md) 用提案号 + kind 把版本串起来。

不要从聊天记录、最新 hi-fi 或 done 提案里「顺手抄」未列入开发入口的内容。不在 `in-progress/` 的条目不要当当前任务。

## 角色入口

| 角色 | 先打开 | 只回答 |
|------|--------|--------|
| 规划 | `product/roadmap/` 各状态夹 | 进行中 / 已完成 / 计划中有什么 |
| BA | 提案 README 范围 / 非目标 / 流程 | 边界、用户怎么走、验收 ID |
| 开发 | README「开发入口」 | 对照哪版、改哪些代码、回归哪些 ID |
| 测试 | `acceptance.yaml` | 能否复现、是否阻塞上线 |
| AI | 根目录 `AGENTS.md`，然后与人对同一条链 | 当轮落盘；未 pass 不写 requirements |

## 按状态推进

当前开发只看 [`roadmap/in-progress/`](./product/roadmap/in-progress/)。计划中、搁置、已完成、不做各是独立一夹，每夹只有一份 README。不要按月再建文件。

```text
立项    在 planned/ 或 in-progress/ 挂条
高保    gate=hi-fi → acceptance 快照
实现    OpenAPI → 代码；PR 带 Pxxx；architecture 同提交
验收    yaml 阻塞项 pass 才回写 requirements
交付    该行挪到 done/；未做完保持 in-progress
```

过程产物不要平行繁殖：排期用状态夹，需求用提案，交互用 snapshot，契约用 OpenAPI，可否上线用 yaml `status`，已上线用 requirements + tag。

## 波及（提案必填）

README 用表写清：依赖提案、改动面（FE/BE/Harness/OpenAPI/高保及「不改」）、回归哪些 `PR-*`、不要动的范围。新决策替代旧方案时必须改依赖提案，不能只改最新一篇。

## 提交与发版

- Commit / PR 标题带 Pxxx，例如 `P007: 用 AppShell 替换 ModuleTopbar`。
- 跨端同一 PR：OpenAPI 与实现一起合。
- 模块边界、数据流、技术栈或部署变化：`architecture.html` 必须同 commit。
- tag 的内容 = `blocker_of_done: true` 且 `status: pass` 的项。

## 多轮对话决策落盘

- 用户确认范围、非目标、权限边界、交互规则或技术边界后，必须在本轮结束前回写对应 Pxxx 的 README / design / acceptance；聊天记录不能作为长期唯一真相。
- 后续决策推翻旧方案时，要搜索并修正同提案及依赖提案中的冲突表述，在修订记录写明“替代什么”，不能只改最新一处。
- 未确认的关键选择写入“待确认决策”，不得写成已接受方案；已确认边界要转换成可判定验收项。
- 交付前做跨提案冲突检查，至少核对入口显示范围、权限继承、进程边界、数据持久化和已交付/未交付状态。

## 4A 更新粒度

以下变化必须与代码同一提交更新 `design/architecture.html`：业务能力地图或价值流、应用模块或服务边界、数据实体或查询链路、技术栈或部署/安全边界。类名、函数实现、候选方案和未验收交互留在对应 Pxxx，不进入 4A HTML。

## 短路径

| 类型 | 做法 |
|------|------|
| 小型纯 UI、契约不变 | 可不建 proposal；若改变长期架构或已交付能力，再更新 architecture/requirements |
| OpenAPI 与线上不符 | 无 proposal；改 openapi 或改代码（以已上线为准并尽快对齐） |
| 文档笔误 | 直接改对应文件 |

## 版本分层

| 层 | 机制 | 干什么 |
|----|------|--------|
| 产品里程碑 | 提案 `milestone` + `roadmap/<状态>/` | v0.x 要交付哪些 Pxxx |
| 当前进度 | `roadmap/in-progress/README.md` | 正在做的条目与当前验收 ID |
| 交互 | `VERSIONS.md` + snapshots | `increment` 过程档；`acceptance` 实现对照 |
| 发版 | git tag（如 `v0.5.0`） | 整仓回放，含当时的 requirements |

**不**维护多份 `requirements-v0.x.md`。旧基线：`git show v0.4.0:docs/product/requirements.md`。

## 实例摘要

**分享加密码（跨端）**：roadmap 挂条 → P00x 内写需求与设计 → 接受后先改契约再实现 → 验证时同步 architecture → 验收后写 requirements → P00x done。

**画布吸附（纯前端）**：小改可无 proposal；先实现与验收，仅当改变应用边界或长期能力时更新 architecture/requirements。

**对话分析（P004）**：见 [proposals/P004-conversation/](./proposals/P004-conversation/)。

**产品壳 / 工作台留白（P007）**：见 [proposals/P007-app-shell/](./proposals/P007-app-shell/)；高保入口 [`prototypes/hi-fi/workbench.html`](./prototypes/hi-fi/workbench.html)。

## 高保原型（`docs/prototypes/`）

高保是文档资产，放在 **`docs/prototypes/`**（仓库根不再单开 `prototypes/`）。

| 路径 | 角色 |
|------|------|
| [`prototypes/hi-fi/`](./prototypes/hi-fi/) | **当前增量**，可改 |
| [`prototypes/snapshots/`](./prototypes/snapshots/) | 历史冻结，只读；看 `SNAPSHOT.md` 的提案 / kind / 相对上一版 |
| [`prototypes/VERSIONS.md`](./prototypes/VERSIONS.md) | 版本账本，用 Pxxx 识别 |

预览：`docs/prototypes/hi-fi/start.sh`。入口 [workbench.html](./prototypes/hi-fi/workbench.html)。

### 按模块拆分（`hi-fi/`）

| 文件 | 改什么 |
|------|--------|
| `shared/shell.css` · `shared/shell.js` | 左栏 + 顶栏产品壳（各页统一引用） |
| `workbench.html` | 工作台首页 |
| `conversation.html` | 对话（问数结果在对话流） |
| `datasource.html` | 数据源 |
| `dataset.html` | 数据集 |
| `dashboard.html` | 仪表盘列表 / 编辑器 / 预览 |
| `report.html` | 报告 |
| `dashboard-feishu.html` | 历史气质参照，不驱动新交互 |

旧入口 `dashboard-commercial.html` 仅做 hash 重定向。资源模块顶栏不放问数框。

### 怎么改

1. **一模块一页**。新一级入口先建 html，再写入 `shared/shell.js` 的 `PAGES`。
2. 壳层只改 `shared/`。不要在模块 html 里再复制一份菜单。
3. 提案文首 `prototype:`（增量）和可选 `prototype-snapshot:`（冻结）；同时更新 [MANIFEST.md](./prototypes/hi-fi/MANIFEST.md) 与 [VERSIONS.md](./prototypes/VERSIONS.md)。
4. 产品未跟上高保时：目标设计留在 proposal；`architecture.html` 与 `requirements.md` 均保持已实现现状。实现时若高保已 `accepted`，对照快照而不是最新 hi-fi。

### 版本管理（快照）

`hi-fi/` 只有一份「当前」。历史用快照，不靠覆盖同一个 html 混多个版本。

**何时打快照**

- 破坏性改壳 / 拆文件 / 删页面之前
- 提案把高保当成验收基准时（如 P007 壳层定稿）
- 产品里程碑发版、需要对照当时交互时

**怎么打**

```bash
cd docs/prototypes
./snapshot.sh 2026-08-17-p007-app-shell "P007 左栏壳" P007 increment
./snapshot.sh 2026-08-17-p007-app-shell-final "P007 高保定稿" P007 acceptance
```

- `id` = `YYYY-MM-DD-<slug>`，slug 含提案号。
- `increment`：继续改 hi-fi 之前的过程档。
- `acceptance`：该提案高保验收基线；必须写进提案 `prototype-snapshot`。
- 快照**不含** `vendor/`。
- **禁止**改 `snapshots/` 里的文件；要继续改，回 `hi-fi/` 再打新快照。
- 产品 git tag 仍管整仓；高保用 VERSIONS + snapshots 对照交互演进。
