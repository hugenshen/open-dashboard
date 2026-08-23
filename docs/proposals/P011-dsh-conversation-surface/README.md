---
id: P011
title: 对话表面迁到 DeepSeek Harness Web
status: done
milestone: v0.6
date: 2026-08-21
done: 2026-08-21
prototype: docs/prototypes/hi-fi/conversation-ask-dsh.html
design:
  - docs/proposals/P011-dsh-conversation-surface/design.md
  - docs/proposals/P011-dsh-conversation-surface/migration.md
acceptance: docs/proposals/P011-dsh-conversation-surface/acceptance.yaml
gates:
  proposal: accepted
  hi-fi: accepted
  code: merged
  acceptance: passed
architecture: docs/design/architecture.html
requirements: [PR-DSH-02, PR-DSH-03, PR-DSH-04, PR-DSH-05, PR-DSH-06, PR-DSH-09]
depends: [P004, P006, P007]
replaces_ui:
  - open-dashboard-frontend/src/conversation/views/ConversationWorkspace.vue
  - open-dashboard-frontend/src/conversation/components/ConversationAiPanel.vue
keeps:
  - open-dashboard-backend/ (Java BI + conversations CRUD)
  - OD AppShell / 仪表盘编辑器
removes:
  - opendashboard-harness/
adds:
  - opendashboard-dsh-harness/
implementation:
  - opendashboard-dsh-harness/
  - open-dashboard-frontend/src/conversation/views/ConversationDshSurface.vue
  - open-dashboard-frontend/src/conversation/components/ConversationDshPanel.vue
---

# P011 · 对话表面迁到 DeepSeek Harness Web

> **状态** `done`（2026-08-21）· 对话主表面 = dsh；Python harness 已删。只追溯，不驱动新开发。运行入口：[`opendashboard-dsh-harness/README.md`](../../../opendashboard-dsh-harness/README.md)。

## 为什么开这条

P004/P006 的自研对话 UI（Composer、步骤折叠、结果卡）交互跟不上 DeepSeek Harness Web：思考流、工具卡、Todo/Plan dock、审批接管、steering/queue、会话 fork 等已经成型。决策改为：**问数与仪表盘生成的对话框直接用 dsh 的 UI 层 + Agent 层**；OD 不再维护平行对话壳。

## 开发入口

| 你要 | 去看 |
|------|------|
| **跑起来（M0）** | [`opendashboard-dsh-harness/README.md`](../../../opendashboard-dsh-harness/README.md) |
| 范围与边界 | 本文 |
| 技术切分 | [design.md](./design.md) |
| **迁移方案（波次/清单）** | [migration.md](./migration.md) |
| 问数高保（当前增量） | [`conversation-ask-dsh.html`](../../prototypes/hi-fi/conversation-ask-dsh.html) |
| 旧问数壳定稿 | [P006 快照 `2026-08-21-p006-ask-data`](../../prototypes/snapshots/2026-08-21-p006-ask-data/) |
| 验收 | [acceptance.yaml](./acceptance.yaml) |
| 旧 SSE 契约 | [P004 harness-design](../P004-conversation/harness-design.md)（迁移期对照；M4 删除 Python harness） |

## 范围

**做**

- 本仓新建 **`opendashboard-dsh-harness/`**：npm 锁版本依赖 `@deepseek-ai/dsh-*` + OD profile / `od_*` / Conversation Node
- OD 产品壳内嵌 / 路由到 dsh Web（一级「对话」入口）
- `od_*` → Java BI；表/图/看板 Node；写看板只经 `od_emit_patch` → `apply-patch`
- 鉴权：OD 登录态桥接到 dsh session（user/workspace/perms）
- sqlbot / 质检 / layout / deterministic **迁入本包 TS**（或必要闸门进 Java）
- 切流时 **删除** `opendashboard-harness/`（不设 Python sidecar）

**不做（本提案）**

- 用 dsh 替换仪表盘编辑器 / 数据集管理 / 报告
- 恢复 Java public adopt 或 Java 编排 Agent
- 整仓 vendor DeepSeek Harness 源码
- 长期并行保留 Python Agent / sidecar

## 波及

