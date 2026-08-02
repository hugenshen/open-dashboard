# Open Dashboard

开源的**仪表盘 / BI 画布**蓝图：可运行的高保真交互原型 + 领域模型、表结构、OpenAPI、权限与取数架构、TypeScript 垂直切片。

对标飞书式编排体验与 Quick BI 式分析治理，适合作为新产品落地参考，或迁入现有 Dataset 体系。

## 快速体验（高保原型）

无需后端，浏览器内演示完整编辑 / 绑定 / 图表 / 透视 / 权限交互骨架：

```bash
npm install
npm run hi-fi
# → http://127.0.0.1:8765/dashboard-commercial.html
```

或进入目录后：

```bash
cd frontend/hi-fi && ./start.sh   # macOS / Linux
# Windows: start.bat
```

ECharts 已内置在 `frontend/hi-fi/vendor/`，可离线打开。

## 仓库结构

```
open-dashboard/
├── docs/                      # 规格与架构
│   ├── backend-architecture.md  # ★ 配置 / 取数 / 权限（含行列权限）
│   ├── domain.md
│   ├── schema.sql
│   ├── dashboard-api.md
│   ├── openapi.yaml
│   ├── commercial-mvp-spec.md
│   └── capability-matrix.md
├── frontend/
│   ├── hi-fi/                 # 可分享静态高保原型
│   ├── api/ stores/ views/    # 目标 FE 结构示意
│   └── types/
├── backend/
│   ├── manage/                # Tree / Canvas / Publish / ChartQuery…
│   ├── server/ store/ demo/   # 薄服务 + 内存切片
│   └── java/.../api/          # Java 契约标记
├── package.json
└── LICENSE                    # MIT
```

## 文档导读

| 文档 | 内容 |
|------|------|
| [docs/backend-architecture.md](docs/backend-architecture.md) | **后端怎么接**：表、接口、查询流水线、仪表盘 ACL、数据集行列权限、分享 |
| [docs/data-query-architecture.md](docs/data-query-architecture.md) | **数据面**：数据源类型 → 数据集 → chartQuery → 用户访问（自研，非 DE getData 照搬） |
| [docs/domain.md](docs/domain.md) | 领域模型与发布状态机 |
| [docs/schema.sql](docs/schema.sql) | 双副本表结构 + auth/share |
| [docs/dashboard-api.md](docs/dashboard-api.md) | REST 契约 |
| [docs/commercial-mvp-spec.md](docs/commercial-mvp-spec.md) | Phase A/B/C 商用能力 |
| [frontend/hi-fi/README-分享.md](frontend/hi-fi/README-分享.md) | 打包发给他人预览 |

## 垂直切片（内存后端）

```bash
npm install
npm run slice              # 树 → 画布 → 查询 → 发布
npm run slice:commercial   # 商用路径演示
```

## 设计要点（摘要）

1. **配置与取数分离**：画布/encode 存库；出数走 `POST /chartQuery/query`，每图独立刷新。  
2. **draft / published 双副本**：分享与观看只读已发布内容。  
3. **权限三道闸**：仪表盘 ACL → 数据集 use → 行列权限（RLS/CLS）在查询引擎强制合并。  
4. **禁止**整页 `component_data` 大 blob 与巨型 God Controller。

## 许可

[MIT](./LICENSE) © hugenshen

## 致谢

交互与领域设计过程中参考了 DataEase、飞书多维表格 / 仪表盘、Quick BI、永洪等产品的公开体验，本仓库为独立开源蓝图，不包含上游专有代码。
