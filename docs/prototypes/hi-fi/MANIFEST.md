# hi-fi 页面清单

按**模块拆文件**（[P007](../../proposals/P007-app-shell/)）。壳层只改 `shared/shell.js` / `shared/shell.css`。

本目录是**当前增量**。实现已定稿提案时，以该提案 `prototype-snapshot` 为准（P007 对照 [`../snapshots/2026-08-17-p007-app-shell-final/`](../snapshots/2026-08-17-p007-app-shell-final/)），不要把这里尚未冻结的改动当成需求。版本关系见 [VERSIONS.md](../VERSIONS.md)。

| 文件 | 模块 | 状态 |
|------|------|------|
| `shared/shell.css` · `shared/shell.js` | 左栏 + 顶栏产品壳（各页统一引用） | current · P007 |
| `shared/commercial.css` · `shared/commercial.js` | 数据源 / 数据集 / 仪表盘 / 报告 内核 | current |
| `workbench.html` | 工作台 | current · P007 交互真相 |
| `conversation.html` | 对话问数（产品壳 + 嵌入 workspace） | in-progress · P004 / P006 |
| `datasource.html` | 数据源 | current |
| `dataset.html` | 数据集 | current |
| `dashboard.html` | 仪表盘列表 / 编辑器 / 预览 | current |
| `report.html` | 报告列表 / 编辑器 | current |
| `conversation-workspace.html` | 对话内页（`?embed=1` 嵌入 conversation.html） | in-progress |
| `dashboard-commercial.html` | 旧 hash 入口，重定向到上列模块页 | compat |
| `dashboard-feishu.html` | 飞书气质 | reference · 不驱动新交互 |

图表数据/样式内核以产品 `open-dashboard-frontend/src/dashboard/hifi/editorCore.js` 为准。

大改或发版前按 [process.md](../../process.md) 打快照到 `../snapshots/`，账本 [`../VERSIONS.md`](../VERSIONS.md)。

> `./start.sh`；入口 `workbench.html`。资源页顶栏不问数。