| | |
|--|--|
| 依赖 | P004 生成语义、P006 问数语义、P007 壳层入口 |
| 改动面 | 新建 `opendashboard-dsh-harness/`（锁 `@deepseek-ai/dsh-*`）；FE 对话嵌入 dsh；**删除** `opendashboard-harness/` |
| 回归 | P004 PR-CONV-*、P006 PR-ASK-*（事件从 SSE 改为 SessionEvent→ConversationNode，验收要改写） |
| 不要动 | 仪表盘画布真相、Java internal BI 写闸门、P007 左栏其它模块 |

## 修订记录

| 日期 | 说明 |
|------|------|
| 2026-08-21 | 立项草案：确认「对话 UI+Agent 直接用 dsh」，OD 自研对话壳退出主路径 |
| 2026-08-21 | 增补 [migration.md](./migration.md)：现状→目标、组件清单、会话策略、M0–M4 |
| 2026-08-21 | 拍板：包名 `opendashboard-dsh-harness`；直接删 Python harness，不设 sidecar |
| 2026-08-21 | 高保：问数对话框主区居中；产品壳顶栏账号固定右上角（plaza 空列不再把账号挤到正中） |
| 2026-08-21 | **开工 M0**：脚手架 `opendashboard-dsh-harness`（锁 `@deepseek-ai/dsh@0.1.1-rc.2`）；profile `od-conversation` 可起 Web；FE flag `VITE_OD_CONV_SURFACE=dsh` |
| 2026-08-21 | **M1**：`od_get_schema`/`od_run_query`；Client Node `od-answer-table`（meta 驱动） |
| 2026-08-21 | **M2**：`od_run_sql` + TS sql-guard；`od-answer-chart`；SQL 不进浏览器 meta |
| 2026-08-21 | **M3**：`od_profile_dataset` / `od_plan_charts` / `od_layout_board` / `od_emit_patch`；Node `od-board-preview` |
| 2026-08-21 | **M4**：默认 ConversationDshSurface；编辑器 ConversationDshPanel；删 `/harness` 与 `opendashboard-harness/`；PR-DSH-06…09 pass |
| 2026-08-21 | **done**：hi-fi PR-DSH-HI-01；architecture / requirements 回写；挪入 roadmap/done |
| 2026-08-21 | **BI 硬化（done 后修补）**：禁 `agent-instructions`/`skill-filesystem`；cwd=`DSH_HOME/runtime`；persona 非 coding；注入 OD workspace 上下文；用户场景见 harness README |
| 2026-08-21 | **对话分栏**：`od-board-preview` postMessage → `/conversations` 右侧嵌 `DashboardEditorHost`（embedded）；可全屏编辑 |
| 2026-08-21 | 斜杠命令：`/datasets` `/ask` `/board`；菜单过滤 coding 命令（保留 model/context） |
| 2026-08-21 | 落地页：slogan「问数成图，一语成板」/ 徽章「对话分析」；隐藏目录芯片与 Workspace Write；禁 `ui-agent-preset` |
| 2026-08-21 | 产品名 **DataQ**；IP 水獭 + soft Q 剪影；壳 / 登录 / 对话落地页换标 |
| 2026-08-22 | 出板/问数质量闸不回写本提案（done 只追溯）。后续 [P012](../P012-ask-gen-quality/)：M1 加厚 `od_generate_board` |
| 2026-08-22 | 生成对话路径恢复可见规划：`od_plan_charts` → `od_generate_board`（写入仍 one-shot；不恢复 layout/emit） |
| 2026-08-22 | 新对话/切会话：iframe `od-session-changed` → 壳收起右侧编辑器并去掉 `?dashboardId=` |
| 2026-08-22 | 产品表面：对话只留闲聊+结果卡；藏系统提示/工具卡/上下文/轨迹等 harness 控件 |
| 2026-08-23 | **还原顶栏**：用户确认恢复 **轨迹 / 上下文** Tab（`ui-trajectory` + profile bundle `dsh-context`，斜杠 `/context`）；对话流仍藏工具卡 |
| 2026-08-22 | 对话对外品牌统一 **DataQ**；禁止对用户说 Open Dashboard |
| 2026-08-21 | 产品壳标改为几何圆标（蓝底白 Q），与 DeepSeek 量级/气质对齐；水獭 IP 仅作营销素材 |
