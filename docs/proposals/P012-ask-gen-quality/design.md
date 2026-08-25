# P012 设计：出板质量闸（M1）+ Java last-resort

> 对照：[README](./README.md) · 验收 [acceptance.yaml](./acceptance.yaml)。
> Java last-resort + TS M1（出板）+ M2（问数加厚）已编码。代码落点 `opendashboard-dsh-harness/packages/dsh-od-bi`。验证见 §11。
> 成功标准只反链 PR-QG-*，不另造验收。

## 0. Java last-resort（已开工）[PR-QG-09](./acceptance.yaml)

职责分层：

| 层 | 做什么 | 不做什么 |
|----|--------|----------|
| Java BI | CRUD、schema、query、apply-patch、stats profile、knowledge、questions、learn | 用订单/金额/商户等词给字段打分 |
| dsh `od_generate_board` | 主出板路径（M1 加厚） | 模型自拼 patch |
| Java `compose-board` / `DeterministicPlanner` | last-resort 模板 | 业务词典 |
| `IntentResolver` | 用户原文匹配字段名 / 中文 label | `List.of("收入","商户")` |

角色来源顺序：`de_dataset_field_profile.roleLearned` → schema `group`（q/d/t）→ JDBC type（DATE→time，数值→measure，字符→dim）。

规划选表/选字段：数据集名、物理表名、字段 `name`/`label` 与用户原文的包含关系。glossary 别名已折进 label，不再另开词表循环。

`ConversationHarness` 只回 `HARNESS_DIRECT`，Agent 在 `opendashboard-dsh-harness`。

相对时间「近一年/月/周」是语法，保留。`de_` / `dashboard` 系统表弱数据集判断保留。演示 stub 行（`ds_sales` 等）不是规划词典。

## 1. 目标路径

```text
od_list_datasets（模型选表，已有）
  → od_plan_charts（对话可见分析任务，不定图种；schema-only，无 live GROUP BY）
  → 用户确认
  → od_generate_board({ datasetId, title, message, goals })
       GET  /api/internal/bi/datasets/{id}/schema
       POST /api/internal/bi/profile-dataset      # includeProbes=false
       bind + review
       realizeBoundCharts                         # P015：每任务内部 chartQuery 取样再选图
       reviewCharts + layoutBoardPatch
       apply-patch
  → od_finish
```

Persona / `/board` 继续禁止**模型**先 `od_run_query` / `od_run_sql`。[PR-QG-06](./acceptance.yaml) 取样取数由 [P015](../P015-board-task-realize/) 在 generate 内部完成。

不恢复 `od_review_charts` 工具。review 是 `od_generate_board`（及 `od_plan_charts`）内部函数。

## 2. 输入

| 参数 | 谁填 | 用途 |
|------|------|------|
| `datasetId` | 模型 | 已有 |
| `title` | 模型 | 看板标题；缺省仍「AI 生成看板」或按数据集名 |
| `message` | 模型（用户原话或 /board 主题） | **规划加权**；禁止只当 title [PR-QG-02](./acceptance.yaml) |
| `styleId` | 可选 | 默认 `feishu-blue` |
| `dashboardId` | 可选 | 覆盖已有 draft |

`od_plan_charts` 同样接收可选 `message`，与 one-shot 共用 `planChartsFromFields`。

## 3. Profile（不 live probe）

`profile-dataset` 现行已 `includeProbes=false`。M1 只读：

- `fields[].role` / `distinctCount` / `numericMin` / `numericMax` / `distinctValues`
- `timeFields`、`dims`、`measures`（若有）

失败或空统计：规划仍用 schema 角色 + 用户原文与字段名/label 重叠（**禁止**渠道/商户/金额业务词表）；review 跳过依赖 `distinctCount` 的条；查询条**不填** `fromDefault/toDefault`（禁止假「近 30 天」）。[PR-QG-04](./acceptance.yaml)

## 4. `planChartsFromFields(datasetId, fields, message)`

与 Java last-resort 同一原则：角色来自 schema/profile，加权来自用户原文与字段名/label 重叠，**不**维护渠道/状态/商户/区域/收入词典。

1. `message` 命中某字段 `name` 或 `label`（含 glossary 折进的别名）→ 该字段加权。
2. `mode=single`：`message` 匹配「只要一张 / 单图 / 一个KPI」→ 只留最强 1 张 KPI 或 1 张图，然后仍走 review。这是产品命令，不是业务域词典。
3. 计数 KPI 标题固定「记录数」，除非字段/数据集名本身含「订单」且用户原文也提到该名。[PR-QG-05](./acceptance.yaml)

