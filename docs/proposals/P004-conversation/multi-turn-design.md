# opendashboard-harness：多轮对话 + 单张图改造 优化方案

> 目标：生成看板后，用户能**通过对话**基于现有看板做多轮增量调整——针对不满意的那张图重新生成/换图/改指标、追加新图、删掉某图，都不再触发"整页重新生成"。
>
> 关键交互：**不依赖用户点选图表**，全靠对话理解（LLM 结合 `od_get_board_summary` 定位要改的是哪张）；**默认生成逻辑不动**（仍按用户意图 + 数据特征综合判断，`_plan_charts_from_profile` 保留）。

---

## 一、现状与根因（代码实测）

### 1.1 多轮目前"会重新生成"的根因

| # | 根因 | 证据（文件:行） |
|---|---|---|
| R1 | **harness 没有"改/加/删单图"的对话分发**：前端曾传 `selectedChartId/selectedEncode`，harness 从未消费；改走对话后需靠 LLM+board-summary 判断"改哪张/加/删"，目前无此分支 | `api/app.py:78-79,236-237` 收到但 `runtime.py`/`lead_agent.py` 全链路不读 |
| R2 | **`layout_board` 写死 `mode="replace"`**，多轮单图/追加永远整页替换 | `tools/od_bi.py:373` `state.last_layout = {"patch":..., "mode":"replace"...}` |
| R3 | **`resolve_intent` 正则无法区分「整页重生成」还是「改/加/删单图」**，多轮含"再/改/加/换"的表述会被误判成 gen 整页 | `runtime.py:36-46` |
| R4 | **Lead 多轮上下文太弱**：只有最近 messages，没有强制注入 board-summary 的现存图表结构，模型不知道"现在有哪些图、哪些 chartId" | `runtime.py:747-772` `agent_msgs`；`od_get_board_summary` 存在但非强制 |
| R5 | `od_emit_patch` 的 A 层约束强制 patch=layout 产物，模型自拼的增量 patch 被无视 | `tools/od_bi.py:396-401` emit 优先用 `state.last_layout["patch"]` |

### 1.2 说明：默认生成逻辑（含可能的"分布"类图）

`_plan_charts_from_profile` 会按数据特征+用户意图综合生成 KPI/趋势/对比/占比/分布/汇总等多图（无业务度量时 A 层 COUNT 兜底会出「XX分布 bar」「XX占比 pie」）。**这些默认逻辑保持不变**（用户第 2 点要求）——用户提到的"效果不满意"是通过**多轮对话的 rechart** 来表达，而不是改默认生成规则。

---

## 二、优化方案（Python harness 侧为主）

> 三处修订对齐用户意图：
> 1. 单图改造**不靠选中**，全靠对话理解（LLM + board-summary 自动定位）。
> 2. **默认生成逻辑不动**（意图+数据特征综合判断照旧），只在多轮新增 rechart/append/delete 分支。
> 3. **删除天然支持**：Java `apply(mode="replace")` 会用 `keepCharts` 差集删除未保留的存量图（`DashboardPatchApplier.java:146-151`），删图 = replace patch 里不放那张；无需改 Java。

### 主线 A：对话驱动的单图改造（不做选中，靠 LLM + 看板现状定位）—— 解决 "效果不满意重做某图"

**A1. 新增意图分支 `rechart`（对话触发，不依赖选中）**
- `resolve_intent`（LLM 辅助）识别多轮里的"改/换/加对比/把…改成折线/换个指标"表述 → `rechart`。
- 因为不依赖 selectedChartId，靠 **LLM 先 `od_get_board_summary`** 拿到现存图（`chartId/title/chartType/encode`），再结合用户这句话判断要动哪张、怎么改。

**A2. 新增工具 `od_rechart_chart`（供 LLM 对话驱动调用）**
```
od_get_board_summary(linkedDashboardId)
  → LLM 从现存图列表挑出目标 chartId（按标题/主题/用户描述匹配，也支持"新增一张"）
  → 结合用户指令产出「新 chartType/encode/title」
  → 构造增量 patch：
       只想换一张 → 只 upsert 该 chartId（同 chartId 即原位更新，不动其他组件）
       想新增一张 → upsert 新 chartId + 新 component（放现有 board maxY 之下，或按语义就近）
       想删一张   → 用 replace patch 补齐（见 C1，天然删掉未保留的图）
  → od_emit_patch(mode="replace", dashboardId=linked)  # replace 天然删掉不再 upsert 的存量图
```
> 关键：因为「对话驱动的 rechart」要同时支持"换一张/加一张/删一张"，统一走 **replace + 我们精确控制 patch 内容** 最稳妥——Java replace 会用 `keepCharts` 差集删掉未保留图（`DashboardPatchApplier.java:146-151`），所以"删某张"就是"在 replace patch 里不放它"。

**A3. intent / mode 判定（统一写进 SYSTEM_PROMPT + SKILL）**

