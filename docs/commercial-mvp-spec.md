# 商用 MVP 规格（对标飞书 / Quick BI）

> 交互气质对齐飞书；分析与治理对齐 Quick BI。  
> 可运行原型：[`dashboard-redesign/frontend/hi-fi/dashboard-commercial.html`](../../dashboard-redesign/frontend/hi-fi/dashboard-commercial.html)

## Phase A — 最小可商用

### A1 画布
- 组件拖拽移动（网格吸附）
- 边角缩放
- 复制 / 粘贴 / 删除
- 右键：复制、删除、查看数据、置顶

### A2 数据绑定
- 选数据集后字段银行常驻（维度蓝 / 指标绿）
- 槽位随图表类型变化；指标支持聚合 SUM/COUNT/AVG/MAX/MIN
- 数值格式：原始 / 千分位 / 百分比 / 小数位
- 绑定不完整：画布展示可点击的缺失要素清单

### A3 图表 + 查询 + 联动
- 引擎：ECharts（柱/条/线/面/饼/KPI/表）
- 查询控件：日期范围 + 枚举下拉（作用于整页 filterState）
- 联动配置：勾选目标图 + 源/目标字段映射

### A4 分享 / 权限 / 导出
- `POST /dashboard/{id}/share` → `{ token, visibility: public|org, permission: view|edit, url }`
- 观看页：`/share/{token}` 只读 published
- 导出：当前图 CSV 或画布 PNG（一期至少一种）

## Phase B — 飞书向体验

- Tab 容器、切片器组件
- 维度下钻（category 点击进下一层）
- 主题 3～5 套 + KPI 条件格式
- 移动端：观看预览（历史：375 视口套壳）→ **独立布局 + 样式同步/分设 已落地，见 [P001](./proposals/P001-mobile-layout-c.md) / [v0.2.0](./specs/v0.2.0-mobile-layout.md)**

## Phase C — Quick BI 向深度

- 跳转：图 → URL / 另一仪表盘（带参数）
- 高级计算：同比/环比（在 encode.senior.calc）
- KPI 监控阈值告警配置
- 查看 SQL（返回组装后的伪 SQL / 真实 SQL）
- 嵌入：`<iframe src="/embed/{token}">` + SDK 片段

## API 增量（相对 dashboard-api.md）

| Method | Path | 说明 |
|--------|------|------|
| POST | `/dashboard/{id}/share` | 创建/更新分享 |
| GET | `/share/{token}` | 公开观看 |
| POST | `/dashboard/{id}/export` | `{ format: csv\|png, chartId? }` |
| GET/PUT | `/dashboard/{id}/linkages` | 已有，扩展跨数据集 mapping |
| POST | `/chartQuery/explainSql` | 查看 SQL |
| GET/PUT | `/dashboard/{id}/alerts` | KPI 告警 |
| GET/PUT | `/dashboard/{id}/jumps` | 跳转配置 |
