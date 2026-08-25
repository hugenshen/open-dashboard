# P015 · `t_pay_order` 真实坏板复盘

> 证据时间：2026-08-24 22:47～22:59。用户提供的截图对应 dashboard draft 10。该板产生于 P015 最新 worker 重启前；之后 dashboard 11 已证明 worker 主路明显改善，但本文暴露的“画像缺失 + planner 失败 + Java 模板可写入”降级漏洞仍必须单独阻断。验收反链 [PR-REAL-18](./acceptance.yaml)。

## 1. 现象不是“有点丑”，而是语义失败

数据集 `ds_012eb19e`：

- 名称：订单表；物理表：`t_pay_order`；状态：`ready`；
- 字段：60 个，包含订单、金额、收入、利润、渠道、状态、退款和多个业务时间；
- `de_dataset_field_profile`：0 行，即没有 learned role、distinct、null rate、数值范围；
- 生成结果：dashboard 10《订单表分析》，7 张图。

运行态 `de_chart_view` 中的实际配置：

| 图 | 实际 encode | 判定 |
|----|-------------|------|
| 记录数 KPI | `COUNT(PayOrderId)` | 唯一基本可用，但应命名“订单量”并说明统计口径 |
| 商户 ID KPI | `SUM(MchId)` | 硬错误：标识符求和没有业务意义 |
| 商户类型 KPI | `SUM(MchType)` | 硬错误：枚举代码求和没有业务意义 |
| 商户费率 KPI | `SUM(MchRate)` | 硬错误：比率不可直接求和；AVG 也需要口径确认 |
| 支付订单号 · 商户 ID | `PayOrderId × SUM(MchId)` bar | 双重错误：唯一订单号作分类轴，ID 作度量，坐标达到十亿级 |
| provider order 构成 | `PayOrderIdOut × SUM(MchId)` pie | 双重错误：高基数订单号导致图例爆炸，ID 作度量 |
| 订单失效时间走势 · 商户 ID | `ExpireTime × SUM(MchId)` line | 时间和指标都错；原始失效时间点不代表经营趋势 |

因此这张板即使换主题、颜色和间距，仍然不能使用。视觉问题是错误语义的外显：

- KPI 数值被截断，用户不知道单位和口径；
- 唯一 ID 产生密集斜轴和超大数字；
- 饼图包含大量近唯一图例，颜色和标签失去意义；
- 折线使用原始时间戳，点位杂乱且没有可解释趋势；
- 画布下半部大片空白，首屏没有业务阅读顺序；
- 真正有用的 `Amount/MchIncome/Status/ChannelType/PaySuccTime` 没进入主分析。

## 2. 实际流程如何走坏

会话 trace 显示：

```text
用户要求生成订单经营仪表盘
  → 找到 ds_012eb19e / t_pay_order
  → schema/profile：60 字段，但无落库画像
  → 智能规划/生成路径发生错误或产出非法目标
  → Lead 继续尝试写板
  → 调用 od_compose_board(datasetIds=[ds_012eb19e], dashboardId=10)
  → Java DeterministicPlanner 按 schema 字段顺序填固定槽位
  → apply-patch replace
  → 7 张图写入 draft 10
```

Java 兜底的决定方式可以直接解释全部结果：

- `DatasetProfiler.roleOf` 在无 learned profile 时优先相信 `field_group`；所有 `quota` 都成为 measure；
- `MchId/MchType/MchRate` 在原始数据集中都是 `quota`，因此成为前三个 SUM KPI；
- 第一 measure 是 `MchId`，第一、第二 dim 是 `PayOrderId/PayOrderIdOut`，第一 time 是 `ExpireTime`；
- `DeterministicPlanner` 固定生成 4 KPI + 首维柱 + 次维饼 + 首时间折线；message 主要用于选数据集/标题，不用于业务问题与字段组合；
- 该路径直接 `apply-patch`，没有 P015 worker 的真实查询、结果画像和整板语义 review。

这说明失败不是 LLM 单点问题，而是多层失守。2026-08-25 已堵住模板写入：名称像 ID/订单号的字段不再当 SUM 度量；`od_compose_board` 与 Java `compose-board` fail-closed，规划失败不得再写 draft。仍未做的是 semanticReady 闸（画像 0 行仍可规划）。

未完成的失守点：

1. 数据集被标为 `ready`，但没有“适合生成看板”的独立语义就绪状态；
2. 原始 schema 把数字 ID、枚举代码、比率都标成 quota；
3. planner 失败没有 fail closed；
4. ~~Lead 可调用低质量 Java compose 作为写路径~~（2026-08-25 已 fail-closed）；
5. commit 只验证字段存在和结构合法，没有验证“这个聚合/问题是否有意义”；
6. 离线 fixture 预先把 `PayOrderId/MchId` 标成 `role=id`，没有覆盖新建数据集画像为空的生命周期。

## 3. P0 修复：先禁止再优化

### 3.1 语义就绪闸

新增独立判定 `semanticReady`，不能复用数据集 `status=ready`。

对 `t_pay_order`，至少要识别：

| 能力 | 字段示例 |
|------|----------|
| 仅计数/明细标识 | `PayOrderId`, `PayOrderIdOut`, `MchOrderNo`, `ChannelOrderNo` |
| 实体维度，可 Top N | `MchId`, `AgentId`, `ChannelMchId` |
| 低基数分类 | `Status`, `MchType`, `ChannelType`, `ProductType`, `IsRefund` |
| additive measure | `Amount`, `ActualAmount`, `MchIncome`, `AgentProfit`, `PlatProfit`, `ChannelCost`, `SuccessRefundAmount` |
| ratio，需要口径 | `MchRate`, `AgentRate`, `ChannelRate` |
| 业务时间 | `CreateTime`, `PaySuccTime`, `PayFailTime`, `ExpireTime`，各自语义不同 |
| 敏感/技术字段 | IP、邮箱、URL、错误详情、扩展参数等，默认不进入整板 |

