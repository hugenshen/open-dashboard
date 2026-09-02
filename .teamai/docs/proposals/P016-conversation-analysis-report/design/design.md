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

| JoyAgent 角色 / 步骤 | OD 工具 | 约束 |
|------|------|------|
| PlanningAgent | `od_analysis_plan` | 读完 schema 后根据用户原问、字段口径和业务知识动态拆不重叠子任务；禁止固定报告清单 |
| 取数 | `od_get_data` `purpose=analysis` | 聚合 chartQuery；≤200 行；≤15s；禁止明细 / 主键 dump |
| 代码分析 | `od_python` | 仅对已取 frame 跑 Python；pandas/numpy/scipy/sklearn 若已安装可用；禁止 os/subprocess；禁止用 `df.head()` 当全量结论 |
| 变换 | `od_data_trans` | rate / rank / increase / sub_avg |
| 洞察 | `od_insight` | 一次一个 `analysis_method`（OutstandingFirst / Last / Attribution / Evenness / Trend / Correlation / ChangePoint）；未过形态/显著性门控则空，禁止当套模板全量输出 |
| 暂存 | `od_save_insight` | 只存有用结论；「无分析结论」拒绝 |
| data_analysis `final_answer` | `od_complete_analysis_task` | 每个计划子任务单独固化 Markdown 文件；文件保留最多 20 行真实聚合证据表、实体 ID、指标名和结论，完成后才进下一任务 |
| report_tool 文件读取 | `od_read_analysis_files` | 全新 report Agent 一次读取所有子任务文件的完整内容，与 JoyAgent `ReportTool` 下载 `productFiles` 后作为知识库一致 |
| report_tool 成稿 | `od_commit_report` | report Agent 读全部文件后只调一次；按 JoyAgent “整理而非摘要、不遗漏、禁止造数”撰写完整 Markdown，harness 只安全渲染 HTML/MD，不套内容模板 |

Lead（depth 0）禁止以上细工具，只许一次 `od_board_worker`。出板 persona 禁止报告工具；分析 persona 禁止 `od_save_chart` / `od_commit_board`。

取完若空结果：换维再取一次。用户说「改成按渠道看」：worker 可用新 `question`/`dim` 再 `od_get_data`。图种不是模型参数，harness 在有行后写 `suggestedChartType`。

Worker 对每个 data_analysis 子任务按 JoyAgent AutoAnalysis 做迭代分析：描述 → 异常 → 相关/交叉 → 预测/归因；它们是有数据支持时的分析方法，不是强制报告章节。同一子任务取数失败最多修正 3 次，仍无数则产出可支持的部分/无数结论，不造数。

### 订单报告语义

订单数据不再预设固定三切片或商户必选闸。PlanningAgent 必须从用户原问与实际 schema 中确定分析对象、指标、维度和 `businessKnowledge`；如用户说「使用订单表生成报告」，动态计划应覆盖 schema 中真实存在且对经营有意义的主体/状态/时间/渠道等视角，但不得凭空补不存在的字段或强制每次同样的结构。

查询 frame 继续保存 `fields` 和 `chart.encode`，用于分析证据的字段中文名、枚举和单位翻译；未定义枚举不猜测。最终内容由 report Agent 根据所有子任务文件撰写，渲染器不排序、不自动发明结论。

### 最终报告阅读结构

最终报告对齐 JoyAgent 的“先结论、后过程、证据附录”阅读顺序。`od_commit_report` 不是内容模板，但会做提交门禁：

- 第一屏必须先出现「报告摘要 / 核心结论 / 核心发现」之一，面向业务用户说明发生了什么、影响是什么
- 中部按主题展开，如经营规模、时间趋势、状态结构、商户/渠道/产品贡献、关联洞察、异常风险
- 必须包含「结论与建议」或同义章节，给出可执行下一步
- 任务文件映射、数据边界、技术口径、证据表必须后置到「附录：数据口径与证据」，不得出现在开篇
- Markdown/HTML 会自动补「目录」；HTML 安全渲染 Markdown 表格、有序列表、引用块和代码块

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

