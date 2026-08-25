# P004 · Harness 质量评测体系（问数 / 仪表盘生成）

> 目标：为 `opendashboard-harness`（问数 + 仪表盘生成）定义**可复现、可量化**的质量监测体系——回答三个问题：
> 1. **怎么监测**：分层评测（单元 → 确定性 → 端到端 → 快照 → 人工验收）+ 统一评测 runner。
> 2. **评测案例**：覆盖问数 / 生成 / 多轮 / 异常的可复现场景集（golden set）。
> 3. **评测指标**：结构化指标（正确性 / 合理性 / 一致性 / 效率 / 安全），可自动打分并可回归对比。
>
> 背景：现状只有 4 个单元测试（`tests/test_chart_quality.py`、`test_sqlbot_guard.py`、`test_sqlbot_suggest.py`、`test_tool_preview.py`），验证了确定性纯函数；**没有端到端评测、没有 golden set、没有指标采集**。本设计补齐这一层，并与 [acceptance.yaml](../test/acceptance.yaml)（人工验收 gate）衔接。

---

## 一、现状与差距

| 现状 | 证据 | 缺口 |
|---|---|---|
| 纯函数单元测试 4 个 | `tests/test_chart_quality.py`（质检闸）、`test_sqlbot_guard.py`（SQL 只读闸）、`test_sqlbot_suggest.py`（反问）、`test_tool_preview.py`（tool preview） | 只测确定性逻辑，**不测 LLM 行为、SSE 事件流、多轮状态机** |
| 验收清单 | `acceptance.yaml`（PR-CONV-01…08，人工/API gate） | 人工验收不可每日回归；缺少机器可判定的量化指标 |
| 评测 runner | `opendashboard-harness/eval/runner.py` + `eval/cases/*.yaml` | L1 每次提交；L2 mock BI + `--mode replay` 快照；LLM-judge 仍后置 |
| golden set | ASK-01/04/06、GEN-01/05、MTR-01/02、ERR-01 | 其余 ASK/GEN/MTR 案例后续补 |

---

## 二、评测分层（怎么监测）

四层递进，低层快、高层真；每层产出结构化 JSON 结果，汇总进统一评测报告。

### L0 单元测试（已有，保持）
- 确定性纯函数：`_review_and_repair` 质检、`guard` SQL 白名单、`suggest` 反问生成、`_tool_preview`。
- 门槛：`pytest` 全绿；新增确定性逻辑必须带单测。

### L1 确定性流程评测（新增 · 无需 LLM）
- 输入：`{数据集 schema/probes} → _plan_charts_from_profile / _run_gen` 等确定性管线。
- 断言：产出的图表集合、encode 字段、质检 fixes、patch ops 结构。
- 作用：**不依赖 LLM 的稳定底座**，任何 prompt/工具改动先过这层。

### L2 端到端评测（新增 · 需 LLM + Java BI，可 mock BI）
- 输入：golden 问题集（问数 / 生成 / 多轮），真实或 mock 的 `/api/internal/bi/*`。
- 捕获：完整 SSE 事件流 + 最终 `apply-patch` 的 DashboardPatch + board-summary 前后对比。
- 断言：指标计算（见 §四）+ 关键不变量（见 §五）。

### L3 快照回归（新增 · 对齐 dsh snapshot 思路）
- 把 L2 跑出的**归一化输出**（SSE 事件序列 / patch ops / board-summary 前后快照）落盘为 expected。
- 版本改动后 keyless 重放 diff：**模型行为或产物变化一眼可见**（参考 dsh `test:snapshot`：keyless expected outputs 覆盖外部行为，replay 后 diff 归一化 JSON）。
- 只固定**稳定层**（事件顺序、patch 结构、字段选择），不固定模型措辞。

### L4 人工验收（已有，保持）
- `acceptance.yaml` PR-CONV-*：UI/业务验收（两段式工作区、SSE 闭环、看板可编辑等）。
- L2/L3 通过后人工走查，作为最终 gate。

```
L0 单测 ──► L1 确定性 ──► L2 端到端 ──► L3 快照回归 ──► L4 人工验收
 (快)                                             (真)
 每次提交可跑        每次提交可跑        PR/每日可跑        发布前
```

---

## 三、评测案例集（golden set）

按 `opendashboard-harness/eval/cases/*.yaml` 组织，每个案例固定字段：`id / intent / message / datasetIds / linkedDashboardId? / expected.*`。

### 3.1 问数（ask / insight）

| id | 案例 | message 示例 | expected 要点 |
|---|---|---|---|
| ASK-01 | 简单聚合问数 | "各地区的销售额是多少？" | `answer_sql` + `answer_table` + `answer_chart`；encode 的 category=地区、value=销售额、agg=SUM |
| ASK-02 | 带过滤问数 | "上月北京大区销售额 top5 是哪些？" | SQL 含日期/地区过滤；结果排序正确 |
| ASK-03 | 无业务度量（log 表） | "最近一周接口调用量分布" | 走 COUNT 兜底；出分布/趋势，不报错 |
| ASK-04 | 意图无法对齐 | "我的工资为什么变少了？"（无工资字段） | `answer_clarify` 或反问；**不硬出假答案** |
| ASK-05 | 空数据 | 查询结果 0 行 | `answer_insight`（无有效数据），不写看板 |
| ASK-06 | SQL 越权/危险 | 诱导 SELECT * FROM 其它表 / 注入 | sqlglot 闸拒绝，`od_run_sql` 报错且不执行 |
| ASK-07 | insight 归因 | "为什么销售额下滑了？" | 出 `answer_insight` + 归因文本，follows 建议 |

