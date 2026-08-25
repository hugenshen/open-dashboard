---
title: Open Dashboard 协作规范
tags: [process, pxxx, collaboration, co-teamai]
domain: technical
---

# 协作规范（process）

所有人（含 AI）按本文推进需求。使用说明（HTML）：[guide.html](./guide.html)。对外品牌 **Co-TeamAI**；目录与命令仍是 `.teamai/` / `teamai`。

## 目录角色

| 路径 | 角色 |
|------|------|
| `product/README.md` | 产品定位、用户、模块与边界 |
| `product/requirements.md` | **仅已交付**基线（as-built） |
| `product/roadmap/` | 按状态分夹，每夹一份 README |
| `proposals/Pxxx-name/` | 主键不搬家；根 README 是地图；内部按角色分 `req/` · `design/` · `test/` |
| `design/architecture.html` | **已实现**的 4A 现行架构，只写代码事实 |
| `design/architecture.md` | 4A 检索索引（HTML 不进 BM25） |
| `design/openapi.yaml` | FE↔BE 机器可读硬契约 |
| `prototypes/` | 高保：当前 `hi-fi/` · 冻结 `snapshots/` · 账本 `VERSIONS.md` |

本文档树的仓库路径是 **`.teamai/docs/`**（TeamAI 单仓的 `docs` 资源，不是第二份文档）。人类可读的角色入口、月度节奏见 [guide.html](./guide.html)。

## 新需求主路径

```text
roadmap/<状态>/README.md 挂条
  → 需求：proposals/Pxxx-name/README（+ 可选 req/）+ test/acceptance.yaml criterion
  → 高保设计（可选）：hi-fi → acceptance 快照
  → 方案设计（开发）：Pxxx/design/ + 跨端 OpenAPI 草案 + 开发入口代码落点
  → 实现：按开发入口改代码
  → 同提交更新 architecture.html（只写已实现）
  → 验收后 requirements 回写；该行挪到 roadmap/done/
  → Pxxx 标 done
```

1. **立项**：在 `product/roadmap/planned/` 或 `in-progress/` 的 README 加一行（尚无提案时用描述性名称）。
2. **提案（需求）**：新建 `proposals/Pxxx-name/README.md`，文首写 `status`，正文第一段必须是「开发入口」；写范围、非目标、波及；`draft` → `accepted` → `in-progress`。
3. **高保设计**（可选）：改 `hi-fi/` 对应模块。过程冻结 kind=`increment`；当作验收/实现基线时 kind=`acceptance`，并写入 `prototype-snapshot`。
4. **方案设计（开发做）**：写 `Pxxx/design/`（流程、模型、边界）。跨 FE/BE 先改 OpenAPI 草案；补全开发入口代码落点。BA 不写这一步。
5. **实现**：开发打开该提案「开发入口」。`hi-fi: accepted` 时对照快照，不对照最新 hi-fi。
6. **架构同步**：代码验证提交时更新 `architecture.html`（只写已实现事实）。
7. **交付**：回写 requirements；把该行从 `roadmap/in-progress/` 挪到 `done/`；提案 `status: done`。**不要移动提案目录。**

历史追溯：看 `proposals` 里 `done` 条目，或 git tag（如 `v0.5.0`）。**不保留 `archive/`。**

## 统一映射

Pxxx 是全链路主键。提案文首按实际阶段维护：

