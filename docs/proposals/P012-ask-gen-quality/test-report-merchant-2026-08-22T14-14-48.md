# P012 商户订单表 · 问数 & 出板实测报告

- **时间**：2026-08-22T14:14:48.127Z
- **BI**：`http://127.0.0.1:8082`
- **数据集**：`ds_31e4ffe9`（商户订单表 / `t_pay_order`）
- **身份**：`u_demo` @ `workspace-retail`
- **结果**：9/9 pass

> 路径：Java internal BI（schema / knowledge / profile / query/chart / apply-patch）+ harness `planBoardAnalysis` / `layoutBoardPatch` / `coerceEncodeAgg` / `enrichAskResult`。等价于 dsh `od_*` 工具链，不经对话 LLM 选工具。

## ✅ BI health

- 耗时：0 ms
- {"ok":true,"role":"bi-platform"}

## ✅ schema + knowledge + profile

- 耗时：26 ms
- 表 t_pay_order；ratio 字段 MchRate,ChannelRate；含 valueMap：ChannelType,ClientIp,DepositBank,PayFailTime
- ratio：`MchRate, ChannelRate`
- 字段数：60 · sample 行：20
- knowledge metrics：15 · terms：72

## ✅ ask · Status×Amount SUM

- 耗时：91 ms
- encode：`{"category":"Status","value":"Amount","agg":"SUM","datasetId":"ds_31e4ffe9"}`
- 行数：3
- sample：
```json
[
  [
    -1,
    41501365020
  ],
  [
    2,
    642788387
  ],
  [
    3,
    160258431033
  ]
]
```

## ✅ ask · Status×MchIncome SUM

- 耗时：67 ms
- encode：`{"category":"Status","value":"MchIncome","agg":"SUM","datasetId":"ds_31e4ffe9"}`
- 行数：3
- sample：
```json
[
  [
    -1,
    40963007349
  ],
  [
    2,
    634762204
  ],
  [
    3,
    158175038777
  ]
]
```

## ✅ ask · MchRate SUM→AVG 闸

- 耗时：50 ms
- encode：`{"category":"MchType","value":"MchRate","agg":"AVG","datasetId":"ds_31e4ffe9"}`（强制 ratio field MchRate coerced SUM→AVG）
- 行数：2
- sample：
```json
[
  [
    1,
    1.3
  ],
  [
    9,
    2.3104166667
  ]
]
```

## ✅ ask · 空/稀疏结果 insight

- 耗时：84 ms
- 1 行（非空，insight 路径未触发）
- encode：`{"category":"Param1","value":"Amount","agg":"SUM","datasetId":"ds_31e4ffe9"}`
- 行数：1
- sample：
```json
[
  [
    null,
    202402584440
  ]
]
```

## ✅ ask · ChannelType COUNT

- 耗时：72 ms
- encode：`{"category":"ChannelType","value":"PayOrderId","agg":"COUNT","datasetId":"ds_31e4ffe9"}`
- 行数：2
- sample：
```json
[
  [
    "Flashpay",
    3515
  ],
  [
    "INTERNAL",
    5854500
  ]
]
```

## ✅ board · 按支付状态看入账

- 耗时：2513 ms
- draft：`69` · 2 图
- 图标题：
  1. 不同支付状态下的商户入账总额是多少？
  2. 不同支付状态的平均商户费率是多少？
- goals：
| intent | dim | measure | agg | type | title |
|--------|-----|---------|-----|------|-------|
| compare |  |  |  | bar | 不同支付状态下的商户入账总额是多少？ |
| kpi_ratio |  |  |  | kpi | 不同支付状态的平均商户费率是多少？ |
| kpi_ratio |  |  |  | kpi | 各支付状态的平均商户费率对比如何？ |
- plan source：`llm`
- junk：`PayOrderId, MchId, PayOrderIdOut, AppId, MchOrderNo, AgentId, ParentAgentId, ProductId, PassageId, PassageAccountId`
- additive：`[object Object], [object Object], [object Object], [object Object], [object Object], [object Object], [object Object], [object Object], [object Object], [object Object]`
- ratio：`[object Object], [object Object]`

## ✅ board · 费率主题不 SUM ratio

- 耗时：3259 ms
- 无 SUM(rate) goal
- draft：`70` · 4 图
- 图标题：
  1. 不同商户类型的商户费率平均值是多少？
  2. 不同渠道类型的渠道费率平均值是多少？
  3. 不同商户类型的商户入账总额是多少？
  4. 不同渠道类型的渠道成本总额是多少？
- goals：
| intent | dim | measure | agg | type | title |
|--------|-----|---------|-----|------|-------|
| kpi_ratio |  |  |  | kpi | 不同商户类型的商户费率平均值是多少？ |
| kpi_ratio |  |  |  | kpi | 不同渠道类型的渠道费率平均值是多少？ |
| compare |  |  |  | bar | 不同商户类型的商户入账总额是多少？ |
| compare |  |  |  | bar | 不同渠道类型的渠道成本总额是多少？ |
| compare |  |  |  | bar | 不同商户类型的支付金额总额是多少？ |
| compare |  |  |  | bar | 不同渠道类型的支付金额总额是多少？ |
- plan source：`llm`
- junk：`PayOrderId, MchId, PayOrderIdOut, AppId, MchOrderNo, AgentId, ParentAgentId, ProductId, PassageId, PassageAccountId`
- additive：`[object Object], [object Object], [object Object], [object Object], [object Object], [object Object], [object Object], [object Object], [object Object], [object Object]`
- ratio：`[object Object], [object Object]`

## 结论

商户订单表问数与出板主链路可用：schema/knowledge 合并、费率 AVG 闸、状态入账查询、空结果 insight、plan→generate 写 draft 均通过。
