# 高保原型 · 本地预览

纯静态页面，**不依赖后端**。对话已融合进商用高保的同一套顶栏路由，不再作为孤立产品。

## 启动

```bash
# 仓库根目录
npm run hi-fi
# 或
cd prototypes/hi-fi && ./start.sh              # 默认打开 对话（在商用壳内）
cd prototypes/hi-fi && ./start.sh workbench    # 工作台
cd prototypes/hi-fi && ./start.sh dashboard    # 仪表盘
cd prototypes/hi-fi && ./start.sh standalone   # 仅对话单页（调试）
```

| 页面 | 地址 |
|------|------|
| **整体产品（推荐）** | http://127.0.0.1:8765/dashboard-commercial.html#/workbench |
| **对话分析（融合入口）** | http://127.0.0.1:8765/dashboard-commercial.html#/conversation |
| 对话单页（调试） | http://127.0.0.1:8765/conversation-workspace.html |

不要用 `file://` 直接双击 HTML（iframe 嵌入在 file 协议下可能受限）。

## 包含文件

| 文件 | 说明 |
|------|------|
| `dashboard-commercial.html` | 产品壳：工作台 / **对话** / 数据源 / 数据集 / 仪表盘 / 报告 |
| `conversation-workspace.html` | 对话交互真相；经 `#/conversation` iframe 嵌入（`?embed=1`） |
| `dashboard-feishu.html` | 较早的飞书风列表原型（可选） |
| `vendor/echarts.min.js` | ECharts，本地离线 |
| `start.sh` / `start.bat` | 一键起本地静态服务 |

## 说明

- 顶栏模块与正式产品 `ModuleTopbar` 对齐；对话是其中一项，产物仍写入 Dashboard draft，可跳回仪表盘编辑器。
- 对话落地页参考 Kimi 居中输入；发送后进入工作台（对话 | 画布 | 文件）。
- 标「二期」的控件为占位，不代表一期交付。
