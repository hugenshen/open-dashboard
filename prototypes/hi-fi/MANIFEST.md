# hi-fi 页面清单

| 页面 | 对齐 | 状态 | 备注 |
|------|------|------|------|
| `dashboard-commercial.html` | 基线编辑器壳 | current | 主参照；**图表数据/样式内核以产品** `open-dashboard-frontend/src/dashboard/hifi/editorCore.js` **为准**（字段级配置、横纵轴/表格深度样式等已领先本 HTML） |
| `dashboard-feishu.html` | 飞书气质 | reference | 历史气质参照 |
| `conversation-workspace.html` | [P004](../../docs/proposals/P004-conversation.md) | in-progress | 对话分析四栏 |

大改或发版前可按 [process.md](../../docs/process.md) 打 `../snapshots/`。

> 独立 `npm run hi-fi` 仍跑本目录静态页；产品编辑器挂载同一套 `editorCore`/`editor.css`，交互以产品内核为最新。
