# 对话分析（内测）

> 对齐 marmos/Omega 交互闭环与视觉气质；产物写入现有 Dashboard draft；取数仍走 `datasetQuery` / `chartQuery`。  
> 交互真相源：[`prototypes/hi-fi/conversation-workspace.html`](../../prototypes/hi-fi/conversation-workspace.html)  
> **AI 总架构（问数优先）**：[ai-architecture.md](./ai-architecture.md)  
> **生成流程方案**：[dashboard-generation.md](./dashboard-generation.md)  
> Harness 细节：[ai-harness.md](./ai-harness.md)  
> 参照文：[marmos 实测](https://mp.weixin.qq.com/s/1VXH-tv51O7O5ICyN6AmBg)

## 定位

- **对话是新入口**；仪表盘仍是唯一运行时真相。
- **默认意图是问数**；结果可「保存到仪表盘」或「直接生成仪表盘」；亦可快捷直出整页看板。
- 不生成「数据写死在 HTML」的静态页；持久化只写结构化 `DashboardPatch`。
- 双入口：一级 `/conversations`（高保 `#/conversation`）；仪表盘/报告编辑器内 AI 拾取 + Prompt。

## 三产品对照（取舍）

| 维度 | DataEase | DeerFlow | JoyAgent | **OD 采用** |
|------|----------|----------|----------|-------------|
| 定位 | 开源 BI + SQLBot | 通用 SuperAgent | 问数 + 诊断报告 | BI 真相在看板；对话只写配置 |
| AI | 外挂 ChatBI | LangGraph + 沙箱 | Java 编排 + Python 工具 | 一期 Java Harness |
| 产物 | DV JSON | 文件/脚本 | HTML/PPT（常内嵌数据） | `DashboardPatch` + draft |
| 流式 | SQLBot 侧 | SSE runs | Spring SSE | OpenAPI SSE 事件集 |
| 规划 | 无 | Plan + 澄清 | Plan/Auto + SOP | Auto / Plan + confirm-plan |

明确不抄：DeerFlow 沙箱；DataEase getData 整 DTO；JoyAgent 结果行进 HTML。

## 开关与权限

| 配置 | 默认 | 说明 |
|------|------|------|
| `opendashboard.conversation.enabled` | `false` | 菜单 / API 闸门；local/docker/stub 内测打开 |
| 权限码 | `conversation:use` | 启动 run / 写会话；写看板仍走 dashboard 权限 |

## 信息架构（对齐 marmos）

与仪表盘高保同壳（`dashboard-commercial.html` 顶栏路由）：

- **融合入口**：[`dashboard-commercial.html#/conversation`](../../prototypes/hi-fi/dashboard-commercial.html)（推荐）
- 对话交互页：[`conversation-workspace.html`](../../prototypes/hi-fi/conversation-workspace.html)（`?embed=1` 时嵌入壳内）
- 启动：`prototypes/hi-fi/start.sh`（默认打开 `#/conversation`）

### 壳层

```
顶栏（与工作台/数据源等同级）：工作台 | 对话(内测) | 数据源 | 数据集 | 仪表盘 | 报告
对话模块内侧栏：新对话 / 历史 / 探索示例 /（二期灰）
主舞台分两段（一连串动作，不是单页）：
  1) 落地页（默认）：Kimi 式居中 —— 品牌词 + 大输入（~960px）+ 建议词/最近对话
  2) 发送 / 点示例 → 工作台：对话列(~440) | 文件 | 画布；可跳回仪表盘编辑器
产物桥接：Dashboard draft → 同壳「仪表盘」模块；分享复用现有语义
```

### 生成后

文件目录高亮 `.dash` · 手机/电脑 · AI 拾取 · 导出 · 分享 · 版本历史 · 模拟数据黄条 · Plan 确认

## 执行模式

- **Auto**：规划后直接 apply patch  
- **Plan**：先推送 `plan`，`confirm-plan` 后再 apply  

## SSE 事件

`step` · `plan` · `patch` · `chart_ready` · `answer_table` · `answer_chart` · `answer_insight` · `message_delta` · `error` · `finish{reason,detail}`

- 问数 / 洞察：`finish.reason=answered`（会话预览，不落结果行）
- 采纳：`POST .../runs/{runId}/adopt`（`save` | `generate`）→ Patch → `chart_ready`
- 生成看板：`finish.reason=done` / Plan 模式 `awaiting_confirm`

## DashboardPatch

```json
{
  "dashboardId": "…",
  "ops": [
    { "op": "upsert_chart", "chartId": "…", "type": "bar", "datasetId": "…", "title": "…", "encode": {}, "style": {} },
    { "op": "upsert_component", "id": "…", "chartId": "…", "x": 0, "y": 0, "w": 24, "h": 12 },
    { "op": "set_layout", "gridCols": 72, "themeRef": "default" },
    { "op": "set_theme", "styleId": "feishu-blue" }
  ]
}
```

Apply 前校验：数据集可访问、字段存在、encode 角色合法。禁止把查询结果行写入布局。

## Harness 流水线

见 [ai-harness.md](./ai-harness.md)。摘要：

1. Schema Guard：指定了 dataset 但未读到 schema → 禁止页面级 patch  
2. 证据链：选中图 encode → 用户指定 dataset → 字段语义 → 业务说明 → 检索候选  
3. 默认确定性规划器；可选 OpenAI 兼容 LLM（失败回退确定性）  
4. Apply → revision → `chartQuery` 预览 → `chart_ready`  
5. 一期模型 UI 仅 **Auto 推荐**；其它标二期  

### BI 工具白名单

`listDatasets` / `getSchema` / `proposeEncode` / `emitPatch` / `validateChartQuery`

## 版本与分享

- 每次成功 apply 记 revision；侧栏版本历史预览/回滚  
- 分享：公开/私密 · 实时/快照；链接复用 `/share/:token`

## 双轨 AI（产品边界）

1. **问数轨（默认 / P006）** — NL → 会话结果 → 可选保存/生成看板（Patch）  
2. **配置写入轨（P004）** — 快捷「生成仪表盘」或采纳 → Patch → draft → 预览 → 编辑器  
3. **洞察报告轨（v0.6 / P005）** — 统计洞察 + LLM 叙事 → Umo 块（引用 live 图）

详见 [ai-architecture.md](./ai-architecture.md)。

## 二期（原型灰显）

监控告警、定时推送、多模型、Skills/MCP、知识库、云端完美导出。
