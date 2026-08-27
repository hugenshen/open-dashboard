---
id: P014
title: 对话页可查看并打开历史会话
status: in-progress
milestone: v0.6
date: 2026-08-24
prototype: .teamai/docs/prototypes/hi-fi/conversation-ask-dsh.html
design: [.teamai/docs/proposals/P014-conversation-history/design/design.md]
acceptance: .teamai/docs/proposals/P014-conversation-history/test/acceptance.yaml
gates:
  proposal: accepted
  hi-fi: wip
  code: wip
  acceptance: none
depends: [P011, P007, P009]
implementation:
  - opendashboard-dsh-harness/packages/dsh-od-auth/
  - opendashboard-dsh-harness/packages/dsh-od-nodes/
  - open-dashboard-frontend/src/conversation/views/ConversationDshSurface.vue
---

# P014 · 对话页可查看并打开历史会话

> **状态** `in-progress` · 路线图 [进行中](../../product/roadmap/in-progress/) · 高保 wip · 代码 wip   
> 对话主表面仍是 dsh（P011）。本提案只补 **「在 `/conversations` 看见并打开自己的历史」**，不重做 Composer。

## 开发入口

| 你要 | 去看 |
|------|------|
| 范围与非目标 | 本文 |
| 交互 / 索引模型 / 切会话 | [design.md](./design/design.md) |
| 怎么验收 | [acceptance.yaml](./test/acceptance.yaml) |
| 当前增量 | [`conversation-ask-dsh.html`](../../prototypes/hi-fi/conversation-ask-dsh.html)（顶栏「新对话 / 历史」+ 历史抽屉） |
| 产品壳 | [`conversation.html`](../../prototypes/hi-fi/conversation.html) 嵌上述页 |
| 代码落点（实现时） | `ConversationDshSurface.vue` · `opendashboard-dsh-harness`（`/od/sessions` + 按 user/workspace 索引） |
| 不要做 | 恢复 Vue 自研对话流；打开 dsh 左栏会话树；用 Java `de_conversation` 当聊天气泡真相 |

## 波及

| 列 | 内容 |
|----|------|
| 依赖 | P011 dsh 表面；P007 AppShell；P009 当前 `userId` / `workspaceId` |
| 改动面 | FE `/conversations` 壳层历史入口；dsh 会话索引（不再按进程 cwd） |
| 不改 | 仪表盘画布；`od_*` 问数/出板；P013 模板市场 |
| 回归 | P011 新对话仍收起右侧编辑器；P007 左栏不出现第二套会话树 |
| 替代 | P011「历史只藏在 iframe 顶栏小菜单、会话跟 cwd」的产品表面 |

## 给谁 · 要解决什么

分析师进 `http://127.0.0.1:5173/conversations`（或同路径生产入口），要能 **列出自己在本工作区的历史对话并点开回放**，而不是只能对着空白落地页重问。

现状失败原因（代码事实，不是猜测）：

- P011 关掉 dsh `ui-sidebar`，历史缩成 iframe 里一个「历史」下拉，壳层没有入口。
- `start.sh` 把 Agent cwd 固定到空沙箱 `dsh-home/runtime`，dsh 按 **文件系统路径** 隔离会话；旧会话在 `sessions/--Users-shen-backdashboard--/`，当前工作区对不上，列表为空。

## 范围

**做**

- `/conversations` **始终**露出「新对话」「历史」（落地页也要有，不只运行中会话）
- 历史列表：当前登录用户 + 当前工作区；标题用用户问过的问题（或已生成的会话标题），更新时间、是否空白会话。**禁止**把 `session-` 这类内部 ID 当标题。
- 点一条 → iframe 打开该 dsh session（聊天气泡 + 表/图 Node）；有过出板则再 `od-open-dashboard`
- 会话索引按 `userId + workspaceId`，**不**按本机目录
- 空态写「暂无历史会话」，禁止用 Java 会话 CRUD 失败伪装成没有记录

**不做**

- 跨工作区翻别人的会话
- 用 Java 消息表重绘思考过程（回放仍走 dsh session log）
- 搜索全文 / 文件夹 / 分享一条对话链接（二期）
- 恢复 P004 Vue `ConversationWorkspace` 作为主表面

## 修订记录

| 日期 | 说明 |
|------|------|
| 2026-08-24 | 立项：用户确认 `/conversations` 必须能看历史；P011 done 后新开本号 |
| 2026-08-24 | 用户确认：刷新 `/conversations` 必须恢复当前会话，禁止无条件落到空白落地页；仅「新对话」才重置 |
| 2026-08-25 | 用户确认：落地「最近对话」必须展示用户历史问题，禁止 `session-` 内部 ID 当标题（PR-HIST-07） |
| 2026-08-26 | 对话分析不再暴露 dsh「绑定工作区」：租户分区启动即绑定，空 bridge 保留默认；与 P016 PR-ANR-11 同一行为 |