- 过程：`type: 'od-report-progress'`。子会话工具把步骤写入 `report-progress`（`GET /od/report-progress`），并同步写入 `OD_REPORT_PROGRESS_FILE` 指向的服务端快照文件（默认系统临时目录，24 小时 TTL）；dsh Web 每 400ms 轮询并 postMessage。事件中 `steps` 是真实工具节点；`plan` 是 PlanningAgent 的动态业务任务，两者禁止互相推导；`files` 随每个 data_analysis 完成追加中间 Markdown 文件。`od_commit_report` 成功后还会把最终 HTML/Markdown 正文写入 `files(final=true)`，作为 `report_ready` 事件丢失正文或进程内状态丢失时的外层兜底交付通道。
- 错误与空数据产品化：`report-progress` 不把 `fetch failed`、`0 行 → none`、Python 预算耗尽等工程语言直接暴露给用户，而是标准化为 `issue/recovery`：数据服务不可用、没有取到可分析数据、代码分析预算已用完、当前维度不适合做洞察、没有形成显著结论等。长时间运行但未交付时返回 `health.status=needs_attention`，右侧工作区展示可操作诊断。
- 数据集匹配产品化：报告场景中 `od_list_datasets` 会把用户原问、keyword 与上下文一起做业务排序。用户提到“订单/支付订单/订单表/t_pay_order”时，优先把 `t_pay_order` / `ds_012eb19e` 排到最前，并降低 `数据源清单/de_datasource`、demo sales 等非目标表权重；关键词过滤结果不足时补拉全量数据集做兜底排序。Java demo seed 与 Flyway `V21__demo_payment_order_dataset.sql` 均注册 `ds_012eb19e · t_pay_order`；若本地/LAN demo 的 Java 目录尚未迁移或暂不可用，DSH 只在订单报告语义下提供标记为 `demo-fallback` 的同名订单数据集与聚合样例，避免验收链路退回 `ds_sales` 或空列表。
- 恢复动作产品化：右侧诊断卡不仅显示 `issue/recovery`，还提供“放宽范围重试 / 换业务维度 / 跳过继续成稿”动作，点击后预填左侧对话，让用户能即时干预，而不是阅读工程日志后自行组织提示词。
- 最终报告质量门禁：`od_commit_report` 不仅检查章节顺序、附录位置和业务实体保留，还会从所有 data_analysis 文件中抽取关键指标数值（排除商户 ID 等实体编号），要求最终 Markdown 至少保留足够的金额/数量/比例证据；只写“已核算/已量化/占主导”等泛化结论但没有具体数值时拒绝提交。
- 回放兜底：外层 `ConversationDshSurface` 在挂载和 iframe load 后主动拉取 `/od/report-progress`；DSH 服务端优先返回内存态，缺失时读取 24 小时内的快照文件；外层收到非 idle 进度或最终报告时，再把最近一次报告快照写入 `localStorage`，刷新/重登可恢复右侧报告过程与文件。该实现解决本地进程/页面刷新回放断层；后续多用户商用仍应把 trace 落会话事件表并按 conversationId 隔离。
- 对话栏：dsh React 插件 `JoyAnalysisDialogue` 用 `createPortal` 把灰底「思考过程」卡片和可点工具 pill 画进 **transcript**（JoyAgent Dialogue），**禁止**挂在 composer `input.dock` 当状态条
- 产物：`type: 'od-open-report'`（title / format / html / markdown / filename）。子会话 `od_commit_report` 的 `report_ready` 必须先提升到父会话 `od_board_worker`，不能只留在 worker session
- 点 pill 发 `od-report-select-step`，右栏切到对应任务跟随

- HTML：`iframe` `srcdoc`，`sandbox` **不要** `allow-scripts`
- MD：前端轻量渲染（标题/列表/粗体/表格），转义 HTML
- 右侧对齐 JoyAgent ActionView：标题「分析」+ 顶层 **实时跟随 / 浏览器 / 文件**。这三项是分析栏状态，不与产物格式混用；产品对话页不出现「工作区 / 绑定工作区」：
  - 实时跟随：默认选当前最新工具节点，展示节点名、工具名、状态、耗时、输入、代码和输出；可前后切节点，人工回看后锁定，点「回到实时」才恢复自动跟随；主视图常驻展示动态业务规划卡片，每张卡显示任务序号、状态、任务说明和最近执行节点；点击卡片回看对应节点，点击「调整这步」把修改指令预填到左侧 composer
  - 浏览器：只收集 search/browser/web 类节点，按时间展示网页搜索或访问记录；本次未使用时给出明确空态
  - 文件：每个 data_analysis 完成即列出中间 `.md` 文件；最终 report_tool 完成后再列出 `.html` 与 `.md`，所有文件均可原位预览、复制、下载。如果最终文件只从 `report-progress.files(final=true)` 到达，外层 Vue 也会自动切到「文件」页并打开 HTML/MD。
- worker 开始后立刻打开右侧分析栏；对话 Node `od-report-preview`，`odKind: 'report_ready'`，turn 结束后展示
- Composer 不得进入 dsh「选择一个工作区开始」inert 态。`od-auth` 启动即 `ensureOdDshWorkspace`；`POST /od/bridge` 空身份保留 env/默认 `demo` + `workspace-retail`；iframe 同域 `/dsh/`，Vite 把 dsh `/api` 改写成 loopback 以免局域网 WebSocket 被信任栅栏拦住

与看板互斥；`od-session-changed` 两边都关。点「收起」或切到新对话后，同一 `startedAt` 的后续 `od-report-progress` / `od-open-report` 不得把右栏再打开；只有更新一轮分析（更大的 `startedAt`）才打开。切会话时 `POST /od/report-progress` `action=reset`。

## 取数上限为什么不是 10k / 90s

JoyAgent AutoAnalysis 单次可取 10k 行、90s。OD 走 Java 聚合 `chartQuery`，大表一次拉 10k 明细会打满查询槽并泄漏明细。分析轨仍只取聚合结果，上限 200 行 / 15s。
