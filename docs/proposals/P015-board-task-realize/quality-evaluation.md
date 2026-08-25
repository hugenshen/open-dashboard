# P015 · 出板质量评测

> 现行可跑门禁在 `opendashboard-dsh-harness` 的 `pnpm eval`（20 条确定性金标）。  
> 48 例 × 3 次 × 盲评（[PR-REAL-16](./acceptance.yaml) / [PR-REAL-17](./acceptance.yaml)）尚未建集，不进 CI、不挡当前 worker 手验。

## 怎么跑

```bash
cd opendashboard-dsh-harness
pnpm eval                          # 默认 20/20
pnpm eval -- --track board         # 只跑出板段
pnpm eval -- --stage cockpit,realize,review,worker
pnpm eval -- --id BOARD-COCKPIT-S1-01 --report ./tmp/od-eval-report.json
pnpm test                          # 120 单测，含 realize / worker
```

不连 Java、不调 LLM。规划 LLM、spawn worker、chartQuery 只在对话手验（下节 E2E 金标）。

## 评测集（CI，20）

夹具：`packages/dsh-od-eval/cases/**/*.json`；订单字段：`fixtures/merchant-order-fields.json`。

| ID | stage | 断言 |
|----|-------|------|
| BOARD-PLAN-S1-01 / S1-02 | plan | 规则 Goal 枚举：有业务问题；不锁图种 |
| BOARD-BIND-S1-01 | bind | goals→charts |
| BOARD-BIND-JUNK-ID-01 | bind | 无 role 的商户ID/订单号不得进 encode |
| BOARD-BIND-RATIO-01 | bind | 费率类禁止 SUM 成柱/饼值 |
| BOARD-LAYOUT-S1-01 | layout | 组件不重叠 |
| BOARD-REALIZE-COMPOSE-01 | realize | 2–5 行 compose→pie；≥6→bar；compare SUM→bar；rank→hbar；时间→line；空→drop |
| BOARD-REALIZE-EMPTY-01 | realize | 空任务丢弃，其余仍可成板 |
| BOARD-REVIEW-PIE-CAP-01 | review | 全板最多 1 饼；compare 不得为 pie |
| BOARD-WORKER-GUARD-01 | worker | depth 0 拒绝细工具；depth≥1 允许 |
| BOARD-WORKER-CHARTTYPE-01 | worker | `od_get_data` 参数无 chartType；suggested 由 harness 写 |
| BOARD-WORKER-TRANS-RANK-01 | worker | rank 变换后 suggested=hbar |
| BOARD-COCKPIT-S1-01 | cockpit | 整页：≥2 KPI、最多 1 饼、compare≠pie、单位分、空任务丢、layout 合法 |
| ASK-GUARD-01…04 | guard | sql-guard L0 |
| ASK-EX-01 / 02 | ex | 结果集比对 |
| ASK-VIZ-01 | viz | 问数 suggestChartType |

通过定义：该段导出函数的输出满足 `expect`。失败打印 `reason` + `actual`。

现有夹具 `BOARD-BIND-JUNK-ID-01` 覆盖无 role 的 MchId/PayOrderId 不得进 encode。生产 `od_compose_board` 已 fail-closed。[`t_pay_order` 真实坏板](./t-pay-order-case-study.md) 仍要求 semanticReady：画像 0 行时不得整板写入。

## 线上主路径烟测（BOARD-E2E-ORDERS-01，非整体质量金标）

对应 [PR-REAL-11](./acceptance.yaml)。环境：FE `:5173`、Java `:8082`、dsh `:3090`（launchd `com.opendashboard.dsh`）、登录 `demo` / `demo123456`。**必须新对话**，不要续旧 `dashboardId`。

| 步 | 期望 |
|----|------|
| `/board 用订单数据做专业经营仪表盘` | `od_list_datasets` → `od_plan_charts`（`source=llm`）；任务问句有维/度量；**图种待取数后定** |
| 回复「确认」 | Lead **只**调 `od_board_worker`（禁止 Lead `od_run_query` / `od_compose_board`） |
| worker | 按任务取数；空维可改维重试；有数后再选图 |
| 稿面 | 分行 KPI；compare=bar；rank=hbar；构成最多 1 饼；明细表；金额「分」换成亿/万/元；不 SUM 商户ID/订单号当度量 |

**2026-08-25 实测**（dashboard **12**《订单经营仪表盘》已发布）：

- 数据源「本地测试库」MySQL 已连通 → 数据集 `ds_012eb19e` 订单表 → 新对话 `/board` → 规划 8 任务（llm，图种待取数后定）→ 确认后 **仅** `od_board_worker`（轨迹无 `od_run_query` / `od_compose_board`）
- worker ~30s；3 KPI（支付金额 20.24亿 / 商户入账 19.98亿 / 平台利润 2477.3万）+ 3 bar + 1 hbar + grouptable；同维 pie 被 review 去掉
- 编辑 KPI 标题「支付金额总额（E2E）」自动保存后发布成功（状态「已发布」）
- Java `POST /compose-board` 返回 `ok=false` 不写 draft

**2026-08-24 实测**（dashboard **11**《订单经营仪表盘》draft，对照）：

- 规划 9 任务（llm）；确认后 worker ~40s；Lead 轨迹无 `od_run_query` / `od_compose_board`
- worker 摘要：t5/t9 默认维空结果后改 `Status` 重试成功；t8 误用 `PayOrderId` 构成已改为 `Status` + rate
- 画布：支付订单总数 KPI `5,858,015`；商户入账 KPI `19.98亿`；费率 KPI；状态/渠道 **bar**；Top10 **hbar**；状态构成 **pie×1**；状态明细 **grouptable**

这只证明 PR-REAL-11 的“确认后走 worker”与基础形态闸通过，不代表业务质量验收。运行态 encode 仍有待 PR-REAL-15/16/18 解决的风险：没有订单时间趋势；状态/渠道缺 valueMap；商户费率是未确认的简单 AVG；金额/收入没有可见的成功状态过滤；Top10 使用 `AppId` 而非明确经营对象；状态金额 bar 与状态数量 pie 信息接近。不得把 dashboard 11/12 单次手验替代 48 例对照、口径复现和盲评。dashboard **10** 不得当验收成功。

## 以后才做（不进当前 CI）

| 缺口 | 对应验收 |
|------|----------|
| 意图路由 / 数据集置信度夹具 | PR-REAL-12 |
| AnalysisBrief 确认卡 hi-fi | PR-REAL-13 |
| 结果摘要不藏失败的六类 E2E | PR-REAL-14 |
| KPI 真查 + encode.transforms 预览/运行态一致 | PR-REAL-15 |
| ≥48 例固定基准 ×3、百分制与硬闸 | PR-REAL-16 |
| 盲评 ≥65% + 灰度返工指标 | PR-REAL-17 |
| 连 Java 的 chartQuery 金标（P012 E0.2） | 暂缓 |
| `t_pay_order` 原始 schema → 画像缺失 → 须 semanticReady 闸（compose 模板写路径已关） | PR-REAL-18 |
| SemanticSnapshot readiness/版本漂移/未确认多表关系 | PR-REAL-19 |
| KPI 真查、typed IR、BoardRun 幂等/重启恢复、fallback 同闸 | PR-REAL-20 |
| 完整 ResultProfile、候选约束选图、问题 coverage 与布局回放 | PR-REAL-21 |

未通过上表之前，P015 保持 `in-progress`，不得把「可发布经营舱」写进 `requirements.md`。
