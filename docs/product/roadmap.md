# 产品演进路线图

> 基于 [requirements.md](./requirements.md) 现状基线。  
> 新能力：本文挂条 → [proposals/](../proposals/) → design/OpenAPI → 实现 → 回写 requirements → 提案标 `done`。详见 [../process.md](../process.md)。

---

## 已交付里程碑

| 版本 | 内容 | 状态 | 提案 |
|------|------|------|------|
| v0.2 | 移动端独立布局（`mobile_json` + styleSync） | 已交付 | [P001](../proposals/P001-mobile-layout-c.md) done |
| v0.3 | 工程脚手架 + 仪表盘编辑器 + chartQuery / datasetQuery + 数据源 / 数据集 | 已交付 | [P002](../proposals/P002-vue-java-scaffold.md) done |
| v0.4 | 在线报告（Umo）引用看板图 / 报告内新建图 + 实时取数 | 已交付（骨架可用） | [P003](../proposals/P003-report-umo-charts.md) done |

---

## v0.5（进行中）

### P0 — 治理与安全补齐

| 项 | 说明 | 依赖 |
|----|------|------|
| 资源级 ACL | 落地 `de_dashboard_auth` 读写闸门（manage / edit / view） | Auth SPI |
| 分享密码 / 过期 | 创建分享时可选密码；观看页校验；与现有 expire 对齐 | Share API |
| 关闭开发回落 | 生产默认 `dev-fallback=false`；文档与 compose 校验 | 部署 |
| contentId 乐观锁 | 布局 / 组件 / 图表保存冲突返回 409 | 编辑器 |

### P1 — 分析体验

| 项 | 说明 |
|----|------|
| **对话分析（内测一期）** | 见 [P004](../proposals/P004-conversation.md)；**问数优先**见 [P006](../proposals/P006-ask-data.md) · 架构 [../design/ai-architecture.md](../design/ai-architecture.md) · 原型 `#/conversation` |
| 查询控件深化 | 日期范围 / 枚举下拉作用于整页 `filterState` |
| 维度下钻 | category 点击进下一层（encode / senior） |
| Tab / 切片器组件 | 容器类组件产品化 |
| 主题与 KPI 条件格式 | 3～5 套主题 |
| CSV 之外的导出 | 画布 / 单图 PNG（或 PDF 报告导出） |

---

## 以后（v0.6+）

### Quick BI 向深度

| 项 | 说明 |
|----|------|
| **洞察报告（P005）** | 看板/数据集 → 统计洞察 + LLM 叙事 → Umo 报告块（引用 live 图）；见 [P005](../proposals/P005-insight-report.md) |
| **对话分析二期** | 监控告警、定时推送、多模型、Skills/MCP、指标口径知识沉淀、模拟数据一键构造 |
| 跳转 | 图 → URL / 另一仪表盘（带参数） |
| 同环比 | `encode.senior.calc` |
| KPI 告警 | 阈值配置 + 通知通道（后置） |
| 查看 SQL | `POST /chartQuery/explainSql` |
| 嵌入 | `/embed/{token}` + iframe / 轻量 SDK |
| 行列权限 | Dataset 层 RLS / CLS 注入查询 |

### 数据接入扩展

| 项 | 说明 |
|----|------|
| Excel / CSV 上传型数据源 | 与 JDBC 并列 |
| API / 推送型数据源 | 按需 |
| 跨库 / 多表 Join 数据集 | 建模深化 |
| 数据集权限与共享 | 与看板 ACL 统一模型 |

### 报告深化

| 项 | 说明 |
|----|------|
| 报告文件夹树 | 对齐看板树模型 |
| 报告分享 Token | 与看板分享一致 |
| 目录 / 页眉页脚 / 导出 Word·PDF | Umo 能力产品化验收 |
| 报告插图与看板联动配置复用 | 统一 context 协议 |

---

## 不做清单（长期）

| 项 | 原因 |
|----|------|
| 内置完整 IAM / 登录页 | 产品定位为可嵌入组件；用 Auth SPI |
| 复制 DataEase 路径与 PANEL 鉴权名 | 独立契约 |
| MyBatis-Plus / JPA 作为默认持久化 | 保持薄 JDBC + Flyway |
| 原生移动 App | 优先 Web 移动布局 |

---

## 版本约定

1. **requirements.md** 始终是「当前已交付」唯一基线（不按版本拆多份文件）。  
2. 本文按里程碑分组「下一步」；条目链到 `proposals/`；落地后写入 requirements，提案标 `done`。  
3. 重大设计变更同步 `docs/design/`（含 `openapi.yaml`）。  
4. OpenAPI 与实现冲突：以**已上线行为**为准，并尽快修契约。  
5. 发版时建议打同号 git tag；旧基线用 `git show vX.Y.Z:docs/product/requirements.md` 查看。
