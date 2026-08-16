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
6. `od_emit_patch`（无 linkedDashboard 用 replace）
7. `write_todos` 全部 completed，再 `od_finish(reason=done)`，用中文说明选图依据与质检修复

`od_compose_board` **禁止**作为默认构图路径。

## Constrained gen（再加一张 / 只要某图）

- Default multi-turn: `mode=append` when `linkedDashboardId` exists
- Explicit replace only when user asks 重新生成 / 整页 / 从零
- Always call `od_get_board_summary` before append