角色推断要同时使用名称/label 形态、数据类型、distinct/null/range、confirmed glossary/indicator，不能只看 `quota` 或字段顺序。无法确定时宁可排除，不把它当 additive measure。

### 3.2 规划与写入 fail closed

- planner 不可用、credentials 缺失、JSON 非法或全部目标被 review 丢弃：返回 failed，不创建 draft；
- 从生产 Lead 工具集合移除 `od_compose_board`，或让它复用与 worker 相同的 semanticReady、任务验真和整板 review；
- `od_generate_board` 也不能在没有已确认 goals 时回退规则枚举写板；
- commit 前硬拒：`SUM(*Id/*Type/*Status/*Code/*Rate)`、高基数 ID 作分类轴、原始时间戳趋势、空结果图、无意义字段标题；
- 失败结果告诉用户“语义尚未准备好/规划失败”，而不是用低质量板伪装成功。

## 4. 同一数据集应该生成什么

如果用户只说“用订单表生成经营仪表盘”，系统仍应先展示规划卡，并明确默认对象是“支付订单运营”。建议首版结构如下，实际口径以 confirmed 语义为准：

### 概览 KPI

- 订单量：`COUNT(PayOrderId)` 或 `COUNT_DISTINCT(PayOrderId)`；
- 支付金额：`SUM(Amount)`，统一“分 → 元/万元/亿元”；
- 支付成功订单量/成功率：必须确认哪些 `Status` 属于成功，并保存分子/分母；
- 商户入账：`SUM(MchIncome)`，与支付成功状态口径一致；
- 可选退款金额/退款率：基于 `IsRefund/SuccessRefundAmount`，不凭字段名直接猜。

### 趋势与诊断

- 订单量与支付金额趋势：按日分桶 `CreateTime` 或 `PaySuccTime`，需在规划卡说明选择；
- 支付状态：`Status × COUNT(PayOrderId)` bar，应用 valueMap；
- 渠道表现：`ChannelType × SUM(Amount)` 或订单量 bar；
- 商户/代理商排行：`MchId/AgentId × SUM(Amount/MchIncome/Profit)` Top 10 hbar；ID 是分类维，不是求和值；
- 失败诊断：失败状态下 `ErrCode/OurErrCode × COUNT(PayOrderId)` Top N；
- 产品结构：低基数 `ProductType` 优先，`ProductId` 只有基数适合且有业务 label 时使用。

### 筛选与信息架构

- 查询条：业务日期、支付状态、渠道类型；
- 首屏：3～5 KPI → 一张全宽趋势 → 状态/渠道对比；
- 第二屏：商户/代理商排行、失败诊断、必要的聚合明细；
- 默认不展示原始订单号、邮箱、IP、URL 或大段错误信息。

dashboard 11 的 worker 手验已经接近该方向：订单总数、商户入账、状态/渠道 bar、Top 10 hbar、最多一张 pie 和分组表。但它仍需 PR-REAL-15/16/18 证明 KPI 真查、费率/变换运行态一致，以及画像缺失和 planner 失败时不会再次生成 draft 10 这类坏板。

### 4.1 dashboard 10 与 11 的结论边界

| | dashboard 10 · Java 模板 | dashboard 11 · worker 主路 |
|--|--------------------------|-----------------------------|
| ID/类型/费率求和 | `SUM(MchId/MchType/MchRate)` | 已去除；费率改 AVG |
| 核心指标 | 基本没有 | 订单数、入账、利润、费率 |
| 分类分析 | 唯一订单号柱/饼 | 状态、渠道 bar；状态 pie |
| 排行 | 无 | `AppId × MchIncome` Top10 hbar |
| 时间分析 | `ExpireTime × SUM(MchId)` 错误折线 | 没有趋势，仍未回答时间变化 |
| 口径 | 无 | 尚未证明成功状态过滤、费率加权和 confirmed 口径 |
| 结论 | 不可使用，必须阻断 | 主路径烟测通过，但不能视为可发布质量金标 |

因此短期验收不能只要求“再生成一张像 dashboard 11 的板”，而要同时证明：坏路径写不进去、好路径的指标口径可复现、业务问题覆盖完整、相对 baseline 的盲评和返工指标显著改善。

## 5. 必须新增的回归

不能复用已经标好角色的 `MERCHANT_ORDER_FIELDS` 作为唯一输入。新增生命周期用例：

```yaml
id: BOARD-LIFECYCLE-PAY-ORDER-01
dataset:
  table: t_pay_order
  fields: raw-60-field-schema
  profile_rows: 0
  confirmed_metrics: []
planner: unavailable
expect:
  semantic_ready: false
  commit_count: 0
  forbidden_fallback: od_compose_board
  forbidden_aggregations:
    - SUM(MchId)
    - SUM(MchType)
    - SUM(MchRate)
  user_state: failed_with_action
```

再补语义学习完成后的正向用例：核心指标/维度角色正确，真实查询非空，图种与单位正确，preview/runtime 一致，整板截图通过盲评。

只有这两个用例都通过，才能说明系统既会“生成一张好板”，也会在无法保证质量时“拒绝生成坏板”。
