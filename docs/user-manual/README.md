# Open Dashboard 用户操作手册

面向终端用户的操作指引，含真实界面截图。

**源文件在本目录**；前端构建时会同步到站点路径 `/help/`，随 Web 一起部署。

## 在线访问（推荐）

平台顶栏右侧 **「帮助」** → 新标签打开手册。

| 环境 | 地址 |
|------|------|
| 开箱 Docker | http://127.0.0.1:8088/help/ |
| 本地 Vite | http://127.0.0.1:5173/help/ |

## 本地直接打开（无需服务）

```bash
open docs/user-manual/index.html
# 或
python3 -m http.server 8766 --directory docs/user-manual
# → http://127.0.0.1:8766/
```

## 内容结构

1. 产品简介与推荐链路  
2. 快速开始  
3. 核心概念（数据源 / 数据集 / 仪表盘 / 发布分享 / 报告）  
4. 各模块分步操作：工作台、数据源、数据集、仪表盘编辑器、发布分享、移动端、在线报告  
5. 日常操作清单与常见问题  

截图位于 `screenshots/`。  
演示数据（独立库 `od_manual_demo`，不碰业务库）见 [`seed/`](./seed/)。

## 维护

修改本目录的 `index.html` / `screenshots/` 后：

- `npm run dev` / `npm run build`（frontend）会自动同步到 `frontend/public/help/`
- Docker 构建（仓库根 context）也会把本目录打进镜像