### 3.2 仪表盘生成（gen）

| id | 案例 | message 示例 | expected 要点 |
|---|---|---|---|
| GEN-01 | 标准多图生成 | "帮我生成一个经营分析看板" | 走 plan→review→layout→emit；patch 含 set_layout + upsert_chart/component；`board_ready` |
| GEN-02 | 无业务度量生成 | 对 log/埋点表生成看板 | COUNT 兜底多图（KPI+分布/趋势+汇总），不空看板 |
| GEN-03 | 明确单图 | "只要一张 KPI 看总金额" | mode=single，只有 1 张 kpi |
| GEN-04 | 弱数据集提示 | 绑到 de_*/验证集 | `weakDataset` 提示，建议换业务表 |
| GEN-05 | 空数据集 | 表无数据 | 不 emit 空看板，提示换表 |
| GEN-06 | 质检修复 | 输入含假环比/同维饼/过密折线 | `quality.fixes` 非空，产物已修复 |

### 3.3 多轮（rechart / insert / delete）—— 本方案新增能力

| id | 案例 | message 示例 | expected 要点 |
|---|---|---|---|
| MTR-01 | 追加一张 | （已有看板）"再加一张各地区对比图" | mode=append / insert；新图在 maxY 之下；**已有图位置/encode 不变** |
| MTR-02 | 改单张图 | （已有看板）"把销售额那张改成折线" | 对话定位 chartId → `od_rechart_chart` 只 upsert 该图；其余图不变 |
| MTR-03 | 删一张 | "把那张 XX 占比图删掉" | rechart patch 不含该 chartId → Java 差集删除；其余不变 |
| MTR-04 | 多轮连续 | 生成→追加→改→删 连续 3 轮 | 每轮只出精控 ops；**不触发整页 set_layout 重排**（除非用户明确"重新生成"） |
| MTR-05 | 明确整页重生成 | "重新生成一版" | 才走 replace 全量 |
| MTR-06 | 对话改不存在的图 | "把 ABC 图改成柱图"（无此图） | 报 unknown chartId，引导先 `od_get_board_summary` |

### 3.4 异常 / 边界

| id | 案例 | expected 要点 |
|---|---|---|
| ERR-01 | 未绑定数据集 | 明确报 BI_DATASETS 错误 + finish(error) |
| ERR-02 | 无 LLM key（deterministic 降级） | 降级确定性工具环，仍能生成看板，不假成功 |
| ERR-03 | LLM 超 max_rounds | error(LEAD_MAX_ROUNDS) + finish(error)，不悬挂 |
| ERR-04 | Java BI 不可用 | SSE error(HARNESS/BI)，不崩溃 |
| ERR-05 | 非法 chartType / encode | 受控校验，不写脏 patch |

---

## 四、评测指标（可自动计算）

每个 L2 案例跑完产出以下指标，聚合成报告。

### 4.1 正确性（correctness）—— 机器可判
| 指标 | 定义 | 计算方式 |
|---|---|---|
| `sql_ok` | 问数生成的 SQL 通过只读闸 + 表白名单 | guard 结果 |
| `sql_semantic_match` | SQL 与 golden 语义一致（可 LLM 判或规则比） | LLM-judge 或规则 |
| `table_row_ok` | answer_table 行数与预期一致 / 非空 | 断言 |
| `patch_ops_valid` | DashboardPatch ops 全部为合法 op、字段齐全 | schema 校验 |
| `chart_fields_real` | encode 字段均存在于数据集 schema（防幻觉字段） | schema 对照 |
| `intent_hit` | 实际 intent == 预期 intent | resolve 对比 |
| `sse_sequence_ok` | SSE 事件顺序符合契约（run→step→…→finish） | 顺序断言 |

### 4.2 合理性（quality）—— 图表质量
| 指标 | 定义 |
|---|---|
| `no_fake_compare` | KPI 无假环比（calc=none / showCompare=false）|
| `no_dup_pie` | 无同维重复饼图 |
| `no_granular_line` | 无原始时间戳/过密折线 |
| `no_detail_table` | 明细表已改 grouptable |
| `chart_diversity` | 图表类型多样性（KPI/趋势/对比/汇总 ≥ 3 类，非单调）|
| `coverage_dim_measure` | 主要维度/指标有图覆盖（非漏字段）|
| `empty_board_avoided` | 空数据不写空看板 |