| 用户意图（对话触发词） | LLM intent | 产物 | 行为 |
|---|---|---|---|
| 首次新生成 / "重新生成整页 / 从零" | gen | replace | 整页模板（现有逻辑不动） |
| "再加一张/多来些/再放一个…" | gen | append（`toAppendPatch`） | 新增到底部 |
| "把…那/张…改成折线 / 换个指标 / 加个对比 / 只要…这张" | **rechart** | replace + 精控 patch | 只改/加/删涉及的那几张，其他照旧 |
| 有多轮 linked 且无明确否定语气 | gen | append | 默认追加，不整页 |

> **默认生成逻辑不改**：首个看板仍走现有 `_run_gen` → `od_plan_charts`（按用户意图+数据特征综合判断的多图 IA）。只是多轮时新增 rechart/append/delete 分支，不触碰首版生成逻辑。

**A4. "分布"类自动图本就不锁死**：默认生成仍由 `_plan_charts_from_profile` 按"数据特征+意图"综合判断（按需出 KPI/趋势/对比/占比/分布/汇总）。是否出现分布图由综合判断决定，不做一刀切移除——保留现有逻辑（用户第 2 点要求）。

### 主线 B：完整多轮（append / 改图 / 删图）—— 基于现有看板做增量

**B1. 多轮分派：append 与 rechart（替换式）分开**
- `insert`（纯加图，"再加一张/多来些"）→ `mode=append`，Java `toAppendPatch` 把新图放到现有 board maxY 之下（`BiPlatformService.toAppendPatch`），不动已有结构。
- `rechart`（改/删/换某张）→ `mode=replace` + 我们精确构造 patch：把"要保留的存量图 + 修改的图 + 新增的图"全部列出，Java replace 自动 `keepCharts` 差集删除未保留者。这样"改一张/删一张/加一张"用一个 replace 精控 patch 统一表达，避免 layout 写死 replace 覆盖整版。
- `layout_board` 保留默认 replace 语义（用于首版全量生成），多轮 rechart 走新的 `od_rechart_chart` 精控路径，不做重复 set_layout。

**B2. Lead 多轮上下文强化（改 R4）**
- `run_lead`/`run_deterministic` 对多轮（有 linked）在对话前强制注入 **board-summary 简报**：现存每张图的 `chartId/title/chartType/datasetId/encode`，并明确规则："改/删/加某张图=rechart 精控 patch；别在没要重排时整页 replace"。
- `od_get_board_summary` 列为多轮 rechart 的强制前置步骤（SKILL 明确）。

**B3. emit 放开 rechart 精控 patch（改 R5）**
- `emit_patch`：当 intent 判定为 `rechart` 时，允许模型传入 `od_rechart_chart` 产出的精控 patch（replace 语义），不再强行套用 `state.last_layout` 的整版模板；仅首版 gen 才锁定 last_layout。

### 主线 C：删除 —— 天然支持，无需改 Java

- **Java `apply(mode="replace")` 已实现删除**：replace 时采集存量 `staleChartIds`，`keepCharts=本次 patch 保留图`，差集 `deleteChart`（`DashboardPatchApplier.java:48-57,146-151`）。
- 因此 **对话"删掉那张 X 图"** = Python `od_rechart_chart` 构造一个 replace patch，patch 里包含存量其余图（+ 若有改动），唯独不放要删的那张。
- **无需改 Java**；若想让某个 patch 更轻（不发全部保留图），可另加 `delete_chart` op 作为优化（可选，非本轮必需）。

---

## 三、涉及改动清单（Python 文件）

| 文件 | 改动 |
|---|---|
| `agent/runtime.py` | `resolve_intent`（LLM 判定）增多轮分支 rechart/insert；新增 `run_rechart`（对话→board_summary→改/删/换单图精控 patch）；`run_lead`/`run_deterministic` 分发；`_run_gen` 支持 append；多轮注入 board-summary 强上下文 |
| `agent/context.py` | `SYSTEM_CORE` 增多轮/rechart 硬规则（改图用精控 replace、加图用 append、删图=replace 不含它）；`transform_context` 多轮注入 board-summary |
| `agent/lead_agent.py` | 同步多轮 intent 分发（rechart/insert/append），对话理解改哪张 |
| `tools/od_bi.py` | 新增 `od_rechart_chart` 工具（board_summary → 精控 replace patch）；`layout_board` 保留默认全量语义；`emit_patch` 对 rechart 放开精控 patch（不再锁 last_layout） |
| `tools/registry.py` | 注册 `od_rechart_chart` |
| `skills/od-emit-dashboard/SKILL.md` | 写多轮/rechart 规则（先 board_summary → 改/删/换=精控 replace、加=append） |
| `sqlbot/`（不改） | 问数路径保持 |
| `api/app.py` | 无需改（对话驱动，不依赖 selectedChartId）|
| `deploy.md` | 说明 OD_HARNESS 多轮行为 |

> **默认生成逻辑、Java 全部不改**：首版生成照旧；删图走 Java 现有 replace 差集机制。

---

## 四、落地顺序（建议）

1. **A1+A2+B2**（对话驱动 rechart + 多轮 board-summary 上下文）——核心，用户"效果不满意重做单图/删图/加图"全走这里。
2. **B1+B3**（append/insert 分派 + emit 放开 rechart 精控 patch）——完整多轮。
3. **C**（删图落地验证）——利用 Java 现有 replace 差集，纯 Python 侧完成，无需 Java。

