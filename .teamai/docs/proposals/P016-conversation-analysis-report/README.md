---
id: P016
title: 对话分析报告
status: in-progress
milestone: v0.6
date: 2026-08-24
prototype: .teamai/docs/prototypes/hi-fi/conversation-ask-dsh.html
acceptance: .teamai/docs/proposals/P016-conversation-analysis-report/test/acceptance.yaml
design: .teamai/docs/proposals/P016-conversation-analysis-report/design/design.md
gates:
  proposal: accepted
  hi-fi: wip
  code: wip
  acceptance: none
architecture: .teamai/docs/design/architecture.html
depends: [P004, P006, P011, P015]
implementation:
  - opendashboard-dsh-harness/packages/dsh-od-bi/src/analysis-worker.js
  - opendashboard-dsh-harness/packages/dsh-od-bi/src/analysis-python.js
  - opendashboard-dsh-harness/packages/dsh-od-bi/src/insight.js
  - opendashboard-dsh-harness/packages/dsh-od-bi/src/report-render.js
  - opendashboard-dsh-harness/packages/dsh-od-bi/src/report-progress.js
  - opendashboard-dsh-harness/packages/dsh-od-bi/src/board-worker.js
  - opendashboard-dsh-harness/packages/dsh-od-bi/src/commands.js
  - opendashboard-dsh-harness/packages/dsh-od-auth/src/bridge-state.js
  - opendashboard-dsh-harness/packages/dsh-od-auth/src/index.js
  - opendashboard-dsh-harness/packages/dsh-od-bundle/cordis.patch.yml
  - opendashboard-dsh-harness/packages/dsh-od-nodes/lib/client.js
  - opendashboard-dsh-harness/packages/dsh-od-eval/cases/analysis-report/
  - open-dashboard-frontend/src/conversation/views/ConversationDshSurface.vue
  - .teamai/docs/prototypes/hi-fi/conversation-ask-dsh.html
  - .teamai/docs/design/architecture.html
---

# P016 · 对话分析报告

> **状态** `in-progress` · 路线图 [进行中](../../product/roadmap/in-progress/) · 高保 wip · 代码 wip · 验收 none

## 开发入口

| 你要 | 去看 |
|------|------|
| 范围、边界、当前完成度 | 本文 |
| 工具链、右侧预览、取数上限 | [design.md](./design/design.md) |
| 唯一验收清单 | [acceptance.yaml](./test/acceptance.yaml) |
| 对照 JoyAgent AutoAnalysis | `refs/joyagent-jdgenie-data_agent`：CodeAgent 工具链；UI 为左栏 Dialogue（思考卡片 + 可点 pill）+ 右栏 ActionView（工作空间 / 任务跟随 / PlanView） |
| 当前代码落点 | `analysis-worker.js` · `analysis-python.js` · `insight.js` · `report-progress.js` · `report-render.js` · `dsh-od-auth`（默认租户绑定） · `dsh-od-nodes/lib/client.js`（`JoyAnalysisDialogue`）· `ConversationDshSurface.vue` · `cordis.patch.yml` |
| 不要做 | 可刷新 Dashboard；P005 Umo 看板解读；JoyAgent 单次 10k 行 / 90s；细工具交给 Lead；用 smolagents 替换 dsh |

## 给谁 / 要解决什么

分析师在对话里要一份**归因/解读报告**（HTML 或 Markdown 文件），而不是问数卡，也不是可刷新看板。交互对齐 JoyAgent：对话在左、文件在右。

## 范围

**做**

