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

dsh 只有一个 spawn 槽，工具名仍是 `od_board_worker`。Prompt 首行含 `ANALYSIS_REPORT=1` 时走分析 persona（JoyAgent AutoAnalysis 在 dsh 工具调用形态下的对应，不是 smolagents 整仓替换）：

| 步骤 | 工具 | 约束 |
|------|------|------|
| 取数 | `od_get_data` `purpose=analysis` | 聚合 chartQuery；≤200 行；≤15s；禁止明细 / 主键 dump |
| 代码分析 | `od_python` | 仅对已取 frame 跑 Python；pandas/numpy/scipy/sklearn 若已安装可用；禁止 os/subprocess；禁止用 `df.head()` 当全量结论 |
| 变换 | `od_data_trans` | rate / rank / increase / sub_avg |
| 洞察 | `od_insight` | 一次一个 `analysis_method`（OutstandingFirst / Last / Attribution / Evenness / Trend / Correlation / ChangePoint）；未过形态/显著性门控则空，禁止当套模板全量输出 |
| 暂存 | `od_save_insight` | 只存有用结论；「无分析结论」拒绝 |
| 提交 | `od_commit_report` | 渲染「分析过程 / 数据 / 分析结果 / 总结」；postMessage 打开右侧 |

Lead（depth 0）禁止以上细工具，只许一次 `od_board_worker`。出板 persona 禁止报告工具；分析 persona 禁止 `od_save_chart` / `od_commit_board`。

取完若空结果：换维再取一次。用户说「改成按渠道看」：worker 可用新 `question`/`dim` 再 `od_get_data`。图种不是模型参数，harness 在有行后写 `suggestedChartType`。

Worker 须覆盖至少三类方法（描述性 / 相关性或交叉 / 异常或归因），多切片（状态、渠道、时间）在 schema 允许时分次取数。

## Insight 规则（JoyAgent InsightFactory 门控）

不再对每个 handle 无条件输出 6 条模板句。按方法检查形态后再给显著性：

- OutstandingFirst：最高项显著偏离其余（份额 < 50% 且大于后两项之和）
- OutstandingLast：最低项显著偏低（多为负向指标）
- Attribution：头部份额 ≥ 50%
- Evenness：Shannon 均匀度高才输出「较均匀」
- Trend / ChangePoint：仅时序维
- Correlation：拆解维为数值且 Pearson |r|≥0.6

主键 / 高基数 ID（如 PayOrderId）直接拒绝。无 scipy 运行时用 JS 复现同一门控；有 Python 时 worker 另用 `od_python` 做描述统计、z-score/IQR、相关矩阵。

## 前端

postMessage 分两阶段，均使用 `source: 'opendashboard-dsh'`：

- 过程：`type: 'od-report-progress'`。dsh Web 订阅父会话 `od_board_worker` 的递归 `runningCalls/subCalls`，把 `od_get_data`、`od_python`、`od_data_trans`、`od_insight`、`od_save_insight`、`od_commit_report` 映射为有层级的节点事件；事件含节点/工具名、分类、业务摘要、状态、耗时、结构化输入和截断后的输出摘要
- 产物：`type: 'od-open-report'`（title / format / html / markdown / filename）。子会话 `od_commit_report` 的 `report_ready` 必须先提升到父会话 `od_board_worker`，不能只留在 worker session

- HTML：`iframe` `srcdoc`，`sandbox` **不要** `allow-scripts`
- MD：前端轻量渲染（标题/列表/粗体/表格），转义 HTML
- 右侧文件栏对齐 JoyAgent：文件名 + **过程 / HTML / MD 切换** + 下载 + 收起；commit 同时带 html 与 markdown，切换只改预览
- worker 开始后立刻打开右侧节点轨迹；运行/失败节点默认展开，完成节点可回看；成稿后同一栏默认切换为最终 HTML/MD，并保留「过程」tab，禁止让左侧“已生成”早于右栏真实产物
- 对话 Node `od-report-preview`，`odKind: 'report_ready'`，turn 结束后展示

与看板互斥；`od-session-changed` 两边都关。

## 取数上限为什么不是 10k / 90s

JoyAgent AutoAnalysis 单次可取 10k 行、90s。OD 走 Java 聚合 `chartQuery`，大表一次拉 10k 明细会打满查询槽并泄漏明细。分析轨仍只取聚合结果，上限 200 行 / 15s。
