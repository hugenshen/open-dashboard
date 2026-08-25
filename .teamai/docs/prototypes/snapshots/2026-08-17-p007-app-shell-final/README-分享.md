# 高保原型 · 本地预览

纯静态页面，**不依赖后端**。产品壳见 [P007](../../../proposals/P007-app-shell/)：左栏模块 + 顶栏工具。版本账本：[VERSIONS.md](../../VERSIONS.md)。

## 启动

```bash
# 仓库根目录
npm run hi-fi
# 或
cd docs/prototypes/hi-fi && ./start.sh              # 默认打开工作台
cd docs/prototypes/hi-fi && ./start.sh conversation # 对话（产品壳内）
cd docs/prototypes/hi-fi && ./start.sh dashboard    # 仪表盘
cd docs/prototypes/hi-fi && ./start.sh standalone   # 仅对话单页（调试）
```

| 页面 | 地址 |
|------|------|
| **工作台（推荐入口）** | http://127.0.0.1:8765/workbench.html |
| 对话分析 | http://127.0.0.1:8765/dashboard-commercial.html#/conversation |
| 对话单页（调试） | http://127.0.0.1:8765/conversation-workspace.html |

不要用 `file://` 直接双击 HTML。

## 文件（按模块）

见 [MANIFEST.md](./MANIFEST.md)。壳层在 `shared/`；工作台在 `workbench.html`；数据源/数据集/编辑器/报告仍在 `dashboard-commercial.html`（不再往里加新一级页）。

## 说明

- 高保壳（P007）尚未落到 Vue `ModuleTopbar`；产品实现前不要写入 requirements。
- 对话落地页问数结果在对话流内；发送「生成看板」才出画布。