- 对话第三轨：问数 / 出板 / **分析报告**
- 入口：slash `/report`；「写分析报告 / 归因解读」走此轨
- 照搬 JoyAgent 报告编排（仅 spawn worker，depth≥1）：`od_get_schema` → `od_analysis_plan` 动态 Plan → 每个 `data_analysis` 由全新 CodeAgent 执行（取数 / Python 或变换 / 洞察 / 分条保存）→ `od_complete_analysis_task` 生成含真实聚合证据表的独立 MD 文件 → 全新 report Agent 通过 `od_read_analysis_files` 读取所有文件全文 → 只调一次 `od_commit_report` 生成 HTML/MD
- 取完数可以换问题/换维再取；图种在有行之后由 harness 填写 `suggestedChartType`
- JoyAgent AutoAnalysis 能力：worker 可写 Python（pandas/numpy/scipy/sklearn 若已安装）做描述/相关/异常/趋势；`od_insight` 按方法门控（OutstandingFirst / Last / Attribution / Evenness / Trend / Correlation / ChangePoint），无显著性不输出、禁止保存「无分析结论」
- 最终报告目录必须面向业务用户：第一屏先给「报告摘要 / 核心结论」与「核心发现」，再进入分主题分析、结论建议；任务文件映射、数据边界、证据表和技术口径必须后置到「附录：数据口径与证据」，禁止一开篇就是工程审计表
- JoyAgent 式右侧分析栏：Lead 调用分析 worker 后立即打开；PlanView 仅展示 PlanningAgent 产生的动态业务任务，与工具节点分离；任务跟随展示当前节点，文件页随子任务完成实时出现中间 MD 产物
- 完成后默认切换最终文件；右侧分析栏顶层固定为「实时跟随 / 浏览器 / 文件」，PlanView 不因成稿消失
- 「实时跟随」追当前节点并支持前后回看/回到实时；「浏览器」按时间列网页搜索与访问记录；「文件」列 HTML/MD 两个静态产物，点文件后原位预览、复制或下载
- HTML 使用 `iframe srcdoc`（sandbox 不含 `allow-scripts`）；MD 作为文件格式在「文件」内预览，不再与分析栏顶层 tab 混排
- 对话分析**没有**用户可点的「绑定/选择工作区」。dsh 文件夹工作区只作内部会话分区，启动即绑定默认或登录租户；Composer 禁止出现「选择一个工作区开始」
- 局域网用 `http://<lan-ip>:5173` 打开时，对话 iframe 走同域 `/dsh/`，不写死 `127.0.0.1:3090`
- dsh React 插件在对话 transcript 展示思考卡片和可点工具 pill（JoyAgent Dialogue），不在 composer 上挂状态条
- 实时跟随里的规划必须作为主视图常驻展示：每个 PlanningAgent 动态任务显示序号、状态、任务说明和最近执行节点；点规划卡可回看对应节点，点「调整这步」把可编辑指令预填到左侧输入框，便于用户中途改规划
- 对话 transcript 必须保留/回放最近一次报告过程摘要：刷新或后续打开时仍能看到规划、思考卡片和可点工具 pill，不能只剩 “Deep diving” 或最终一句话
- 与看板互斥：开报告收起看板，开看板收起报告；切会话两边都关；点「收起」或新对话后，同一轮 progress 不得把右栏再打开
- 聚合取数上限 **≤200 行 / 15s**（JoyAgent 10k/90s 对 OD 大表风险过高；出板仍 ≤20 行 / 8s）

**不做**

- 写入 Dashboard draft / `dashboardId`
- P005：从已有看板生成 Umo 解读稿 + live 图引用（禁止内嵌结果行）
- 把明细大表 dump 进报告；禁止绕过聚合 `chartQuery`；禁止按 PayOrderId 等主键出洞察
- dsh 第二 spawn 槽（仍共用 `od_board_worker`，靠 prompt 首行 `ANALYSIS_REPORT=1` 分流）
- 用 smolagents CodeAgent 整仓替换 dsh；JoyAgent 单次 10k 行 / 90s

## 与相邻提案

| 轨 | 提案 | 产物 |
|----|------|------|
| 问数 | P006 / P011 | 对话内表/图卡 |
| 出板 | P004 / P015 | 可刷新 Dashboard draft，右侧嵌编辑器 |
| **对话分析报告** | **P016** | 会话快照 HTML/MD 文件，右侧文件预览 |
| 看板解读进 Umo | P005 draft | live 图引用，禁止内嵌结果行；未接受，不要实现 |

## 验收 ID

判据只在 [acceptance.yaml](./test/acceptance.yaml)。

