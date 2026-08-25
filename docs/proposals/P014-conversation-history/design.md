# P014 设计：`/conversations` 历史会话

> 未实现详细设计。实现对照本文 + [acceptance.yaml](./acceptance.yaml)；高保增量 [`conversation-ask-dsh.html`](../../prototypes/hi-fi/conversation-ask-dsh.html)。

## 1. 产品表面

你现在看到的 **居中口号 + 大输入框**（「问数成图，一语成板」）就是正常的 **新对话落地页**。问数、出板都从这里发。左侧 DataQ 模块栏只负责换模块，不放会话列表。

历史放在 **这块白画布里**，两处同一份数据：

```
┌ 左栏（不动）─┬──────── 对话白画布（dsh）─────────────────────────┐
│ 工作台       │  对话 | 轨迹 | 上下文          [新对话] [历史]     │  ← 画布右上角
│ 数据广场     │                                               │
│ 对话分析 ●   │           问数成图，一语成板  内测                │
│ 仪表盘       │     ┌─────────────────────────────────────┐   │
│ …            │     │ 问一个数据问题，或是描述您生成的…     │   │  ← 主交互
│              │     │  +                    模型  ↑        │   │
│              │     └─────────────────────────────────────┘   │
│              │     最近对话                                   │  ← 落地页可见列表
│              │     · 华东本月 GMV 同比？          今天 14:12  │
│              │     · 用销售明细生成经营看板        昨天       │
└──────────────┴───────────────────────────────────────────────┘
```

点 **历史**：在按钮下方弹出抽屉（约 300px），列出本用户本工作区会话；再点一行打开那条对话（界面变成气泡流，不再是落地页）。

发过一条消息之后：口号和「最近对话」消失，顶栏 **新对话 / 历史** 仍在右上角（有会话标题时标题在左）。出板后右侧仍嵌编辑器（P011）。

| 入口 | 行为 |
|------|------|
| **输入框** | 本页主交互：问数或描述出板 |
| **历史** | 打开列表面板；再点一行 → `sessions.open(id)`，关面板 |
| **新对话** | 回到本落地页；收起右侧看板（`od-session-changed`） |
| **最近对话** | 只在落地页输入框下方，3～5 条，与抽屉同一数据 |
| 工作台「最近问数」 | 可继续走 Java `GET /api/conversations?limit=8` 作摘要；点进后的回放以 dsh session 为准 |

**不放：** 产品左栏第二列、dsh 自带会话树（会和模块栏叠两套）。

现行 `:5173` 看不到入口，是因为落地页把会话顶栏/标题簇藏掉了，「历史」只挂在那条顶栏上。P014 要让 **落地页右上角也始终有这两个按钮**。

## 2. 数据谁说了算

| 层 | 职责 |
|----|------|
| **dsh session log**（`$DSH_HOME/sessions`） | 聊天气泡、思考、工具、表/图 Node、轨迹。打开历史 = 打开这条 log |
| **OD 会话索引** | `userId + workspaceId` → `[sessionId, title, updatedAt, blank]`。列表只读索引 |
| **Java `de_conversation*`** | 工作台摘要、revision/出板关联；**不是** `/conversations` 历史列表的主数据 |

禁止：列表只查 Java、点开却是另一套空 dsh session。

## 3. 索引键（相对 P011 的修正）

P011 为禁止 coding agent 扫 monorepo，把 **Agent cwd** 设成空沙箱 `dsh-home/runtime`。这是对的。错的是让 **dsh workspace / session 分区** 也跟这份 cwd 走，导致换目录启动后历史消失。

| | P011 现状 | P014 |
|--|-----------|------|
| Agent 沙箱 cwd | `DSH_HOME/runtime`（空） | **保持** |
| Session 分区 | 路径 `--Users-shen-backdashboard--` 一类 | **`od:{workspaceId}:{userId}`**（来自登录 bridge，不是磁盘路径） |
| 列表 API | 无（仅 iframe 内存 `useSessions`） | dsh `GET /od/sessions`（须已 POST `/od/bridge`） |

实现要点：

1. iframe 启动仍 POST `/od/bridge`（已有）。
2. Host 用 bridge 的 `userId`/`workspaceId` 选/创建 dsh workspace，**不要** `path = process.cwd()`。
3. 新会话写入该 workspace；`GET /od/sessions` 只返回该键下、非 subagent 的会话，按 `updatedAt` 降序，上限 40。
4. 未登录 / 无 workspace：接口 401，壳层提示去登录，不展示演示租户的会话。

无新的 Java OpenAPI 路径（除非后续要把索引双写进 PG；本期不做）。

## 4. 切会话与壳状态

已有：`od-session-changed` → 壳收起 `?dashboardId=`。

补：

- 打开历史会话后，若该 session 已有 `board_ready`，Node 再 `od-open-dashboard`（P011 已有）。
- 壳层点历史某一行：向 iframe `postMessage({ source: 'opendashboard-shell', type: 'od-open-session', sessionId })`；dsh 插件调 `sessions.open`。
- `ConversationDshSurface` **不要**因为 `route.params.id` 变化去改 iframe `src`（会丢当前线程）。Java conversationId 若还在 URL，只作可选深链，能解析到 dsh sessionId 再 open；解析不到则忽略，不新建空会话覆盖历史。
- **刷新保留当前会话**：iframe 重载后必须恢复「上次打开的会话」；若无记忆则打开该租户下最近一条非空/进行中会话。**禁止**在刷新时无条件 `startSession` 落到空白页——只要用户没点「新对话」，进行中的回复线程仍要接回画面（Agent 在后台继续跑时尤其如此）。「新对话」才刻意回到落地页。

## 5. 本机旧数据

开发机上已有 `dsh-home/sessions/--Users-shen-backdashboard--/` 与 `storages/workspace.json`（path=`/Users/shen/backdashboard`）。

本期 **不保证**自动把那 24 条挂到任意登录用户。可选一次性迁移（非阻塞验收）：仅当当前 workspace 索引为空、且磁盘上只发现一套旧 cwd 会话时，把该 workspace 的 `path` 改写为 `od:{workspaceId}:{userId}` 并记日志。多用户/多套旧目录则不迁，避免串会话。

## 6. 不做的方案

| 方案 | 为何不做 |
|------|----------|
| 打开 `ui-sidebar` | 与 AppShell 双左栏；P011 已否 |
| 仅加大 iframe「历史」下拉 | 落地页顶栏常被藏掉；cwd 问题仍在 |
| Vue 拉 Java 消息重绘 | 无思考流 / Node，且 P011 已切走 |
| 改回 Agent cwd=仓库根 | 会重新挂上 monorepo，违反 BI 模式 |

## 7. 成功标准

反链 [acceptance.yaml](./acceptance.yaml) 的 `PR-HIST-01`…`PR-HIST-06`。不要另造一套验收。