## 4.1 出板内容质量：先枚举分析目标（Goal），再为每个目标生成图

> 用户确认（2026-08-22）：**禁止**个案黑名单（禁费率…）。  
> 用户确认（2026-08-22）：**废弃「板型槽位填充」**。  
> 用户确认（2026-08-22）：**分析规划以 LLM 为中心** + 可选确认 + Harness 口径闸；纯规则不够。  
> **详细跑法与提示词**：[goal-planning-design.md](./goal-planning-design.md)（大流程→小步骤→能力卡→Prompt→S1 实例）。

### 反模式（已废弃）

```text
measures[0] × dims[0] + 默认 SUM
固定物理槽位 KPI1/柱/饼 填字段
仅靠规则模板 enumerateGoals 当唯一规划器
```

### 正模式（定稿）

```text
能力卡（Harness）
  → LLM 枚举 goals（question + intent + 字段绑定）
  → 歧义则 clarify 一轮 / 否则 plan 展示后用户「确认」
  → bindGoals（measureKind 闸）+ review
  → od_generate_board 一次写入
```

| 职责 | 归属 |
|------|------|
| 问什么、排序、人话 question | LLM（对标 LIDA） |
| 歧义反问、确认再生成 | 多轮 HITL（对标 DeerFlow，不换宿主） |
| 合法字段、SUM/AVG、review | Harness（对标 Joy/Cube） |
| 规则 enumerateGoals | 仅降级 / 单测 |

### `measureKind`（绑定闸，不可跳过）

1. profile / `aggDefault` / confirmed `de_indicator`（P010）  
2. 单位分 → additive  
3. 数值形态 [0,1] / 稳定 [0,100] → 倾向 ratio  
4. 名称弱提示只偏 kind，**不得**当禁止名单  

compare/table 的 value **必须** additive；compose 默认 COUNT；ratio 仅 `kpi_ratio`+AVG。

### 和 M1 / 现行代码

- 布局、强 replace、FE alias/formatter、review R1–R10 **保留**。  
- 现行规则 `enumerateGoals` = 过渡实现；目标态见 [goal-planning-design.md](./goal-planning-design.md) §5–§8。  
- 工程序：P0/P1 能力卡数据 → bind+确认文案 → plan 内 LLM → 规则改 fallback。

### 业界三层集成（改造方案硬定义）