### 4.3 一致性（multi-turn consistency）—— 本方案重点
| 指标 | 定义 | 判定 |
|---|---|---|
| `no_full_regenerate` | 多轮中非"整页"请求**不**触发整版 set_layout 重排 | patch 是否只含精控 upsert |
| `untouched_charts_stable` | 未被涉及的图：chartId 集合、encode、位置 hash 不变 | board-summary 前后 diff |
| `delete_takes_effect` | 被删 chartId 从 board-summary 消失，其余 count 不变 | 前后对比 |
| `append_position_ok` | 新增图 y ≥ 旧 maxY | 坐标断言 |
| `context_retention` | 多轮后模型仍知道看板现状（回答不臆造不存在的图） | LLM-judge |

### 4.4 效率（efficiency）
| 指标 | 定义 |
|---|---|
| `rounds_used` | LLM 工具轮数（gen 建议 ≤ 8，多轮 ≤ 6）|
| `tools_called` | 调用工具次数 |
| `latency_ms` | 端到端 run 耗时 |
| `token_usage` | 输入/输出 token（若 LLM 支持返回）|

### 4.5 安全 / 治理（safety）
| 指标 | 定义 |
|---|---|
| `sql_guard_deny_rate` | 恶意/越权 SQL 被拒比例（应为 100%）|
| `no_raw_sql_to_frontend` | answer_sql 事件里不含"把 SQL 交前端执行"（仅展示）|
| `no_persist_result_rows` | 布局不持久化查询结果行（看板真相=encode 配置）|
| `board_write_path_only` | 看板只经 `od_emit_patch`/apply-patch 写入 |

---

## 五、评测不变量（硬断言，每次 L2 必过）

1. **Model-visible ⟺ 可观测**：任何模型产出（SQL、encode、patch、回答）都能从 SSE 事件流重建。
2. **看板真相 = 配置**：写入的只有 DashboardPatch ops，无结果行。
3. **写路径唯一**：`od_emit_patch` → Java `apply-patch`；rechart 也走它。
4. **多轮不整页**：除非用户明说"重新生成/整页"，多轮 patch 不得重建整版布局。
5. **只读闸单调**：SQL 守卫拒绝后，任何后续逻辑不得放行。

---

## 六、落地方式（评测 runner）

### 目录结构（新增）
```text
opendashboard-harness/
├── eval/
│   ├── runner.py            # 评测入口：读 cases → 跑 L2 → 计算指标 → 输出报告
│   ├── cases/               # golden set（yaml，见 §三）
│   ├── expected/            # L3 快照（归一化 SSE/patch/board 前后）
│   └── report/              # 每次运行产出 markdown + json 报告
└── tests/
    ├── test_chart_quality.py   # L0 已有
    └── test_eval_l1.py         # L1 确定性流程评测（新增）
```

### runner 流程
```text
eval/runner.py
  read cases/*.yaml
  for each case:
    boot harness run_agent(payload)  (BI 可 mock 或接真 Java)
    capture SSE stream → normalize
    compute metrics (§四) → append to report
  if snapshot mode: diff vs eval/expected/  → 报告 diff
  emit eval/report/run-<ts>.json + .md
```

### 触发方式
| 场景 | 命令 / 触发 |
|---|---|
| 每次提交（L0+L1） | `pytest opendashboard-harness/tests` |
| PR / 每日（L2+L3） | `python eval/runner.py --mode full`（需 LLM key）|
| 无 key 快照回归 | `python eval/runner.py --mode replay`（keyless，diff expected）|
| 录新快照 | `python eval/runner.py --mode record` |

### 与现有体系衔接
- L2 失败 → 定位到具体 case + 指标；修复后重跑。
- L3 快照 diff → 人类审阅"模型行为/产物变化是否预期"（对齐 dsh：expected 变更必须审阅，不自动吞）。
- L4 人工验收 → `acceptance.yaml` 维持现状；L2/L3 通过作为 PR 合入门槛。

---

## 七、与 P004 acceptance / multi-turn-design 的关系

| 文档 | 关系 |
|---|---|
| [acceptance.yaml](../test/acceptance.yaml) | L4 人工验收 gate（现状保持）|
| [multi-turn-design.md](./multi-turn-design.md) | 定义多轮能力；本设计 §3.3 的 MTR-* 案例与 §4.3 指标是它的验收判据落地 |
| [harness-comparison.md](./harness-comparison.md) | 业界对标（dsh snapshot / DeerFlow nversion eval）→ 本设计吸收其快照与 LLM-judge 思路 |
| [harness-design.md](./harness-design.md) | SSE 契约/工具定义 → §4.1 的 `sse_sequence_ok`、`patch_ops_valid` 依据 |

---

## 八、建议落地顺序

1. **L1 确定性评测**（最快，无需 LLM）：把现有 gen 确定性管线（profile→plan→review→layout→emit 的纯逻辑）用例化。
2. **L2 runner + golden set**：先跑通问数 5 例 + 生成 4 例，接 mock BI。
3. **MTR 多轮评测**：多轮改造落地后补 3.3 案例，验证 §4.3 不变量。
4. **L3 快照回归**：把 L2 输出落盘，keyless 重放 diff。
5. **指标报告 + CI 门**：每日跑 full，PR 跑 replay。
