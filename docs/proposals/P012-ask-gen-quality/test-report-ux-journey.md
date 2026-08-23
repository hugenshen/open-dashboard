# P012 UX 旅程实测 · 仪表盘（商户订单表）

> 日期：2026-08-22 · 角色：零售运营分析师 · 数据集：商户订单表 `ds_31e4ffe9`  
> 环境：FE `:5173` · dsh `:3090` · BI `:8082`  
> 证据：[`test-report-assets/ux-journey-20260822/`](./test-report-assets/ux-journey-20260822/)  
> **产品内回放**：登录后打开 [`/conversations/replay`](http://127.0.0.1:5173/conversations/replay)（工作台问数区 / 对话分析顶栏「旅程回放」）。与真实「对话分析」**同壳**（顶栏 + 可选右侧编辑器）；会话区对齐 dsh 高保表面（用户气泡 → Composer 打字发送 → Think / 工具卡 / `od-answer-*` Node）。**脚本回放，不调用 Agent**；截图仅作底部证据链接。

## 场景清单与结果

| ID | 旅程 | 结果 | 说明 |
|----|------|------|------|
| **S1** | 自然语言出板主路径 | **部分通过** | Draft **74** 右侧编辑器有 KPI/柱/饼/表；Agent **跳过「确认」HITL** 直接 generate |
| **S2** | 确认前改目标再生成 | **部分通过** | 显式要求「先 plan 等确认」时可停住；改目标后 generate **漂移**（`provided goals rejected` → rules-fallback 带回饼图；MchType 图不稳定） |
| **S3** | 出板后对话改图 | **失败** | 会重试 regenerate，但 **ChannelType 目标反复绑不上**（混淆成 MchType）；饼图未去掉；陷入长时间重试循环，需人工停止 |
| **S4** | 同会话换新主题再出板 | **通过** | 「按商户类型看入账」→ 新 Draft **75**，**未覆盖** 74 |
| **S5** | 出板后追问问数 | **通过** | 明确「不要改看板」后对话内出图/表；dashboardId 仍为 74 |
| **S6** | 先问数再出板 | **部分通过** | 问数有对话内图；再「按刚才口径出板」→ Draft **77**。问数阶段 Agent **读不到行值**（工具只回 rowCount），易反复查数 |

## 详细观察

### S1 主路径
- 用户：`用商户订单表生成一张经营看板：按支付状态看入账`
- Plan 列出 3 目标后 Think：「Let me confirm and generate」→ **未等用户确认**
- 右侧：查询条 + 订单数/商户入账/支付金额 + 柱 + **pie** + 分组表
- KPI 仍出现「订单数」（表名含订单，与 PR-QG-05 边界相关）
- 截图：`S1-board-generated.png`

### S2 确认前改目标
- 用户强调「只 plan、等确认」→ Agent **遵守**，列出目标并等待
- 用户：去掉饼图，改 Status 柱 + MchType 柱 + 表，并「确认」
- 第一次 Draft **76**：缺 MchType、仍有「支付状态构成占比」pie
- 二次生成：目标格式被拒（`provided goals rejected` / `fixture goals rejected`），回退 rules 又带回饼图
- 截图：`S2-plan-waiting.png` · `S2-confirm-regen-drift.png`

### S3 出板后调整
- 用户要求：占比改柱 + 加渠道类型对比
- Agent 多次 `od_generate_board` / `od_plan_charts` / `od_profile_dataset`
- ChannelType 虽为 dim，绑定仍失败；隔离测试时被错绑成 MchType
- 截图：`S3-adjust-stuck.png`

### S4 换主题
- 用户：`换个主题重新出板：按商户类型（MchType）看商户入账`
- Agent 明确新建板、不传 74 → Draft **75**
- 截图：`S4-new-theme-board.png`

### S5 追问问数
- 用户：`不要改看板。只问数：Status=2 支付金额合计`
- 对话内多张预览卡；未新开 draft
- 截图：`S5-ask-after-board.png`

### S6 问数→出板
- 问数有对话内 bar；但 Agent 因工具结果无行值反复 SQL（体验差，曾需停止）
- 跟进出板 → Draft **77**
- 截图：`S6a-ask-first.png` · `S6b-board-after-ask.png`

## 产品缺陷（按优先级）

1. **默认跳过确认 HITL**（S1）：自然语言「生成看板」被当成已确认；与 goal-planning「展示 plan 再等确认」不一致。  
2. **对话改板不可靠**（S2/S3）：用户目标传入 generate 常被拒，回退 rules 覆盖用户删饼/加维意图；ChannelType↔MchType 混淆。  
3. **问数工具对模型不可见行值**（S5/S6）：`presentResult` 只摘要行数 → Agent 盲查循环。  
4. **出板路径仍触碰 SQL**（S2）：plan 前大量 `od_run_sql` 探字段，与「board 禁 query/sql」协议冲突。  
5. **斜杠 `/board` UI**：命令菜单仅见 `datasets`/`model`，`/board` 输入易卡在候选，实操只能自然语言。

## 修复落地（2026-08-22 续）

代码已合入 `opendashboard-dsh-harness`（`pnpm test` 60 pass），dsh 已重启。

| # | 缺陷 | 改动 |
|---|------|------|
| 1 | HITL | persona / `/board` / `od_plan_charts`：plan 后本轮禁止 generate；须「确认」后再写板 |
| 2 | goals 静默回填 | 显式 `goals[]` 全拒 → `goals-rejected`（不再 rules-fallback）；工具透传错误 |
| 2b | ChannelType 绑错 | `resolveFieldRef` + 全 dim 可绑（含 distinctCount=1）；「渠道类型」→ ChannelType |
| 2c | goals round-trip | plan render 输出 `goalsForConfirm=` JSON；message「去掉饼」/双柱意图进 rules |
| 3 | 问数行值 | query/sql render 回传样例 markdown 表给 LLM |
| 4 | 出板禁 SQL | board 路径工具 description 禁止 run_query/sql |

## 回归手验（2026-08-22 23:06–23:12 · Playwright）

| ID | 结果 | 证据 |
|----|------|------|
| **S1 HITL** | **通过** | 「生成看板」后停在「请回复确认」；同轮未写 Draft |
| **S2/S3 删饼+渠道** | **通过**（Draft **79**） | plan 含 Status+ChannelType 双柱、无饼；确认后右侧：入账 KPI + 支付状态 bar + 渠道类型 bar + 表；无 pie |
| **S6 问数样例** | **通过** | 1 轮 4 步出数值表（元），无盲 SQL 循环 |
| S2 首轮踩坑 | 已记 | Draft 78：goals 格式瞎编被拒后空 goals → rules 带回饼；已用 2c 修 round-trip 后再验通过 |

仍待：缺陷 5（`/board` 斜杠菜单）。

## Draft 索引（本轮）

| Draft | 主题 |
|-------|------|
| 74 | 按支付状态看入账（S1 旧） |
| 75 | 按商户类型看入账（S4 新板） |
| 76 | S2 确认后漂移稿（旧） |
| 77 | S6 问数后出板（旧） |
| 78 | S2 回归踩坑：空 goals→rules 带回饼 |
| 79 | S2 修后通过：无饼 + Status/ChannelType 双柱 |
