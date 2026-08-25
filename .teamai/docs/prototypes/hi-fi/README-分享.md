# 高保原型 · 本地预览

纯静态页面，**不依赖后端**。产品壳见 [P007](../../proposals/P007-app-shell/)：左栏模块 + 顶栏工具。版本账本：[VERSIONS.md](../VERSIONS.md)。

## 启动

```bash
cd .teamai/docs/prototypes/hi-fi && ./start.sh              # 默认打开工作台
cd .teamai/docs/prototypes/hi-fi && ./start.sh conversation # 对话（产品壳内）
cd .teamai/docs/prototypes/hi-fi && ./start.sh dashboard    # 仪表盘
cd .teamai/docs/prototypes/hi-fi && ./start.sh datasource   # 数据源
cd .teamai/docs/prototypes/hi-fi && ./start.sh dataset      # 数据集
cd .teamai/docs/prototypes/hi-fi && ./start.sh standalone   # 仅对话单页（调试）
```

| 页面 | 地址 |
|------|------|
| **工作台（推荐入口）** | http://127.0.0.1:8765/workbench.html |
| 对话 | http://127.0.0.1:8765/conversation.html |
| 数据源 | http://127.0.0.1:8765/datasource.html |
| 数据集 | http://127.0.0.1:8765/dataset.html |
| 仪表盘 | http://127.0.0.1:8765/dashboard.html |
| 报告 | http://127.0.0.1:8765/report.html |
| 对话单页（调试） | http://127.0.0.1:8765/conversation-workspace.html |

不要用 `file://` 直接双击 HTML。

## 文件（按模块）

见 [MANIFEST.md](./MANIFEST.md)。左栏和顶栏只维护 `shared/shell.js`；各模块 html 引用同一套壳。资源模块顶栏不放问数框。

## 说明

- P007 产品壳与三行工作台已在 Vue 编码，`PR-SH-10` 手验前不要写入 requirements。
- 对话落地页问数结果在对话流内；发送「生成看板」才出画布。
