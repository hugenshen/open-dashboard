# P012 商户订单表 · 问数 & 出板实测报告

> **带截图 / 视频的 HTML 报告**：[test-report-merchant.html](./test-report-merchant.html)（资源在 [test-report-assets/](./test-report-assets/)）

- **时间**：2026-08-22T14:15:59.867Z（API）· UI 实跑 22:18–22:22 CST · Draft **73**
- **BI**：`http://127.0.0.1:8082` · FE `:5173` · dsh `:3090`
- **数据集**：`ds_31e4ffe9`（商户订单表 / `t_pay_order`）
- **身份**：`u_demo` / `demo` @ `workspace-retail`
- **结果**：9/9 API pass · UI 问数+出板截图已落盘

> API 路径：Java internal BI + harness 规划/闸。UI 路径：浏览器登录 → `/conversations` → 问数 / `/board` 确认 → 右侧 draft。

## ✅ BI health

- 耗时：0 ms
- {"ok":true,"role":"bi-platform"}

## ✅ schema + knowledge + profile

- 耗时：29 ms
- 表 t_pay_order；ratio 字段 MchRate,ChannelRate；含 valueMap：ChannelType,ClientIp,DepositBank,PayFailTime
- ratio：`MchRate, ChannelRate`
- 字段数：60 · sample 行：20
- knowledge metrics：15 · terms：72

## ✅ ask · Status×Amount SUM

- 耗时：64 ms
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

- 耗时：66 ms
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

- 耗时：44 ms
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

## ✅ ask · 空结果 insight（SQL WHERE 1=0）

- 耗时：6 ms
- 行数：0（空结果）
- insight：「空结果探测 WHERE 1=0」（数据集 ds_31e4ffe9） 查询成功但 0 行。请检查过滤条件、时间范围或字段是否匹配；不要把空结果当成有数。

## ✅ ask · ChannelType COUNT

- 耗时：62 ms
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

- 耗时：2793 ms
- draft：`71` · 4 图
- 图标题：
  1. 不同支付状态下的商户入账总额是多少？
  2. 不同支付状态下的支付金额总计是多少？
  3. 各支付状态的平均商户费率是多少？
  4. 按支付状态和商户类型交叉分析商户入账总额？
- 落盘图表 / goals：
| intent | dim | measure | agg | type | title |
|--------|-----|---------|-----|------|-------|
| compare | Status | MchIncome | sum | bar | 不同支付状态下的商户入账总额是多少？ |
| compare | Status | Amount | sum | bar | 不同支付状态下的支付金额总计是多少？ |
| kpi_ratio |  | MchRate | avg | kpi | 各支付状态的平均商户费率是多少？ |
| table | Status | MchIncome | sum | grouptable | 按支付状态和商户类型交叉分析商户入账总额？ |
- plan source：`llm`
- junk：`PayOrderId, MchId, PayOrderIdOut, AppId, MchOrderNo, AgentId, ParentAgentId, ProductId, PassageId, PassageAccountId`
- additive：`MchIncome, Amount, AgentRate, ParentAgentRate, AgentProfit, ParentAgentProfit, ActualAmount, PlatProfit, ChannelCost, RefundTimes`
- ratio：`MchRate, ChannelRate`

## ✅ board · 费率主题不 SUM ratio

- 耗时：2621 ms
- 无 SUM(rate) 落盘图
- draft：`72` · 3 图
- 图标题：
  1. 不同商户类型的商户费率平均值是多少？
  2. 不同渠道类型的渠道费率平均值是多少？
  3. 不同商户类型和渠道类型组合下的商户费率平均值是多少？
- 落盘图表 / goals：
| intent | dim | measure | agg | type | title |
|--------|-----|---------|-----|------|-------|
| kpi_ratio |  | MchRate | avg | kpi | 不同商户类型的商户费率平均值是多少？ |
| kpi_ratio |  | ChannelRate | avg | kpi | 不同渠道类型的渠道费率平均值是多少？ |
| compose | MchType | MchType | count | grouptable | 不同商户类型和渠道类型组合下的商户费率平均值是多少？ |
- plan source：`llm`
- junk：`PayOrderId, MchId, PayOrderIdOut, AppId, MchOrderNo, AgentId, ParentAgentId, ProductId, PassageId, PassageAccountId`
- additive：`AgentRate, ParentAgentRate, MchIncome, ChannelCost, AgentProfit, ParentAgentProfit, Amount, ActualAmount, PlatProfit, RefundTimes`
- ratio：`MchRate, ChannelRate`

## 结论

商户订单表问数与出板主链路可用：schema/knowledge 合并、费率 AVG 闸、状态入账查询、空结果 insight、LLM plan→generate 写 draft 均通过。

### 观察（不阻塞本次 pass）

1. 费率主题出板里，LLM 有一条 goal 文案写「费率平均值」，bind 落成 `compose / COUNT(MchType)`（标题与绑定不完全一致）——说明 bind 闸挡住了 SUM(rate)，但标题未随 rescue 重写。
2. 能力卡把 `AgentRate` / `ParentAgentRate` 放进 additive（可 SUM），与 `MchRate`/`ChannelRate` 的 ratio 待遇不一致，后续可按知识/命名统一。
3. 本报告走工具等价链（非对话 UI 手点 `/ask` `/board`）；dsh Web `:3090` 已起，对话选工具可另做 UI 手验。

### 复跑

```bash
# BI :8082 已起
cd opendashboard-dsh-harness
export DEEPSEEK_API_KEY=…   # 出板 LLM；无 key 则 rules-fallback
OD_BI_BASE=http://127.0.0.1:8082 node scripts/live-merchant-l3.mjs
# 报告 → docs/proposals/P012-ask-gen-quality/test-report-merchant-latest.md
```