| ID | 标题 |
|----|------|
| PR-ANR-01 | `/report` 入口与 Lead 一次 spawn |
| PR-ANR-02 | 右侧 HTML / MD 文件预览 |
| PR-ANR-03 | 产物不是 dashboardId |
| PR-ANR-04 | 细工具 Lead 不可调 |
| PR-ANR-05 | 分析取数 ≤200 行 / 15s |
| PR-ANR-06 | 图种在有数后由 harness 确定 |
| PR-ANR-07 | 取完可换维再取 |
| PR-ANR-08 | 与 P005 边界：快照文件 vs live Umo |
| PR-ANR-09 | AutoAnalysis：方法门控 + Python，禁止套模板全量洞察 |
| PR-ANR-10 | JoyAgent 动态规划、子任务文件与 report_tool |
| PR-ANR-11 | 对话分析不出现绑定工作区 |

## 波及

| 列 | 内容 |
|----|------|
| 依赖 | P006 问数轨；P004 出板轨；P011 dsh 表面；P015 board worker / 单 spawn 槽 |
| 预期改动面 | harness 分析工具、spawn persona 分流、dsh report Node、Vue 右侧文件栏、高保 demo |
| 回归 | P015 出板上限与细工具 guard；P006 问数不提右侧；P011 postMessage 源 |
| 不改 | OpenAPI、Java chartQuery 契约、冻结快照、P005 实现 |

## 修订记录