每步用实测看板结果验证：同对话多轮跑两轮，断言第二轮只产生"目标图/新增图/删除图"的精控 ops，而非整页 set_layout。

---

## 五、落地后验收场景与端到端效果

> 本节回答两个问题：**这套改动具体解决了哪些问题**、**用户端到端验收时能看到/验证到什么**。
> 每条场景都给"用户怎么说 → 期望看到什么"，可在交付后用真实数据集逐条走查。

### 5.1 解决的问题清单（对应用户痛点）

| # | 解决的问题 | 改动依据 |
|---|---|---|
| P1 | **生成后追加调整不再整页重排**——原来第二轮"再加一张"会把整看板 replace 重排，用户反复微调几次版式全乱 | B1 insert→append |
| P2 | **改某张图不再"换整块"**——原来想说"把销售额那张改成折线"，却只能整页重生成 | A1/A2 rechart 精控 patch |
| P3 | **改/删/加不用手动选中图**——纯对话"那张营收占比删掉/趋势线换成柱图"即可，harness 靠对话+board-summary 自动定位 | A1（去 selectedChartId 依赖）|
| P4 | **删图真正生效**——原来删图要么做不到要么整页重排；现在删图=精控 replace 差集 | C 删图 |
| P5 | **多轮上下文不丢**——harness 每轮注入现存图表结构（chartId/title/encode），模型"知道现在有哪些图"，不会因记忆丢失而误整页替换 | B2 多轮上下文 |
| P6 | **只动涉及图，其他不动**——改/删/加某一张，其余图表、布局、查询条件保持原样 | B1/B3 精控 patch + emit 放开 |

### 5.2 端到端验收场景（对话复现式）

**场景 0（前提）**：进入「对话」，绑定数据集（如订单表），首次生成看板。

| 步骤 | 用户输入 | 期望端到端效果（验收判据） |
|---|---|---|
| 0 | 首次"帮我生成一个经营分析看板" | 走现有 gen 全量逻辑，产出 N 张图 + 查询条 + 汇总表，`dashboardId` 落库并 link 到会话；无 regression |
| 1 | "再加一张各地区销售额对比图" | **append**：新图出现在现有看板 maxY 之下；**已有 KPI/趋势/汇总全部不动**；看板标题不变；SSE 出 `plot_ready/chart_ready` |
| 2 | "把第一行右边那张折线图换成柱图，指标改成订单量" | **rechart**：仅该 chartId 的 chartType+encode 被原位更新；**其余图与布局不变**；`board_ready` 只报这一张被触动 |
| 3 | "把那张 XX 占比图删掉" | **rechart+差集**：该图 chartId 不在此轮 replace patch 中 → Java `deleteChart` 删除；**看板其余部分不动**；再 `board-summary` 确认该图已不在 |
| 4 | "还是觉得整体不好，重新生成一版" | 明确"重新生成/整页"→ 才走 **replace 全量**，此时允许整版重排（与 P1 P2 区分开）|
| 5 | （多轮连发）继续追加/微调若干轮 | 每轮都只产生对应精控 ops，**不会因历史累积而触发整页 set_layout**；看板随轮次逐步演化，首轮成果被保留 |

### 5.3 可机器验证的判据（快照断言）

在每轮 run 结束后断言（可作为自动化验收脚本）：

1. `replace` 精控 patch 的 `upsert_chart` 集合 == 用户本轮涉及图 + 应保留存量图；**不得包含"整版 set_layout 重排"的完整重建 ops**。
2. append 轮：新 chartId 的 component `y` ≥ 现看板 maxY；既有 chartId 全数保留、位置/encode 未变。
3. rechart 轮：只有目标 chartId 的 `chartType/encode` 变化；`board-summary` 中其余图 hash 不变。
4. delete 轮：目标 chartId 从 `board-summary` 消失；非目标图 count、chartId 集合不变。
5. 连续 3 轮以上不触发整页 replace（除非用户明确"重新生成/整页"）。

### 5.4 与本提案验收 ID 的衔接

上述场景是对 P004 现有验收（`acceptance.yaml` 的 PR-CONV-*）的**增量补充**，建议在实现阶段随 `multi-turn-design` 落地登记为新的可验收项（例如 `PR-CONV-*` 后续号：多轮 append / 单图 rechart / 删图 / 多轮上下文注入），并反链到本 design 的 5.2/5.3。

---

## 六、已对齐的决策

1. **不依赖用户选中图**：改/删/换某张全走对话理解（LLM 结合 `od_get_board_summary` 自动定位）。前端无需传 `selectedChartId`。
2. **默认生成逻辑不动**：首个看板仍按用户意图+数据特征综合判断（`_plan_charts_from_profile` 保留，"分布"类图是否出现由综合判断决定）。
3. **删图支持**：对话"删掉 X 图"→ rechart 精控 replace patch（Java 现有 replace 差集自动删除），无需改 Java。
