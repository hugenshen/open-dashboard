---
title: Open Dashboard 4A 现行架构（检索索引）
tags: [architecture, 4A, design, technical]
domain: technical
---

# 4A 现行架构

人读完整页：[architecture.html](./architecture.html)。契约：[openapi.yaml](./openapi.yaml)。未实现方案在提案目录，不在本页。

## 代码根

`open-dashboard-frontend/` · `open-dashboard-backend/` · `opendashboard-dsh-harness/`（P011 对话 Agent）。

## 分层

| 视图 | 要点 |
|------|------|
| BA | 分析师接数建模出板；报告作者 Umo；分享读者只读 published |
| AA | Vue 壳 + 模块；Java COLA；对话走 dsh `od_*` → `/api/internal/bi` |
| DA | 看板绑数据集；`datasetQuery` / `chartQuery`；draft / published |
| TA | JDK 21 · Spring Boot 3 · Vue 3 · PostgreSQL 16 |

## 价值流

工作台 → 数据广场 → 数据源 → 数据集 → 仪表盘 → 问数 → 预览 / 分享 / 报告

## 对话分析报告（P016）

`/report` 或自然语言「分析报告/归因/解读」进入静态报告轨，不走看板 `semanticReady` 门禁，不生成 `dashboardId`。Lead 只委派一次 `od_board_worker(ANALYSIS_REPORT=1)`；worker 内部按 JoyAgent 流程执行 `od_get_schema` → `od_analysis_plan` → 多个 data_analysis 子任务 → `od_complete_analysis_task` 中间 Markdown 文件 → report Agent `od_read_analysis_files` → `od_commit_report`。

最终报告由 Agent 撰写，harness 只安全渲染 HTML/MD，但提交门禁要求业务可读：先「报告摘要/核心结论」与「核心发现」，再分主题分析、结论与建议，任务文件映射/数据边界/证据表后置到附录；Markdown/HTML 自动补目录并渲染表格、有序列表、引用和代码块。

右侧分析栏为「实时跟随 / 浏览器 / 文件」。实时跟随常驻展示规划卡片 + 节点详情，工具节点带规划任务索引，用户可点击规划回看对应节点并用「调整这步」预填左侧输入框；失败/等待诊断卡提供“放宽范围重试 / 换业务维度 / 跳过继续成稿”动作，把恢复指令回填到对话框。dsh transcript 展示并缓存最近一次思考卡片和工具 pill 用于回放。外层 Vue 在挂载/iframe load 后主动拉取 `/od/report-progress`，并把最近一次报告快照写入 localStorage，刷新/重登后可兜底恢复右侧过程与文件（服务端持久化仍待后续）。`od_list_datasets` 在报告场景会按用户原问做业务排序，订单/支付订单请求优先 `t_pay_order` / `ds_012eb19e`，并降低数据源清单/demo 表权重。`od_commit_report` 会校验最终报告是否保留 data_analysis 文件中的关键指标数值，防止只写泛化结论。`report-progress` 会把空数据、数据服务失败、Python 预算耗尽等转换为 `issue/recovery` 诊断，并在运行超时未交付时返回 `health.needs_attention`，避免用户只看到技术错误或无限 Deep diving。

最终交付有双通道：正常路径由 `report_ready` presentation meta 打开右侧 HTML/MD；兜底路径由 `od_commit_report` 把最终 HTML/Markdown 正文写入 `report-progress.files(final=true)`，外层 Vue 轮询到完成态后自动切到「文件」页。

## 不要写进本文件

未来设计、未验收交互、类名级实现。那些留在对应 Pxxx。