| 日期 | 说明 |
|------|------|
| 2026-08-24 | 用户确认：JoyAgent AutoAnalysis 工具链；取完可改问题；图种事后定；产物是分析报告不是 Dashboard；OD 取数须严于 10k/90s |
| 2026-08-25 | 右侧文件栏补 HTML/MD 切换与下载；落地页第三轨入口「分析报告」；验收 PR-ANR-03/04/05 单测 pass |
| 2026-08-25 | 实施收口：buildReportFollowup、分析轨 note/换维、eval analysis stage（ANR-REPORT-*）、architecture 回写；PR-ANR-01/06/07 pass；仅 PR-ANR-02 手验待 |
| 2026-08-25 | 与出板同一缺口：worker `od_commit_report` 在子会话，已把 `report_ready` 提升到 Lead `od_board_worker`，右侧 HTML/MD 预览才能打开。PR-ANR-02 仍待手验 |
| 2026-08-25 | 用户补充确认 JoyAgent 交互：分析 worker 运行期间右侧必须持续展示过程明细，完成后在同一右栏展示 HTML/MD 产物；禁止只在左侧显示 Think/完成文案。新增 `od-report-progress` 桥接。 |
| 2026-08-26 | 用户指出阶段状态条不足以理解 Agent 在做什么；对照 JoyAgent `PlanView` / `ActionPanel` 改为可展开节点轨迹，展示工具名、输入、输出、耗时和父子层级，成稿后仍可切回「过程」。 |
| 2026-08-26 | 修复：节点轨迹 `od-report-progress` 在成稿后仍把 `hasReport` 清掉，右侧只剩过程、看不到 HTML；同时 `report_ready` 在 prompt 非字符串时被 expectedKind 丢掉。进度不再覆盖已打开的文件，子会话 HTML 始终提升到 Lead。 |
| 2026-08-26 | 用户确认：`/report` `/board` 注入的 od_* 协议跟帖看不懂。斜杠命令只提交人话（写一份分析报告：… / 生成仪表盘：…）；路由与 ANALYSIS_REPORT=1 收到 persona 与 `od_board_worker` 工具说明，执行时按 description 补全 prompt。 |
| 2026-08-26 | 用户指出报告质量差：旧实现把 JoyAgent AutoAnalysis 收成「一次 get_data + JS 套模板洞察」。改为 worker 四阶段（描述/相关/异常/归因）、`od_python`、InsightFactory 方法门控，禁止明细 ID 洞察与「无分析结论」入库。 |
| 2026-08-26 | 用户指出右栏停在 0/1、对话无思考打印：根因是 spawn 不回传子工具。细工具写入 `report-progress`，iframe 轮询并在对话栏打印思考/Python，右栏按真实步骤刷新。 |
| 2026-08-26 | 用户指出订单报告脱离实际业务：新增订单默认三切片（状态金额、状态订单量、Top 商户），schema 元数据随 frame 进入报告，状态枚举转中文、未知码明确标为未定义、金额从分换算为元/万元/亿元；存在商户字段却无商户切片时禁止提交。第三个有效切片自动成稿并终止，避免 50+ 重复取数/Python 节点。 |
| 2026-08-26 | 用户指出 composer 上方小状态条 + 右栏 0/1「任务执行轨迹」不像 JoyAgent。改为：dsh React 插件把 Dialogue（灰思考卡片 + 可点 pill）portal 进 transcript；右栏 ActionView（工作空间 / 任务跟随 / 底部 PlanView `1/N`，种子 6 阶段）。不搬 JoyAgent 品牌/antd。 |
| 2026-08-26 | 用户确认右侧工作空间按 JoyAgent 交互对齐：顶层必须是「实时跟随 / 浏览器 / 文件」；HTML/MD 是文件格式而非顶层模式。实时跟随默认追最新节点，人工回看不被轮询抢回；成稿自动进入文件，保留过程、浏览记录和 PlanView。 |
| 2026-08-26 | 用户要求：把局域网 IP 发给他人时，对话分析不得提示「绑定/选择工作区」。对话页去掉工作区概念：启动即绑定内部租户分区，空 bridge 不清默认，dsh 听 `0.0.0.0`，iframe 同域 `/dsh/`（Vite 拆分 dsh `/api` 与 Java `/api`）。右侧栏标题改为「分析」。 |
| 2026-08-26 | 用户指出新对话后右栏关不掉：收起/切会话后同一 run 的 `od-report-progress` 轮询又把工作空间打开。右栏忽略同一 `startedAt`；切会话 `POST /od/report-progress` reset。 |
| 2026-08-26 | 用户要求报告流程完全搬 JoyAgent，禁止自主发挥：改为 PlanningAgent 动态计划、每任务全新 data_analysis CodeAgent 生成独立文件、最后全新 report Agent 读全部文件成稿。 |
| 2026-08-26 | 用户指出最终报告质量与 JoyAgent 差距大。根因是汇总 Agent 只看子任务摘要，中间文件也没保留真实聚合表。对齐 JoyAgent `ReportTool`：中间 MD 保留实际商户 ID/业务实体与指标证据表；report Agent 先读全文，再按“整理而非摘要、不遗漏、禁止造数”成稿。 |
| 2026-08-27 | 端到端复测发现 Lead 仍可能先 schema/profile 或先回一句话再 spawn，导致右侧不进入 JoyAgent worker。补齐 DSH 客户端发送前 prompt→bridge 同步，Lead 报告语境下 schema/profile 工具层拒绝并指向 `od_board_worker`；系统提示要求报告路径先工具后文字。 |
| 2026-08-27 | 为缩小最终报告质量差距，`od_commit_report` 增加计划型报告质量门禁：最终 Markdown 过薄、丢失中间分析文件里的商户/经营主体 ID 或商户证据时拒绝提交，迫使 report Agent 依据全部文件重写。 |
| 2026-08-28 | 用户反馈“生成报告”被误判为“看板规划”，触发 `semanticReady=false` fail-closed。修正：`semanticReady` 仅属于看板 `od_plan_charts` / `od_generate_board`；报告意图进入这两个工具时直接拒绝并指向 `od_board_worker(写分析报告)`，`/report` 人话也标注“不是看板”。 |
| 2026-08-28 | 用户指出右侧规划不直观、无法中途调整，且对话回看缺少思考过程。对齐 JoyAgent：实时跟随改为规划卡片 + 节点详情双栏；规划卡显示状态、说明、最近节点并可点选回看；「调整这步」预填左侧输入框；对话 transcript 缓存最近一次过程用于回放。 |
| 2026-08-28 | 用户指出最终报告目录章节不可读，第一屏全是任务文件/数据边界/证据表。对齐 JoyAgent 报告阅读顺序：提交门禁要求「报告摘要/核心结论」开篇，其后核心发现、分主题分析、结论建议，数据口径与证据追溯统一后置到附录。 |
