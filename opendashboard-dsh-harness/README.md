# Open Dashboard · dsh conversation harness (P011)

对话 UI + Agent 运行时：npm 锁 `@deepseek-ai/dsh@0.1.1-rc.2`，本仓薄插件挂在 profile `od-conversation`。

> 开发入口：[P011 README](../.teamai/docs/proposals/P011-dsh-conversation-surface/README.md) · [migration](../.teamai/docs/proposals/P011-dsh-conversation-surface/migration.md) · [架构图](../.teamai/docs/proposals/P011-dsh-conversation-surface/dataq-dsh-harness-architecture.png)

## 产品边界（BI 模式）

本服务是 **问数 + 仪表盘生成** Agent，不是 coding harness：

- 已禁用：`bash` / `fs` / `fs-search` / 改文件 / `agent-instructions`（不读仓内 `AGENTS.md`）/ `skill-filesystem`
- 进程 **cwd** = `$DSH_HOME/runtime`（空沙箱，不挂 monorepo）
- 每轮注入的是 **OD workspaceId / userId**，不是本机路径
- 写看板唯一出口：worker <code>od_commit_board</code>（或 last-resort <code>od_generate_board</code> / <code>od_emit_patch</code>）→ Java <code>apply-patch</code>

正式部署应跑在服务器/容器内，镜像不挂业务源码；用 Nginx 把 dsh 的 `/plugins` `/assets` 与 dsh `/api` 和 Java `/api` 分开。

## 要求

- Node `^22.19 || >=24`
- pnpm 11+

## 启动

```bash
cd opendashboard-dsh-harness
pnpm install
pnpm approve-builds --all   # 首次：允许 node-pty / koffi 等原生构建
./start.sh
# → http://127.0.0.1:3090/
```

本地默认 `OD_DSH_BRIDGE` 绑定 stub 演示租户 `demo` / `workspace-retail`（可覆盖）。

## 真实用户怎么用（启动后）

前提：OD 前端 + Java BI + 本 dsh 都已启动；用户已登录；当前工作区里有**有权限的数据集**（管理端建好数据源/数据集，或数据广场可见）。

| 场景 | 用户操作 | 系统行为 |
|------|----------|----------|
| **问数出表** | 左栏「对话分析」→ 自然语言，如「华东本月 GMV 同比」 | Agent：`od_list_datasets` → schema → `od_run_query` → 对话里出表 |
| **问数出图** | 「按城市画柱状图」等 | 同上，带 `chartType` → `od-answer-chart` 预览（含轴标签、可点柱、可展开 SELECT） |
| **澄清/空数据** | 工作区无数据集或问题含糊 | Agent 说明 `datasets(0)` 或追问；用户去配数据后再问 |
| **一句话生成看板** | 「用销售数据生成一张经营看板」 | Agent：`od_plan_charts`（对话列出分析任务，图种待取数后定）→ 确认后 `od_board_worker` 按任务取数再选图并写入 draft → **右侧展开完整编辑器** |
| **新开对话** | 会话顶栏右上 **「新对话」**（落地页也始终可见） | `workspaces.startSession(odWorkspaceId)` → 空白会话落地页 |
| **看历史会话** | 顶栏 **「历史」** / 落地「最近对话」（[P014](../.teamai/docs/proposals/P014-conversation-history/)） | `GET /od/sessions` → `sessions.open`；分区键 `od:{workspaceId}:{userId}`（`$DSH_HOME/tenants/…`），不跟 Agent cwd |
| **看上下文** | 顶栏 **「上下文」** Tab，或输入 `/context` | `dsh-context`：当前窗口组成（系统提示 / 工具 schema / 消息）与演变 |
| **看轨迹** | 顶栏 **「轨迹」** Tab | `ui-trajectory`：本轮工具调用与步骤回放 |

用户**不用**选手动工具；不进源码目录。数据集管理、画布精修仍在 OD 其它模块。

斜杠命令（`/`）：`/datasets` 选数据集 · `/ask` 问数 · `/board` 生成仪表盘 · `/context` 看窗口组成；菜单里隐藏 compact/plan/permission 等 coding 命令（保留 `/model`）。

## 嵌入 OD 前端

本地开发默认 iframe **直连** `http://127.0.0.1:3090/`（见 `VITE_OD_DSH_URL`）。  
不要指望只反代 `/dsh/`：dsh Web 还会请求同源绝对路径 `/plugins/*`、`/assets/*`、以及 **`/api/*`（dsh 自身 RPC/WS）**，会与 Vite 的 `/api` → Java 冲突。

| 变量 | 说明 |
|------|------|
| `VITE_OD_DSH_URL` | 默认开发 `http://127.0.0.1:3090/`；生产可配同域路径 |

高保原型（无 Agent）：`.teamai/docs/prototypes/hi-fi/start.sh` → `conversation-ask-dsh.html`。

| 变量 | 默认 | 说明 |
|------|------|------|
| `DSH_HOME` | `./dsh-home` | 会话持久化与 profile 根 |
| `OD_DSH_RUNTIME_CWD` | `$DSH_HOME/runtime` | 会话沙箱 cwd（勿指到业务 git 仓） |
| `OD_DSH_PORT` | `3090` | Web 端口 |
| `OD_BI_BASE` | `http://127.0.0.1:8082` | Java BI |
| `OD_APP_ORIGIN` | `http://127.0.0.1:5173` | Vue 壳；看板「全屏编辑器」与直连 `:3090` 时「在右侧打开」跳到这里 |
| `OD_INTERNAL_TOKEN` | `od-dev-internal` | internal 鉴权 |
| `OD_DSH_BRIDGE` | 本地默认 demo/workspace-retail | JSON：`userId` / `workspaceId` / `perms`（生产应换短时签发） |

FE 嵌入：开发直连 `:3090`；生产同域反代。编辑器侧栏同为 dsh embed。  
`cordis.patch.yml` 关掉 dsh 自带侧栏 / brand / workspace / agent-preset chrome，避免和 OD AppShell 双左栏。  
`dsh-od-nodes` 落地页：slogan「问数成图，一语成板」+ 徽章「对话分析」；隐藏本地目录选择与 Workspace Write。

## 工具链摘要

- **问数**：`od_list_datasets` → `od_get_schema` → `od_run_query` / `od_run_sql` → `od_finish`
- **生成看板**：`od_list_datasets` → **`od_plan_charts`**（对话可见任务，不定图种）→ **`od_board_worker`**（`od_get_data` / `od_data_trans` / `od_save_chart` / `od_commit_board`；选图由 harness；禁止 Lead 调用 `od_run_sql` / `od_layout_board`）
- 单测：`pnpm test`

## 包结构

| 路径 | 职责 |
|------|------|
| `packages/dsh-od-bi` | Host：问数 + gen → Java |
| `packages/dsh-od-auth` | Bridge + 每轮 OD 工作区上下文注入 |
| `packages/dsh-od-nodes` | Client：表 / 图 / 看板预览 Node；embed 压掉空侧栏列 |
| `packages/dsh-od-bundle` | profile：裁剪 coding、BI persona |
| `dsh-home/profiles/od-conversation` | profile（含 [`dsh-context`](https://github.com/bowenliang123/dsh-context)） |

## 与旧 Python harness

**已删除**（P011 M4）。对话 Agent 仅本目录；FE 无 `/harness`。