A/B/C 是**能力分层**。**定稿**见 [quality-upgrade-brief.html §6](./quality-upgrade-brief.html#arch)：八项准确技术嵌入 S0–S6，并写死开源用/改编/不用。

| 开源 | 决定 |
|------|------|
| dsh | **采用**（运行时） |
| SQLBot | **改编** 维值/术语注入 |
| Joy DataAgent | **改编** Measure.agg + 校验维；不整仓 |
| LIDA | **借** Goal/critique；不跑 Python 包 |
| Cube/Wren | **借** measure 契约；不部署 |
| DeerFlow / Vanna | **不用**换宿主或第二套 Text2SQL |
| DataEase | **只渲染** |

串线：`S0 资产 → S1 编排 → S2 装载 → S3 Goal → S4a问数|S4b出板 → S5 展示 → S6 反馈`。  
详述：[§4 流水线](./quality-upgrade-brief.html#decomp) · [§5 Harness](./quality-upgrade-brief.html#harness) · [§6 架构选型](./quality-upgrade-brief.html#arch) · [§7 行业备忘](./quality-upgrade-brief.html#roadmap)。

## 5. `reviewCharts(charts, profile)` — 确定性

按顺序自动修复，不阻断 emit（0 图除外）。[PR-QG-03](./acceptance.yaml)

| # | 条件 | 动作 |
|---|------|------|
| R1 | 柱与饼 `category` **且** value+agg 相同 | 丢掉饼。若该维 `distinctCount` 且 `< 6`，可改为留饼丢柱。compare(SUM) 与 compose(COUNT) 同维可并存 |
| R2 | 饼的维 `distinctCount > 20`（无统计则：字段名像 `id`/`mchid`/`user`） | 丢掉饼；可降级 `grouptable` 或柱 + `resultLimit=12` |
| R3 | 折线 category 是 time 且（无日/月桶 **且** `distinctCount > 60` 或字段名含 `time`/`timestamp` 而无 `day`/`month`/`日期`） | 能加日桶则改 encode（若运行时尚不支持桶：直接丢掉该折线，避免毛线） |
| R4 | 假环比：KPI encode 含未实现的 yoy/mom 且无对照度量 | 去掉环比字段 |
| R5 | `table` 且有 category+value | 改为 `grouptable` |
| R6 | 汇总表 > 2 张且维重复 | 最多留 2 张不同维 |
| R7 | 度量 label 含「单位分」 | `style.formatter={unit:0.01}` + 按数量级/用户原文设 `axisUnit`（万/亿）；`encode.fieldCfg` 写入中文 alias | [PR-QG-05](./acceptance.yaml) |
| R8 | profile 标明该 value 字段全空 / 无数值范围且 role=junk | 丢掉该图 |
| R9 | 同 type+category+value+agg 重复图 | 只留第一张 |
| R10 | 对比/构成/表/趋势的 value 为 `ratio` 且 agg=SUM | 丢掉该图（比率只允许 AVG KPI） |

修订 P004：旧文「允许柱饼同维并存」由 R1 替代。理由：对话生成密度已经够，同维双图是噪点；JoyAgent 用行数二选一，不是两张都留。

## 6. `layoutBoardPatch`

| 规则 | 行为 | 验收 |
|------|------|------|
| 查询条 | 有 time → `date-range`，`fromDefault/toDefault` = profile 该字段 min/max（能解析为日期才填） | [PR-QG-04](./acceptance.yaml) |
| 查询条 | 有低基数维（`distinctCount` 2–15 或 status/type）→ `select`，默认「全部」 | 同上 |
| 最多 3 个 query items | 超出按 time > 问题加权维 > 其它 | |
| KPI 行 | ≤4，宽 `floor(72/n)` | 已有 |
| 图（固化模板） | KPI 行后先放全宽趋势；对比/排行/构成最多 4 张（两行 36+36）；单张对比拉满 72；折线/面积独占全宽一行；至多 1 张饼、1 张趋势、1 张汇总表；**禁止半行留白** | [PR-QG-04](./acceptance.yaml) |
| 表 | 全宽 72，最多 1 张 | 已有 |

## 7. 工具与 persona

- **P012 当时不新增** `od_*`。[PR-QG-06](./acceptance.yaml)。后续 [P015](../P015-board-task-realize/) 把 `od_get_data` 等细工具给 board worker，不给对话 Lead。
- `/board`：先 `od_plan_charts` 把分析任务列给用户（不定图种），确认后 `od_board_worker` 按任务取数再选图写入（[P015](../P015-board-task-realize/)）。`od_generate_board` 仅 last-resort。
- 禁止**对话模型**在生成路径调用 `od_run_query` / `od_run_sql` / `od_layout_board` / 自拼 patch。取样问数见 [P015](../P015-board-task-realize/)。
- `od_compose_board` 仍是 last-resort，不作为 M1 主路径。

## 8. 测试夹具（实现时）

在 `gen-board.test.js` 固定字段集，不断网：[PR-QG-07](./acceptance.yaml)

1. 已有：商户订单 junk 订单号 / 不 SUM MchId（回归）
2. 同维 Status 柱+饼 → review 后只留其一
3. `distinctCount: 80` 的 MchId 饼 → 去掉或变表
4. `CreateTime` 无桶 → 无 type=line 或 line 带日桶
5. 3 张 plot → 第三张 component `w=72`
6. profile 有 time min/max → query item 带 fromDefault/toDefault；无 profile → 无假区间
7. message「按支付状态看」→ 至少一张图 category=Status
8. 非订单数据集 → 无标题「订单数」

## 9. architecture 回写（与代码同提交）

[PR-QG-08](./acceptance.yaml)。`#gen` 改为：

- 主路径 `od_generate_board`（schema + **stats profile** + plan + **内置 review** + layout + apply-patch）
- 删除「Lead 调 `od_review_charts`」「live probe 空则停」等与代码不符的步骤
- 质检规则列表与 §5 一致

禁止把 M2/M3 提前写进 `design/architecture.html`。

## 10. 后续切片

| 切片 | 内容 | 状态 |
|------|------|------|
| M1.5 | 规则 Goal + `measureKind` + review R10 | **已编码**（过渡） |
| M1.6 | **LLM Goal 规划主路径** + 能力卡 + 确认/澄清 + bind/`reviewCharts` 闸；对话路径无规则回退 | **已编码** · `goal-planner.js`；无 key / 全闸掉 → plan 失败 |
| M2 | `od_get_schema` sample/terms/questions；0 行 insight；删 stub 假行 | **已编码**（PR-QG-10/11） |
| **P0** | 出板/问数合并 confirmed metrics → kind/agg | **已编码** · `knowledge-merge.js` + `loadSchemaAndProfile` / `od_get_schema` |
| **P1** | 维值 → `encode.fieldCfg.valueMap` | **已编码** |
| M3 | sqlglot / 问数 ECharts / FormatterCfg | 未做 |

## 11. 怎么验证（测试集 vs 实跑）

Python `opendashboard-harness/eval/` 已随 P011 删除。现行分三层，**不要用一次 LLM 对话代替闸门回归**。

### L1 离线确定性（每次改规划必跑）

```bash
cd opendashboard-dsh-harness && pnpm test
```

| 层 | 夹具 | 证明什么 | 证明不了什么 |
|----|------|----------|--------------|
| 出板 | `quality-cases.js` + `gen-board.test.js`（PR-QG-02…05） | 同 schema 下 message 加权、review、layout、formatter | 模型会不会漏调 `od_plan_charts` |
| 问数闸 | `ASK_SQL_CASES` + `sql-guard.test.js` + `ask-enrich.test.js` | 写语句/越权拒；0 行 insight；无 stub 假行文案；terms/questions 裁剪 | 模型生成的 SQL 语义是否答对题 |
| Java last-resort | `mvn -pl open-dashboard-app -am -DskipTests compile` | 无业务词典后能编译 | compose-board 稿面好不好看 |

问数「答对题」仍依赖模型 + schema 加厚；L1 测闸与载荷形状，不测 LLM 正确率。

### 与业界评测集对齐（问数优化后）

公开榜（Spider / BIRD / Spider 2.0）主指标是 **Execution Accuracy**：生成 SQL 与 gold 在同一库执行后结果集等价。产品 ChatBI（SQLBot/Joy）通常用**私有业务金标**，不以公开榜做门禁。

OD 对齐策略（详见 [quality-upgrade-brief.html §13](./quality-upgrade-brief.html#eval-od)）：

| 轨 | 作用 |
|----|------|
| L0 | 现有 sql-guard / enrich（非 EX） |
| **L1′ 私有 EX 金标** | 主门：NL + dataset + knowledge → 执行结果 ≡ gold；含术语/维值/agg/空结果题型 |
| L1″ 公开集适配 | 可选：BIRD Mini-Dev / Spider-dev 冒烟比模型，**不绑** PR-QG |
| 出板 | 继续 Goal/review 单测，不混 Text2SQL 榜 |

**仪表盘生成**：无 Spider 级成熟公开榜。可借鉴 LIDA 的 VER/SEVQ 六维与 nvBench 单图思想；整页看板（DashArena 等）仍早期且非 BI 配置契约。OD 出板主门继续确定性 `gen-board` 金标 + L3，详见 brief [§13.3](./quality-upgrade-brief.html#eval-board)。

**分段评测运行时（已定方向）**：独立于对话的 eval（先包/CLI，后可选薄服务），按 load / plan / query·exec / viz·bind / layout / e2e 拆段金标。详设 [eval-design.md](./eval-design.md)。

### L2 实 schema 干跑（Java :8082 已起，不写 draft）

用内部 token 拉真实 schema / knowledge / questions，本地跑 `buildReviewedBoard` 与 `clipSample(schema.sample)`。不经过 LLM。

### L3 对话实跑（产品手验，不阻塞代码 gate）

1. 重启 dsh 后 **新对话** `/board` 带主题 → plan → generate（**不要**用仍教旧链 `layout/emit` 的历史会话）。
2. `/ask` 一句具体指标；schema 工具结果应含 sample/terms；空结果应有 insight，不应出现华东/华北假行。

L3 失败时：先用 L1 复现规划，再用 L2 确认是真 schema 问题还是模型没传 `message`。

**L3 证据（2026-08-22 · 本地 FE:5173 / BI:8082 / dsh:3090）**

| 路径 | 结果 |
|------|------|
| `/board 按支付状态看商户订单`（新对话） | 用户消息为现行 generate 指令；`od_list_datasets` → `od_plan_charts` → **一次** `od_generate_board`；Draft **68** · **6 图**；~8s；工具 0.1s；未走 `od_layout_board` / `od_emit_patch` |
| `/ask 商户订单按支付状态汇总金额，取前10` | `od_get_schema` → `od_run_query`（柱+表，3 行 Status×Amount）；无华东/华北 stub；~12s |

旧会话里若仍出现「请按 … layout → emit」文案，是历史 user turn，不是现行 `/board` 命令文本。
