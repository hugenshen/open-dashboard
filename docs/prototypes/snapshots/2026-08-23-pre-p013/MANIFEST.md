# hi-fi 页面清单

按**模块拆文件**（[P007](../../proposals/P007-app-shell/)）。壳层只改 `shared/shell.js` / `shared/shell.css`。

本目录是**当前增量**。实现已定稿提案时，以该提案 `prototype-snapshot` 为准（P007 对照 [`../snapshots/2026-08-17-p007-app-shell-final/`](../snapshots/2026-08-17-p007-app-shell-final/)），不要把这里尚未冻结的改动当成需求。版本关系见 [VERSIONS.md](../VERSIONS.md)。

| 文件 | 模块 | 状态 |
|------|------|------|
| `index.html` | 高保统一入口（登录、用户端、管理端、端到端链路） | in-progress · P009 / P010 |
| `shared/shell.css` · `shared/shell.js` | 左栏 + 顶栏产品壳（各页统一引用） | current · P007 |
| `shared/auth.css` | 登录 / 注册 / 账号设置共用样式 | in-progress · P009 |
| `shared/commercial.css` · `shared/commercial.js` | 数据源 / 数据集 / 仪表盘 / 报告 内核 | current |
| `login.html` | 登录、SSO 示意、忘记密码、退出后提示 | in-progress · P009 |
| `register.html` | 注册、邀请码加入工作区、创建工作区 | in-progress · P009 |
| `account-settings.html` | 账号设置、修改密码、登录安全、通知偏好 | in-progress · P009 |
| `workbench.html` | 工作台 | current · P007 交互真相 |
| `conversation.html` | 对话问数（**左栏 = 与 workbench 同一套 od-rail**；内容区嵌 dsh 问数） | accepted · P011 |
| `conversation-ask-dsh.html` | 问数交互面（仅右侧：dsh 对话 / 表图 Node；`embed=1` 供壳嵌入） | accepted · P011 |
| `data-market.html` | 数据广场（用户端：企业资产 / 我的资产 / 可申请 / 申请中） | in-progress · P008 / P009 |
| `datasource.html` | 数据源 | current |
| `dataset.html` | 数据集 | current |
| `knowledge.html` | 知识库（管理端：候选/指标/词表/问法/记忆） | in-progress · P010 |
| `workspace-admin.html` | 成员权限（管理端：工作区/用户/角色/数据/工具/审计） | in-progress · P009 |
| `dashboard.html` | 仪表盘列表（表优先 + 点行进画布）/ 编辑器 / 预览 | current · 列表交互增量 |
| `report.html` | 报告列表（表优先 + 点行进文档）/ 编辑器 | current · 列表交互增量 |
| `conversation-workspace.html` | 旧自研对话壳（生成/对照）；问数主路径已迁 `conversation-ask-dsh.html`；定稿见 P006 快照 | reference · P004 / P006 |
| `dashboard-commercial.html` | 旧 hash 入口，重定向到上列模块页 | compat |
| `dashboard-feishu.html` | 飞书气质 | reference · 不驱动新交互 |

图表数据/样式内核以产品 `open-dashboard-frontend/src/dashboard/hifi/editorCore.js` 为准。

大改或发版前按 [process.md](../../process.md) 打快照到 `../snapshots/`，账本 [`../VERSIONS.md`](../VERSIONS.md)。

> `./start.sh`；入口 `index.html`。资源页顶栏不问数。
