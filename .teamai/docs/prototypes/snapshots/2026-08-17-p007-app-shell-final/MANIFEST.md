# hi-fi 页面清单

按**模块拆文件**（[P007](../../../proposals/P007-app-shell/)）。壳层只改 `shared/`。

| 文件 | 模块 | 状态 |
|------|------|------|
| `shared/shell.css` · `shared/shell.js` | 左栏 + 顶栏产品壳 | finalized · P007 |
| `workbench.html` | 工作台 | finalized · P007 交互真相 |
| `conversation-workspace.html` | 对话问数 | in-progress · P004 / P006 |
| `dashboard-commercial.html` | 数据源 / 数据集 / 仪表盘编辑器 / 报告 | current；**不要再往这里加新一级页** |
| `dashboard-feishu.html` | 飞书气质 | reference · 不驱动新交互 |

图表数据/样式内核以产品 `open-dashboard-frontend/src/dashboard/hifi/editorCore.js` 为准。

大改或发版前按 [process.md](../../../process.md) 打快照到 `../snapshots/`，账本 [`VERSIONS.md`](../../VERSIONS.md)。

P007 定稿状态：

- 默认：`workbench.html`
- 新用户空状态：`workbench.html?state=empty`
- 少 / 多数据：`workbench.html?count=1|2|10`
- 冻结快照：[`2026-08-17-p007-app-shell-final`](./)

> `npm run hi-fi` 或 `./start.sh`；入口 `workbench.html`。
