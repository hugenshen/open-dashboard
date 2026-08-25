# P016 · 对话分析报告 · 设计

对齐 README 验收 ID：PR-ANR-01…08。

## 三轨产物

```text
用户问题
  ├─ /ask     → 对话内表/图卡（P006）          无右侧文件
  ├─ /board   → Dashboard draft（P015）       右侧编辑器
  └─ /report  → HTML/MD 快照文件（P016）      右侧文件预览
```

分析报告**不是**可刷新 Dashboard：没有 `dashboardId`，刷新页面不重跑 `chartQuery`。页脚写明「静态快照 · 非可刷新看板 · 聚合上限 200 行」。

P005（未接受）是「已有看板 → Umo 解读 + live 图引用，禁止内嵌结果行」。P016 相反：报告文件**可以**内嵌本次聚合快照表/条形，因为它就是快照文件。

## Agent / 工具

dsh 只有一个 spawn 槽，工具名仍是 `od_board_worker`。Prompt 首行含 `ANALYSIS_REPORT=1` 时走分析 persona：

| 步骤 | 工具 | 约束 |
|------|------|------|
| 取数 | `od_get_data` `purpose=analysis` | 聚合 chartQuery；≤200 行；≤15s；禁止明细 dump |
| 变换 | `od_data_trans` | rate / rank / increase / sub_avg |
| 洞察 | `od_insight` | JS 确定性规则，无 scipy |
| 暂存 | `od_save_insight` | 累积到 session.insights |
| 提交 | `od_commit_report` | 渲染自包含 HTML + Markdown；postMessage 打开右侧 |

Lead（depth 0）禁止以上细工具，只许一次 `od_board_worker`。出板 persona 禁止报告工具；分析 persona 禁止 `od_save_chart` / `od_commit_board`。

取完若空结果：换维再取一次。用户说「改成按渠道看」：worker 可用新 `question`/`dim` 再 `od_get_data`。图种不是模型参数，harness 在有行后写 `suggestedChartType`。

## Insight 规则（确定性）

对当前 handle 的聚合行计算：

- OutstandingFirst / Last：最大/最小份额
- Attribution：头部占比
- Evenness：变异系数
- Trend：时序首尾（≥3 行）
- ChangePoint：最大相邻差

不把图种交给模型猜。

## 前端

postMessage `source: 'opendashboard-dsh'`，`type: 'od-open-report'`（title / format / html / markdown / filename）。

- HTML：`iframe` `srcdoc`，`sandbox` **不要** `allow-scripts`
- MD：前端轻量渲染（标题/列表/粗体/表格），转义 HTML
- 右侧文件栏对齐 JoyAgent：文件名 + **HTML / MD 切换** + 下载 + 收起；commit 同时带 html 与 markdown，切换只改预览
- 对话 Node `od-report-preview`，`odKind: 'report_ready'`，turn 结束后展示

与看板互斥；`od-session-changed` 两边都关。

## 取数上限为什么不是 10k / 90s

JoyAgent AutoAnalysis 单次可取 10k 行、90s。OD 走 Java 聚合 `chartQuery`，大表一次拉 10k 明细会打满查询槽并泄漏明细。分析轨仍只取聚合结果，上限 200 行 / 15s。
