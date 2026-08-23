# P012 · 出板分析规划（Goal）详细设计

> 状态：方案已定（2026-08-22）· **M1.6 已编码**（`goal-planner.js`；LLM 主路径 + fixture/降级；PR-QG-12 pass）  
> 总入口：[design.md §4.1](./design.md) · 流水线总览：[quality-upgrade-brief.html §4](./quality-upgrade-brief.html#decomp)

## 1. 决策摘要

| 项 | 决定 |
|----|------|
| 规划谁做 | **LLM 为中心**枚举/排序分析目标（对标 LIDA GoalExplorer） |
| 人怎么介入 | **默认**：plan 展示后「确认再生成」；**歧义时**主动反问 1 次（对标 DeerFlow clarification） |
| 口径谁管 | **Harness**：能力卡 + `measureKind` 绑定 + `reviewCharts`（对标 Joy/Cube） |
| 规则模板 | `enumerateGoals` **仅**无模型失败 / 单测基线，不作主路径 |
| 不换宿主 | 仍用 dsh 多轮；不引入 DeerFlow 整仓 |

原则：**LLM 决定「问什么」；Harness 决定「能不能这么算」；人不被每轮强制多问，但可确认/纠偏。**

---

## 2. 大流程（/board）

```text
用户 /board <主题>
    │
    ▼
① 编排（LLM + commands 协议）
    od_list_datasets → 选定 datasetId
    │
    ▼
② 探查装载（Harness，非 LLM）
    schema + profile + knowledge → 【能力卡 CapabilityCard】
    │
    ▼
③ 分析规划（本文件重点）
    ③a 能力卡已就绪
    ③b LLM：出 Goal 草案 | 或澄清问题
    ③c 用户：确认 / 改目标 / 答澄清   ← 可跳过「改」，不可跳过「闸」
    ③d Harness：bindGoals → review → od_plan_charts 展示终稿
    │
    ▼
④ 用户确认生成（轻量 HITL）
    回复「确认」/ 点隐含继续 → 仅一次 od_generate_board(同一 goals)
    │
    ▼
⑤ 生成写入（Harness）layout + 强 replace
    │
    ▼
⑥ 编辑器展示（FE）
```

与问数旁路分离：`/ask` 仍是 Text2SQL / `od_run_query`，不走多 Goal 出板规划。

---

## 3. 小流程细化

### 3.1 能力卡 CapabilityCard（Harness · 确定性）

**输入：** datasetId → schema、profile、confirmed metrics/维值/词表（P0/P1 接通后）。  
**输出：** 只读 JSON，供 LLM 规划，**禁止**模型发明卡外字段。

```json
{
  "datasetId": "ds_orders",
  "datasetName": "商户订单表",
  "userMessage": "按支付状态看入账",
  "dims": [
    { "field": "Status", "label": "支付状态", "distinctCount": 5 }
  ],
  "additive": [
    { "field": "MchIncome", "label": "商户入账", "aggDefault": "sum", "unitHint": "fen" },
    { "field": "Amount", "label": "支付金额", "aggDefault": "sum", "unitHint": "fen" }
  ],
  "ratio": [
    { "field": "FeeRate", "label": "商户费率", "aggDefault": "avg" }
  ],
  "time": [
    { "field": "CreateTime", "label": "创建时间", "dayBucket": false }
  ],
  "junk": ["PayOrderId", "MchId"],
  "rules": [
    "compare/table 的 value 只能来自 additive，agg=sum|count",
    "ratio 只能 kpi_ratio 且 agg=avg，禁止与 dim 做 SUM 对比",
    "compose 默认 category=某 dim，agg=count",
    "trend 仅当 time.dayBucket=true",
    "不得使用 junk 字段",
    "goal 数量建议 3～6，按用户主题相关度排序"
  ]
}
```

### 3.2 LLM 规划（主路径）

**触发：** `od_plan_charts` 内先建能力卡，再调宿主 LLM（或由 Agent 在拿到 `od_capability_card` 工具结果后调用规划——实现可选两种，见 §5）。  
**输出 schema（严格 JSON）：**

```json
{
  "mode": "goals" | "clarify",
  "clarifyQuestion": null,
  "goals": [
    {
      "question": "各支付状态下的商户入账对比",
      "intent": "compare",
      "dim": "Status",
      "measure": "MchIncome",
      "agg": "sum",
      "chartType": "bar",
      "rationale": "用户强调支付状态与入账"
    }
  ]
}
```

`intent` 枚举：`kpi_count` | `kpi_sum` | `kpi_ratio` | `compare` | `compose` | `trend` | `table`。

**何时 `mode=clarify`（只问 1 个问题）：**

- 能力卡里 ≥2 个 additive 且用户词（如「入账」「金额」）无法唯一命中  
- 多个低基数 dim 且主题未点名  
- 主题过宽（「看看经营情况」）且未限定数据集内焦点  

**何时不澄清、直接 goals：** 主题已点名维+度量，或唯一合理绑定。

### 3.3 用户确认（轻量 HITL）

| 情况 | 行为 |
|------|------|
| `mode=clarify` | Agent 只输出澄清问句，**不**调用 generate；等用户下一轮 |
| `mode=goals` | `od_plan_charts` 展示目标列表 + 固定文案：「回复「确认」按此生成，或说明要增删的目标」 |
| 用户「确认」/「生成」 | `od_generate_board`，goals 与 plan 一致 |
| 用户「不要构成图，加上趋势」 | 再跑一轮 LLM 规划（带上一轮 goals + 用户改写），再展示 plan |

默认**不**强制每板两次确认；「展示 plan 再等一句确认」是最小 HITL。模糊场景才多一轮澄清。

### 3.4 Harness 绑定闸（不可跳过）

对每个 goal：

1. 校验 `dim`/`measure` ∈ 能力卡且 ∉ junk  
2. `intent=compare|table` → measure ∈ additive，agg ∈ {sum,count}  
3. `intent=kpi_ratio` → measure ∈ ratio，agg=avg  
4. `intent=compose` → value 用 dim 或 count 键，agg=count  
5. `intent=trend` → time.dayBucket === true，否则丢弃该 goal  
6. 组装 encode → `reviewCharts` → layout（仅 generate 时）

闸失败：丢弃该 goal 或降级（如 ratio 误进 compare → 改成 kpi_ratio）；**不得**按模型原样写入。

### 3.5 降级

LLM 超时 / JSON 非法 / 全部 goal 被闸掉 → 回退规则 `enumerateGoals`，并在 plan 文案注明「已用基础规则规划」。

---

## 4. 提示词（实例）

### 4.1 System（规划专用，可挂在工具内二次调用或 persona 片段）

```text
你是 DataQ 出板分析规划器。根据「用户主题」和「能力卡」枚举 3～6 个分析目标（Goal）。
每个 Goal 是一个要回答的业务问题，并给出 intent 与字段绑定。

硬规则（违反则改写，不要输出非法绑定）：
1. compare / table 的 measure 必须来自 capability.additive，agg 只能是 sum 或 count。
2. ratio 字段只能做 kpi_ratio（agg=avg），禁止与维度做 SUM 对比柱/饼/表。
3. 不得使用 capability.junk 中的字段。
4. trend 仅当对应 time.dayBucket 为 true；否则不要输出 trend。
5. compose 使用低基数 dim，agg=count。
6. question 用中文、像分析师提问；不要输出字段英文名当标题主文案。
7. 按与用户主题的相关度排序；不要为凑数重复同维同度量。

若无法唯一确定度量或维度，设 mode=clarify，只问一个短问题，goals 为空数组。
否则 mode=goals，填写 goals。

只输出 JSON，不要 Markdown 围栏。
```

### 4.2 User 模板

```text
用户主题：{{userMessage}}

能力卡：
{{capabilityCardJson}}

请输出：
{"mode":"goals"|"clarify","clarifyQuestion":string|null,"goals":[...]}
```

### 4.3 S1 填槽示例（商户订单）

**能力卡：** 见 §3.1。  
**用户主题：** `按支付状态看入账`

**期望 LLM 输出：**

```json
{
  "mode": "goals",
  "clarifyQuestion": null,
  "goals": [
    {
      "question": "商户入账合计是多少？",
      "intent": "kpi_sum",
      "measure": "MchIncome",
      "agg": "sum",
      "chartType": "kpi",
      "rationale": "主题关注入账总量"
    },
    {
      "question": "各支付状态下的商户入账对比",
      "intent": "compare",
      "dim": "Status",
      "measure": "MchIncome",
      "agg": "sum",
      "chartType": "bar",
      "rationale": "按支付状态拆解入账"
    },
    {
      "question": "支付状态构成占比",
      "intent": "compose",
      "dim": "Status",
      "agg": "count",
      "chartType": "pie",
      "rationale": "看状态分布"
    },
    {
      "question": "按支付状态汇总商户入账",
      "intent": "table",
      "dim": "Status",
      "measure": "MchIncome",
      "agg": "sum",
      "chartType": "grouptable",
      "rationale": "明细汇总"
    }
  ]
}
```

**若主题改为** `按支付状态看`（未说入账/金额）且 additive 有 Amount 与 MchIncome：

```json
{
  "mode": "clarify",
  "clarifyQuestion": "按支付状态拆解时，指标用「商户入账」还是「支付金额」？",
  "goals": []
}
```

用户答「商户入账」后再跑 §4.2，得到与上类似的 goals。

### 4.4 Plan 展示文案（工具 render）

```text
分析目标 {{n}} 个（待确认）
1. {{question}}（{{chartType}}）
2. …

回复「确认」按此生成看板；或说明要增加/删除/修改的目标。
```

### 4.5 /board 命令协议修订（commands.js）

```text
请生成仪表盘：
1) od_list_datasets 匹配数据集
2) od_plan_charts(datasetId, message=用户原话) —— 内部：能力卡 → LLM Goal → 闸 → 展示目标
3) 若工具结果要求澄清：只问用户，勿 generate
4) 用户确认后，只调用一次 od_generate_board(同一 datasetId/title/message；goals 与 plan 一致)
禁止 od_run_query / od_run_sql / 自拼 patch / od_layout_board / od_emit_patch
```

---

## 5. 工具落点（实现选项）

**推荐（少加工具）：**  
`od_plan_charts.execute` 内：建能力卡 → 调配置的规划 LLM（或复用 dsh 侧已有 completion API）→ bind → render。  
Agent 仍只调 `od_plan_charts` / `od_generate_board`；澄清通过返回字段 `needClarify=true` + `clarifyQuestion`，由工具 render / presentResult 展示，Agent 读结果后转述用户。

**备选：** 新增 `od_capability_card`（只读）+ Agent 直接出 JSON goals 再 `od_bind_goals`——轮次更多，暂不取。

`od_generate_board`：接受可选 `goals[]`（与 plan 一致）；缺省则内部再规划一轮（防 Agent 漏传，但协议要求同 message）。

---

## 6. 实例化跑通脚本（S1 逐步）

| 步 | 谁 | 动作 | 产物 |
|----|-----|------|------|
| 1 | 用户 | `/board 按支付状态看入账` | 协议消息入会话 |
| 2 | LLM | `od_list_datasets` | 选中商户订单 datasetId |
| 3 | Harness | 建 CapabilityCard | 合法字段集 |
| 4 | LLM（工具内） | Goal JSON | 4 个 goals，无 FeeRate 对比 |
| 5 | Harness | bind + review | encode 合法 |
| 6 | UI | plan 列表 +「回复确认」 | 用户可见 |
| 7 | 用户 | `确认` | |
| 8 | LLM | `od_generate_board`×1 | draftId |
| 9 | FE | 编辑器查数 | 轴/别名/分转元 |

**反例（须被闸住）：** LLM 若输出 Status×FeeRate SUM compare → bind 阶段改为 kpi_ratio 或丢弃，不得上柱。

---

## 7. 验收要点（编码后）

- 同能力卡下，LLM 规划结果经 bind 后不得出现 ratio 的 SUM compare  
- `mode=clarify` 时本轮不写 draft  
- plan 展示含 question；确认后 generate 图表集合与 plan 一致（允许 review 删减）  
- LLM 失败时降级规则规划且对用户可见提示  
- 单测：能力卡构建、bind 闸、降级路径；LLM 路径用 fixture JSON 打闸（不断网）

---

## 8. 工程序

1. P0/P1：能力卡数据源（metrics/维值）接通 —— 无此 LLM 规划仍易漂  
2. `buildCapabilityCard` + `bindGoals` + plan 确认文案  
3. `od_plan_charts` 内接规划 LLM + JSON schema  
4. 修订 `/board` 协议与 persona  
5. 规则 `enumerateGoals` 改为 fallback  
