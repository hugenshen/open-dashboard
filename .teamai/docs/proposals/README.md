# 提案索引与全链路映射

未交付的**需求、交互、技术设计、契约变化和验收**都写在对应提案目录（根 README 是地图；内部按角色分 `req/` · `design/` · `test/`）。实现并验收后，稳定架构沉淀到
[`architecture.html`](../design/architecture.html)，已交付能力写入
[`../product/requirements.md`](../product/requirements.md)。`done` 提案只保留决策历史。

协作规则见 [`../process.md`](../process.md) · 使用说明 [`../guide.html`](../guide.html) · 路线图 [`../product/roadmap/`](../product/roadmap/)。

提案目录按 **Pxxx 主键固定不搬家**。状态写在文首 `status` / `gates`，并与 `roadmap/<状态>/README.md` 一致。开发某个提案时，打开该目录的「开发入口」。

## 按状态

### 进行中（`accepted` / `in-progress`）

| Pxxx | 状态 | Gates（高保 / 代码 / 验收） | 里程碑 | 开发先看 |
|------|------|----------------------------|--------|----------|
| [P016](./P016-conversation-analysis-report/) 对话分析报告 | in-progress | wip / wip / partial | v0.6 | [README](./P016-conversation-analysis-report/README.md#开发入口) · [设计](./P016-conversation-analysis-report/design/design.md) |
| [P015](./P015-board-task-realize/) 对话式仪表盘规划、生成与质量闭环 | in-progress | none / wip / none | v0.6 | [README](./P015-board-task-realize/README.md#开发入口) · [端到端设计](./P015-board-task-realize/design/design.md) · [质量发布门](./P015-board-task-realize/design/quality-evaluation.md) · [`t_pay_order` 反例](./P015-board-task-realize/test/t-pay-order-case-study.md) |
| [P004](./P004-conversation/) 对话分析 | in-progress | wip / wip / blocked | v0.5 | [README](./P004-conversation/README.md#开发入口) · [4A 生成](../design/architecture.html#gen)（表面已由 P011 承接） |
| [P006](./P006-ask-data/) 对话问数 | in-progress | wip / wip / blocked | v0.5 | [README](./P006-ask-data/README.md#开发入口) · [4A 问数](../design/architecture.html#ask)（表面已由 P011 承接） |
| [P007](./P007-app-shell/) 产品壳与工作台 | in-progress | accepted / wip / blocked | v0.5 | [README 开发入口](./P007-app-shell/README.md#开发入口) |
| [P008](./P008-permission-aware-workbench/) 权限感知工作台 | accepted | wip / wip / none | v0.5 | [README 开发入口](./P008-permission-aware-workbench/README.md#开发入口) |
| [P009](./P009-workspace-governance/) 工作区隔离、用户体系与知识治理 | in-progress | wip / wip / none | v0.6 | [README 开发入口](./P009-workspace-governance/README.md#开发入口) |
| [P010](./P010-user-memory-ask-knowledge/) 用户记忆与问数知识库 | in-progress | wip / wip / none | v0.5 | [README](./P010-user-memory-ask-knowledge/README.md#开发入口) · [管理面](./P010-user-memory-ask-knowledge/design/management-design.md) |
| [P013](./P013-dashboard-page-templates/) 仪表盘页面模板 | in-progress | wip / none / none | v0.6 | [README](./P013-dashboard-page-templates/README.md#开发入口) · [`#/templates`](../prototypes/hi-fi/dashboard.html) |

### 计划中（`draft`）

| Pxxx | 状态 | 里程碑 | 说明 |
|------|------|--------|------|
| [P014](./P014-conversation-history/) 对话历史 | in-progress | v0.6 | `/conversations` 新对话/历史 + 按 userId+workspaceId 索引 dsh session |
| [P005](./P005-insight-report/) 洞察报告 | draft | v0.6 | 未接受，不要实现 |

### 已完成（`done`）

| Pxxx | 里程碑 | 4A | requirements |
|------|--------|-----|--------------|
| [P012](./P012-ask-gen-quality/) 对话出板 / 问数质量闸 | v0.6 | [问数](../design/architecture.html#ask) · [生成](../design/architecture.html#gen) | PR-QG-02…05 · PR-QG-09…12 |
| [P011](./P011-dsh-conversation-surface/) 对话表面迁到 dsh Web | v0.6 | [问数](../design/architecture.html#ask) · [生成](../design/architecture.html#gen) | PR-DSH-02…06 · PR-DSH-09 |
| [P001](./P001-mobile-layout-c/) 移动端布局 | v0.2 | [AA](../design/architecture.html#application) · [DA](../design/architecture.html#data) | PR-DASH-11 |
| [P002](./P002-vue-java-scaffold/) Vue + Java 脚手架 | v0.3 | [4A](../design/architecture.html) · [OpenAPI](../design/openapi.yaml) | NFR-05 |
| [P003](./P003-report-umo-charts/) 在线报告 | v0.4 | [BA](../design/architecture.html#business) · [AA](../design/architecture.html#application) | PR-RPT-01…07 |

下一号：`P017`。

> `.teamai/docs/design/` 只保留 `architecture.html`、检索用 `architecture.md` 与 `openapi.yaml`。提案详细设计不得复制回 `design/`。

## 开发怎么读一个提案

打开 `.teamai/docs/proposals/Pxxx-name/` 后按这个顺序：

| 顺序 | 文件 | 回答什么 |
|------|------|----------|
| 1 | `README.md` 文首 + 开发入口 | 状态、范围、先看哪份原型 |
| 2 | `test/acceptance.yaml` | 怎样算做完；hi-fi / code / acceptance 哪一层 |
| 3 | `design/` | 未实现的流程、模型、边界 |
| 4 | `req/`（若有） | 入口装不下的需求附录 |
| 5 | 原型 | `prototype-snapshot` = 冻结对照；`hi-fi/` = 尚未冻结的增量 |
| 6 | 实现时 | 跨端先改 `.teamai/docs/design/openapi.yaml`，再改代码，提交时更新 `architecture.html` |

识别规则：

- 提案 **状态标识** 只看文首 `status` 和 `gates`，不要看聊天或目录名。
- `hi-fi: accepted` 时，实现对照 **快照**，不是对照最新 hi-fi。
- `hi-fi: wip` 时，hi-fi 是增量工作区，尚未验收，不能当交付基线。
- `done` 提案只追溯；新需求新建 Pxxx。

## 单提案目录结构

```text
Pxxx-name/
├── README.md                 # 地图：文首 YAML、开发入口、范围/非目标/波及摘要、验收 ID
├── req/                      # 可选：BA 需求附录；没有就不建
├── design/                   # 方案设计（未实现）；勿与 docs/design/ 现行 4A 混淆
│   ├── design.md
│   └── *-design.md
└── test/
    ├── acceptance.yaml       # 机器可读验收清单；在途提案必须有
    └── reports/              # 可选：实测 dump；入口只链 latest
```

- Pxxx 目录永不搬家。根上只留 `README.md`。
- `README.md` 只回答做什么、为什么、边界、波及、如何验收（ID 列表）；长流程和技术细节链接到 `design/`；需求附录链接到 `req/`。
- `test/acceptance.yaml` 是验收状态唯一真相；README **只留 ID + 一句话**，禁止复制 criterion / status / evidence。`test/reports/` 是证据附件，不是第二套验收。
- `design/` 中的“成功标准”必须反链 README / acceptance ID，不得另造一套验收。
- `status: done` 只有在阻塞交付的验收项全部 `pass`、architecture 与 requirements 均已回写后才能设置。部分交付只回写已 pass 的 ID，提案保持 in-progress。
- 状态变更时：改文首 → 把该行挪到 `.teamai/docs/product/roadmap/<新状态>/README.md`。**不要移动本提案目录。**
- 当前开发范围以 `.teamai/docs/product/roadmap/in-progress/` 为准。
- 禁止在 `proposals/` 外再开 `designs/` 或 `tests/`；禁止 `archive/`。

## 提案文首元数据

```yaml
---
id: P009
title: 标题
status: draft | accepted | in-progress | done
milestone: v0.x
date: YYYY-MM-DD
prototype: .teamai/docs/prototypes/hi-fi/...         # 可选；当前增量
prototype-snapshot: .teamai/docs/prototypes/snapshots/... # 高保冻结后填写
design: [.teamai/docs/proposals/P009-name/design/design.md] # 可选；未实现详细设计
acceptance: .teamai/docs/proposals/P009-name/test/acceptance.yaml
gates:
  proposal: draft | accepted
  hi-fi: none | wip | frozen | accepted
  code: none | wip | merged
  acceptance: none | blocked | passed
architecture: .teamai/docs/design/architecture.html  # 实现后填写
contract: .teamai/docs/design/openapi.yaml            # 有跨 FE/BE 契约时填写
requirements: [PR-XXX-01]                    # 验收后填写
implementation: [open-dashboard-frontend/..., open-dashboard-backend/...] # 实现后填写
done: YYYY-MM-DD                             # done 时填写
---
```

## 提案正文固定结构

1. 开发入口（读什么、对照哪份原型、改哪些代码）
2. 背景与目标
3. 范围 / 非目标
4. 波及（依赖、改动面、回归 `PR-*`、不要动）
5. 产品需求与用户流程
6. 交互设计与原型
7. 技术设计与数据流
8. OpenAPI / 数据模型变化
9. 兼容、迁移与风险
10. 验收标准（仅 ID + 标题，细节在 yaml）
11. 实现与交付映射（完成时补）

## 验收准则格式

`acceptance.yaml` 每项固定字段：

```yaml
- id: PR-XXX-01
  title: 一句话说明
  gate: hi-fi | code | acceptance
  criterion: 可判定的前置条件、动作和期望结果
  method: manual | ui | api | script
  command_or_path: URL、API 或验证命令
  expected: 状态码、事件、页面结果或数据约束
  evidence: 截图、日志、快照或测试路径；未执行时留空
  status: todo | pass | fail | waived
  blocker_of_done: true
  requirements_target: PR-XXX-01 | null
```

硬规则：

1. `hi-fi: accepted` 只表示交互验收，不代表代码已交付。
2. `code: merged` 只表示实现存在，不代表产品验收通过。
3. `acceptance: passed` 且所有 `blocker_of_done: true` 项为 `pass`，才允许回写 requirements 和标记 `done`。
4. 验收描述必须能被复现，禁止只写“体验良好”“功能正常”“与设计一致”。
5. README 验收表不得复制 yaml 长文；状态与证据只在 yaml 更新。