```yaml
id: Pxxx
status: draft | accepted | in-progress | done
milestone: v0.x
prototype: .teamai/docs/prototypes/hi-fi/...         # 可选
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

每个在途提案必须有 `test/acceptance.yaml`、README「开发入口」和「波及」表。验收项必须包含稳定 ID、gate、可复现判据、方法、期望结果、证据、状态和是否阻塞 done。`status: done` 要求全部阻塞项为 `pass`，并已回写 architecture 与 requirements。

`test/acceptance.yaml` 是验收状态**唯一真相**。README 只保留 ID + 一句话标题，禁止复制 criterion / expected / status / evidence。BA 改范围时改 yaml 的 `criterion`；测试只改 `status` / `evidence`；开发改 `command_or_path`。`done` 之后 yaml 冻结。一条在途提案建议 5～12 条阻塞项。`test/reports/` 只是证据附件，不是第二套验收表。

提案根上只留 `README.md`。内部按角色分夹，**不要**在 `proposals/` 外再开 `designs/` 或 `tests/`：

```text
Pxxx-name/
├── README.md              # 文首 YAML + 开发入口 + 范围/非目标/波及摘要
├── req/                   # 可选：BA 需求附录；没有就不建
├── design/                # 方案设计（未实现）；勿与 docs/design/ 现行 4A 混淆
└── test/                  # acceptance.yaml + 可选 reports/、案例
```

## 开发怎么找到该读的东西

实现 `Pxxx` 时只走这一条人工路径：

1. `.teamai/docs/product/roadmap/in-progress/` 确认它仍是进行中。
2. 打开 `.teamai/docs/proposals/Pxxx-name/README.md` 顶部的状态行和 **开发入口** 表。
3. 按表去读 `test/acceptance.yaml`、`design/`、指定原型。
4. 原型识别：
   - `hi-fi/` = 当前增量，随时会变；
   - `snapshots/<id>/` = 冻结历史；`SNAPSHOT.md` 写提案、kind、相对上一版；
   - `kind=acceptance` 且提案 `prototype-snapshot` 指向它 → 实现对照此版；
   - `kind=increment` → 过程档，不是交付基线。
5. 账本 [`prototypes/VERSIONS.md`](./prototypes/VERSIONS.md) 用提案号 + kind 把版本串起来。

不要从聊天记录、最新 hi-fi 或 done 提案里「顺手抄」未列入开发入口的内容。不在 `in-progress/` 的条目不要当当前任务。

## 角色链（人怎么交接）

对照协作图：[od-coteamai-role-flow.png](./diagrams/od-coteamai-role-flow.png)。上半是 AI 怎么被约束；下半是人怎么 `@` 交接。AI **不是**第五工种，是当前角色的搭档，必须走该角色的入口和产出。

```text
@需求(BA) → @高保(BA) → @方案设计(开发) → @实现(开发) → @测试
```

需求、高保、方案设计是三件不同的事。前两棒由 **BA**（产品语言 + 交互）；方案设计由 **开发**（怎么做）。不要让 BA 写模块/接口/数据流。`gates.hi-fi=none` 时可跳过高保棒；跨端或改模块边界时**不能**跳过方案设计。

聊天里用 `@角色` 表示交接。未回写 Pxxx 的口头结论不能当作下一棒的输入。

| 棒 | 谁做 | 目标 | 先打开 | 产出 | 交给谁 |
|----|------|------|--------|------|--------|
| **需求** | BA | 锁给谁、做什么、不做什么、怎么验收 | `product/roadmap/` · 提案 README · 可选 `req/` | 挂条、范围/非目标、yaml `criterion`、开发入口骨架 | `@高保设计` |
| **高保设计** | BA | 交互可对照 | `prototypes/hi-fi/` | hi-fi / acceptance 快照 | `@方案设计`（开发） |
| **方案设计** | 开发 | 技术怎么做可对照 | 提案 `design/` + 高保 | `design/`、OpenAPI 草案、开发入口代码落点 | 同一 Role 进入实现 |
| **实现** | 开发 | 按开发入口改代码 | 方案 + 指定原型 + OpenAPI | FE / BE / dsh；architecture 同提交 | `@测试` |
| **测试** | 测试 | 判定能否上线 | `test/acceptance.yaml` + snapshot | 只改 `status` / `evidence` | pass 后回写 requirements |

`architecture.html` 不是方案设计产出，只写**已实现**事实，跟代码同提交。未实现方案留在提案 `design/`。

同一人可兼多角，但**不能跳棒**：没有验收 ID 就不要开高保；没有方案（该有的时候）就不要写产品代码；代码合入不能代替 yaml `pass`。

### teamai Roles（`manifest/roles.yaml`）

交接仍是五棒；**skill 只分三个工种**。方案设计挂在 `dev`，不挂在 `ba`。

| teamai Role | 覆盖的交接棒 | pull 到的 skills |
|-------------|--------------|------------------|
| `ba` | 需求 + 高保设计 | `common` + `ba`（`od-write-proposal`、`od-hi-fi`） |
| `dev` | 方案设计 + 实现 | `common` + `dev`（`od-solution-design`、`od-implement-proposal`） |
| `test` | 测试 | `common` + `test`（`od-acceptance`） |

`common`：`od-rd-loop`、`od-local-verify`。Rules / Docs 仍全员可见。

```bash
teamai roles set ba
teamai roles set dev
teamai roles set test
teamai roles set ba --add dev   # 兼 BA + 开发
teamai pull
```

| 棒 | 不要做 |
|----|--------|
| 需求（BA） | 写 `design/` / OpenAPI / 类名级落点；把未确认方案写成已接受 |
| 高保（BA） | 改冻结 `snapshots/`；用高保代替技术方案 |
| 方案设计（开发） | 改 `criterion` 或产品范围；把未实现方案写进 4A / requirements；未写方案就改产品代码 |
| 实现（开发） | 从聊天或最新 hi-fi 猜范围；未 pass 写入 requirements / 4A |
| 测试 | 改 `criterion`；用「代码已合」替代产品验收 |

### AI 工作流（对应图上半）

| 步 | 本仓落点 | 做什么 |
|----|----------|--------|
| 1 配置 | `AGENTS.md` · `process.md` · `.teamai/rules/` | 原则 + 工具边界（可读 docs、可写提案与代码、禁改 snapshots） |
| 2 角色 | 交接五棒；teamai Role 三个（`ba` / `dev` / `test`） | 每个交接棒有目标 / 入口 / 产出；skill 按 Role 裁剪 |
| 3 模型 | 人自选 Cursor / Claude / Codex 等 | 不锁模型 |
| 4 I/O | 输入：`@`、roadmap、Pxxx、hi-fi、OpenAPI、代码；输出：回写提案、快照、契约、PR、4A、yaml | 只经 `.teamai/docs/` 进出，不另立门户 |
| 5 触发 | 条目在 `in-progress/` · 对应 gate · **人确认** | 条件不齐不执行下一棒 |
| 6 动作 | 写 Pxxx、打快照、改 OpenAPI、改代码、改 yaml status | 见「新需求主路径」 |
| 状态 | `.teamai/docs/` + git | 上下文=当前 Pxxx；变量=`gates`；历史=snapshots 与 tag |

## 角色入口（按文件）

| 角色 | 先打开 | 只回答 |
|------|--------|--------|
| 规划 | `product/roadmap/` 各状态夹 | 进行中 / 已完成 / 计划中有什么 |
| BA | 提案 README 范围 / 非目标 / 流程 · 可选 `req/` | 边界、用户怎么走、验收 ID（不写技术方案） |
| 高保设计 | `prototypes/hi-fi/` 或指定 snapshot | 对照哪版交互 |
| 方案设计 | 提案 `design/` · `openapi.yaml` | **开发**写：流程、模型、边界、契约 |
| 开发（实现） | README「开发入口」（方案补全后） | 对照哪版、改哪些代码、回归哪些 ID |
| 测试 | `test/acceptance.yaml` | 能否复现、是否阻塞上线 |
| AI | 根目录 `AGENTS.md` + `.teamai/rules/`，然后与人对同一条链 | 当轮落盘；未 pass 不写 requirements |

## Co-TeamAI（teamai 单仓）

人与 AI 用同一棵契约树。Harness 与契约都在 `.teamai/`：

| 路径 | 角色 |
|------|------|
| `.teamai/docs/` | 本文件所在树：产品 / 提案 / 4A / 高保 |
| `.teamai/rules/` | 注入 Cursor / Claude 等的短规则 |
| `.teamai/skills/` | 按 Role 分命名空间：`common/` · `ba/` · `dev/` · `test/`；清单见 `manifest/roles.yaml` |
| `.teamai/learnings/` | 0→1 会话踩坑（先对齐、高保端口、三轨对话、质量闸、权限）；也可 `teamai contribute` 续写 |
| `.teamai/culture.md` | 团队文化，pull 时注入 |

成员：clone 后 `teamai init .`（已认证会自愈）。日常会话自动 `pull`。skills/rules 用 `teamai push` 开 PR；**docs / hooks / mcp 用普通 git commit**。

不要 `teamai uninstall` 清 docs。不要用符号链接把 `docs` 指到别处。不要在仓库根再放一份 `docs/`。

## 按状态推进

当前开发只看 [`roadmap/in-progress/`](./product/roadmap/in-progress/)。计划中、搁置、已完成、不做各是独立一夹，每夹只有一份 README。不要按月再建文件。

```text
立项    需求：在 planned/ 或 in-progress/ 挂条
高保    交互：gate=hi-fi → acceptance 快照
方案    技术：提案 design/ + 跨端 OpenAPI 草案
实现    代码；PR 带 Pxxx；architecture 同提交
验收    yaml 阻塞项 pass 才回写 requirements
交付    该行挪到 done/；未做完保持 in-progress
```

过程产物不要平行繁殖：排期用状态夹，**需求**用提案 README（附录进 `req/`），**交互**用 snapshot，**方案**用 `Pxxx/design/`，契约用 OpenAPI，可否上线用 `test/acceptance.yaml` 的 `status`，已上线用 requirements + tag。

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
| Co-TeamAI harness（rules/skills/culture） | 改 `.teamai/`；契约正文仍只在 `.teamai/docs/` |

## 版本分层

| 层 | 机制 | 干什么 |
|----|------|--------|
| 产品里程碑 | 提案 `milestone` + `roadmap/<状态>/` | v0.x 要交付哪些 Pxxx |
| 当前进度 | `roadmap/in-progress/README.md` | 正在做的条目与当前验收 ID |
| 交互 | `VERSIONS.md` + snapshots | `increment` 过程档；`acceptance` 实现对照 |
| 发版 | git tag（如 `v0.5.0`） | 整仓回放，含当时的 requirements |

**不**维护多份 `requirements-v0.x.md`。旧基线：`git show v0.4.0:.teamai/docs/product/requirements.md`。

## 实例摘要

**分享加密码（跨端）**：roadmap 挂条 → P00x 内写需求与设计 → 接受后先改契约再实现 → 验证时同步 architecture → 验收后写 requirements → P00x done。

**画布吸附（纯前端）**：小改可无 proposal；先实现与验收，仅当改变应用边界或长期能力时更新 architecture/requirements。

**对话分析（P004）**：见 [proposals/P004-conversation/](./proposals/P004-conversation/)。

**出板结果卡披露（P015 / PR-REAL-23）**：已在 in-progress 的能力缺口，**不要新建 Pxxx**。BA 回写范围与 `criterion`；`hi-fi: none` 可跳过高保；开发写 `design.md` §11.4（`board_ready.charts[]`，不改 OpenAPI）；实现对照开发入口改 harness 对话卡；测试只改 yaml `status`/`evidence`。走位见 [P015 README 本切片](./proposals/P015-board-task-realize/README.md#开发入口)。

**产品壳 / 工作台留白（P007）**：见 [proposals/P007-app-shell/](./proposals/P007-app-shell/)；高保入口 [`prototypes/hi-fi/workbench.html`](./prototypes/hi-fi/workbench.html)。

## 高保原型（`.teamai/docs/prototypes/`）

高保是文档资产，放在 **`.teamai/docs/prototypes/`**（仓库根不再单开 `prototypes/`）。

| 路径 | 角色 |
|------|------|
| [`prototypes/hi-fi/`](./prototypes/hi-fi/) | **当前增量**，可改 |
| [`prototypes/snapshots/`](./prototypes/snapshots/) | 历史冻结，只读；看 `SNAPSHOT.md` 的提案 / kind / 相对上一版 |
| [`prototypes/VERSIONS.md`](./prototypes/VERSIONS.md) | 版本账本，用 Pxxx 识别 |

预览：`.teamai/docs/prototypes/hi-fi/start.sh`。入口 [workbench.html](./prototypes/hi-fi/workbench.html)。

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
cd .teamai/docs/prototypes
./snapshot.sh 2026-08-17-p007-app-shell "P007 左栏壳" P007 increment
./snapshot.sh 2026-08-17-p007-app-shell-final "P007 高保定稿" P007 acceptance
```

- `id` = `YYYY-MM-DD-<slug>`，slug 含提案号。
- `increment`：继续改 hi-fi 之前的过程档。
- `acceptance`：该提案高保验收基线；必须写进提案 `prototype-snapshot`。
- 快照**不含** `vendor/`。
- **禁止**改 `snapshots/` 里的文件；要继续改，回 `hi-fi/` 再打新快照。
- 产品 git tag 仍管整仓；高保用 VERSIONS + snapshots 对照交互演进。
