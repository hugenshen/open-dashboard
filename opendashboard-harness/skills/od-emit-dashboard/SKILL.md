# Skill: od-emit-dashboard

Dashboard write path is only `od_emit_patch` → Java `apply-patch`.

## Gen · DeerFlow planner + JoyAgent critic（用户没指定具体图表也要规划）

不要调用机械模板交差。顺序：

1. `write_todos` — 任务：分析数据特征 → 按特征选图 → 质检修复 → 写入草稿（完成一项就更新 status）
2. `od_profile_dataset(datasetId)` — 看 dim/measure/time、`empty`、`probes[].rowCount` / `kpiValue` / `tooGranular`
3. `od_plan_charts(datasetId)` — **只出探测有数的图**，不要自己套 KPI+对比+分布，也不要补未探测的趋势/空 KPI
   - `empty=true`：不要 emit，告诉用户换有数据的业务表
   - 返回含 `quality.fixes`：假环比、同维饼图、过密折线、明细表会在这里被修掉
   - 把返回的 `charts` **和 `query`** 原样交给下一步（可先 `od_review_charts`）
   - 用户点名某图时可删 1–2 张，**禁止新增未探测 encode**
4. `od_review_charts` — 显式质检（可省略：`od_layout_board` 会再跑同一闸）
5. `od_layout_board({ title, styleId, charts, query })` 得到 patch（顶栏 type=query + 两列满铺 + 底汇总表）
6. `od_emit_patch`（无 linkedDashboard 用 replace）。`mode=plan` 时只缓存 patch，等用户 confirm-plan 后再 apply。
7. `write_todos` 全部 completed，再 `od_finish(reason=done)`，用中文说明选图依据与质检修复

`od_compose_board` **禁止**作为默认构图路径。

## Multi-turn（改 / 删 / 加单图）· 对话驱动，不整页重排

已有 `linkedDashboardId` 时，这是**编辑已有看板**，不是重新生成。规则：

1. **先 `od_get_board_summary(dashboardId)`** —— 了解现存图（chartId / title / chartType / datasetId / encode），这是对话定位的依据。
2. 按用户意图分治：
   - **改/换某张**（「把 XX 改成折线」「换个指标」）→ `od_rechart_chart({ changes: [{chartId, chartType?, title?, encode?, datasetId?}] })`，再 `od_emit_patch`。只动该 chartId，其它图位置/encode 不变。
   - **删某张**（「删掉占比图」）→ `od_rechart_chart({ removeChartIds: [chartId] })`，再 `od_emit_patch`。Java replace 差集删除该图，其余不动。
   - **加一张**（「再加一张对比图」）→ `od_rechart_chart({ adds: [{chartType, title, datasetId, encode}] })`，再 `od_emit_patch`。新增图放现有内容之下。
   - 一次可混合 changes + removeChartIds + adds（例如「把 A 改成折线，删掉 B，再加一张 C」）。
3. **禁止整页 replace**，除非用户明确「重新生成 / 整页 / 从零 / 全部重做」。
4. chartId 必须来自 `od_get_board_summary`；不存在的 chartId 会被 `od_rechart_chart` 拒绝，先读 summary 再改。
5. 改图时 encode 字段必须来自该数据集 schema（防幻觉字段）。

## Constrained gen（首次生成 / 整页）

- 首次生成：走 `od_plan_charts → od_layout_board → od_emit_patch`（无 linked 用 replace）。
- 明确「重新生成 / 整页」：才整版 replace。
- 默认多轮行为：append/精控 patch（见上），不整页。
