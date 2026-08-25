# P012 · Harness 分段评测方案（Ask / Board）

> 状态：设计草案（2026-08-22）· 归属 [P012](./README.md)  
> **执行优先级**：先完成问数/出板流水线（P0/P1/M1.6），再扩评测 E0.2+。E0.1 脚手架可保留作门禁，不抢主路径开发。  
> 关联：[brief §13](./quality-upgrade-brief.html#verify) · [design §11](./design.md) · [goal-planning-design.md](./goal-planning-design.md)

## 1. 结论（先答「你觉得呢」）

**同意：按核心流程拆段评测 + 金标（问题×数据集×期望）+ 与产品运行时隔离。**

**对「单独新建一个评测服务」：方向对，但建议分两期，避免一上来过重。**

| 期 | 形态 | 为什么 |
|----|------|--------|
| **E0（先做）** | 独立包 / CLI：`opendashboard-dsh-eval`（或 harness monorepo 下 `packages/dsh-od-eval`） | 分段断言、金标 YAML、可进 CI；不污染对话路径 |
| **E1（需要时）** | 薄 HTTP「评测服务」：只编排跑批、存分、触发对比 | 定时回归、多模型 A/B、分数看板时再升服务 |

评测服务**只驱动**现有 dsh + Java BI，**不复制** Text2SQL / gen-board 业务逻辑。确定性阶段优先直接调用导出的纯函数；含 LLM 的阶段走与线上一致的工具协议。

---

## 1.1 开源方案 / GitHub：哪些能直接用

**结论：问数（Text2SQL）有成熟开源评测库；出板整页没有可整仓替换的；分段 Agent 评测可借 LangSmith 思路，但跑分仍要接我们的 `od_*`。**

### 问数 · 优先照搬（判分内核）

| 仓库 | 链接 | 提供什么 | OD 怎么用 |
|------|------|----------|-----------|
| **BIRD 官方评测** | [AlibabaResearch/DAMO-ConvAI `bird`](https://github.com/AlibabaResearch/DAMO-ConvAI/tree/main/bird) · [bird-bench/mini_dev](https://github.com/bird-bench/mini_dev) | **EX / VES / Soft-F1** 脚本；Mini-Dev 轻量集 | **改编 `evaluation_ex.py` 结果集比对**进 `dsh-od-eval` 的 ask-exec 段；Mini-Dev 作换模型冒烟（不绑 acceptance） |
| **BIRD 一键跑** | [oneconvergence/bird-bench](https://github.com/oneconvergence/bird-bench) | 多方言 + EX/R-VES/Soft-F1 流水线 | 参考 runner 形状；生成端换成「调 OD `od_run_sql`」适配器 |
| **Spider test-suite** | [taoyds/test-suite-sql-eval](https://github.com/taoyds/test-suite-sql-eval) · [Yale-LILY/spider](https://github.com/Yale-LILY/spider) | 官方 Spider 执行/匹配评测 | 同：只借 **exec match**；数据集可选 |
| **Spider 2.0** | [xlang-ai/Spider2](https://github.com/xlang-ai/Spider2) | 企业级工作流 + `evaluation_suite` + Spider-Agent | 可选压力测；重、多方言，**不进默认 CI** |
| **Defog sql-eval** | [defog-ai/sql-eval](https://github.com/defog-ai/sql-eval) | LLM SQL 正确率评测脚手架 | 可参考 prompt/跑批；金标仍用我们业务表更稳 |

### 问数 · 产品仓（有问数，无标准评测服务）

| 仓库 | 说明 | 不要指望 |
|------|------|----------|
| [dataease/SQLBot](https://github.com/dataease/SQLBot) | 问数产品；训练对 / 术语 | **没有**公开 EX 评测框架可搬 |
| [vanna-ai/vanna](https://github.com/vanna-ai/vanna) | RAG Text2SQL 库 | 自测/demo，不是标准榜 runner |
| [Canner/WrenAI](https://github.com/Canner/WrenAI) | GenBI + MDL | 语义层产品，评测靠自建 |
| [eosphoros-ai/DB-GPT](https://github.com/eosphoros-ai/DB-GPT) | 多 Agent 问数 | 同：产品为主 |

→ **符合我们「问数 EX」的，是 BIRD/Spider 评测脚本，不是 SQLBot/Vanna 本体。**

### 分段 / Agent 轨迹（对标规划·工具链）

| 仓库 / 产品 | 链接 | 提供什么 | OD 怎么用 |
|-------------|------|----------|-----------|
| LangSmith SQL agent eval | [langsmith-cookbook SQL agent](https://github.com/langchain-ai/langsmith-cookbook/tree/main/testing-examples/agent-evals-with-langgraph) | 轨迹 + 工具调用 + LLM-judge | **借鉴分段维度**（理解/SQL/执行/结果）；实现上用我们的 stage YAML，不必绑 LangChain |
| Trajectory / tool precision 教程 | [FareedKhan-dev/ai-agents-eval-techniques](https://github.com/FareedKhan-dev/ai-agents-eval-techniques) | 轨迹是否按预期调工具 | `/board` 期望工具序：`list→plan→generate`；`/ask`：`list→schema→run_*` |

### 出板 / 可视化（仅借方法，无整仓）

| 仓库 | 链接 | 说明 |
|------|------|------|
| [microsoft/lida](https://github.com/microsoft/lida) | VER + SEVQ 六维 critique API | 借维度 → `reviewCharts`；不跑 LIDA 主进程 |
| nvBench / Text2Vis | 单图 NL2VIS 榜 | 最多对照单图类型；不是经营 draft |
| DashArena / Dashboard2Code | 交互看板论文评测 | 契约是 Plotly 等，**不直接套** |

### 推荐「开源拼装」进 OD eval（与 E0 对齐）

```text
ask-exec 判分内核  ← 改编 BIRD evaluation_ex（结果集 ≡）
ask 公开冒烟       ← bird-bench Mini-Dev 适配器（可选）
工具轨迹断言       ← 自研（对标 LangSmith trajectory，不强制依赖）
board plan/bind    ← 自研金标 + LIDA 维度名
board layout       ← 现有 gen-board.test 升格
```

**禁止**：把 BIRD/Spider runner 当唯一产品门；把 SQLBot/Vanna 当「评测框架」整仓接入。

---

## 2. 为什么要拆段（而不只做端到端）

端到端失败时分不清是「规划错了」还是「取数错了」还是「组装坏了」。  
拆段后：每段有独立金标与通过率；E2E 只做冒烟与回归总览。

```text
问数轨 /ask          出板轨 /board
─────────────        ─────────────────
S-load 装载          B-load 装载（同源资产）
S-plan*（可选澄清）   B-plan 分析规划（Goal）
S-query 取数生成      B-bind 目标→encode
S-exec 执行结果       B-review 质检闸
S-viz 结果卡/选图     B-layout 图表组装
S-e2e 问数端到端      B-e2e 出板端到端
```

\* 问数默认一问一答，无整板 Goal；若未来有多轮澄清，再加 S-clarify。

---

## 3. 分段契约（期望 vs 实际）

每条用例统一壳：

```yaml
id: BOARD-PLAN-S1-01
track: board          # ask | board
stage: plan           # load | plan | query | exec | viz | bind | review | layout | e2e
dataset:
  id: <datasetId>     # 真表或 fixture schema
  fixture: merchant-order-schema.json   # 离线可只用 fixture
input:
  message: "按支付状态看入账"
  # plan 阶段可选：capabilityCard 快照 / 用户确认后的 goals
expect:
  # 按 stage 不同（见下）
 dual:
  compare: soft        # exact | soft | rubric
```

### 3.1 装载 `load`（问数 / 出板共用）

| 测什么 | 期望 | 实际从哪来 | 判分 |
|--------|------|------------|------|
| 字段角色 / sample / terms | `fields[].role`、terms 含「入账→MchIncome」 | `od_get_schema` 或 `loadSchemaAndProfile` | 字段集合 ⊆ / 关键 term 命中 |
| confirmed 指标 agg（P0） | `MchIncome.agg=sum`，`FeeRate.kind=ratio` | knowledge/indicator 合并结果 | exact on kind/agg |

### 3.2 规划 `plan`（出板主段 · 对标 LIDA Goal）

| 测什么 | 期望 | 实际 | 判分 |
|--------|------|------|------|
| Goal 列表 | 3～6 条；含 compare/趋势等标签 | `od_plan_charts` / LLM goals JSON | **soft**：必含题型集合；可选 LLM-judge「贴题」 |
| 澄清触发 | 模糊主题 → `needClarify=true` | 规划器输出 | exact |
| 降级路径 | LLM 失败 → 规则 goals 仍非空 | fallback | exact non-empty |

规则 fallback 用 deterministic 断言；LLM 主路径用「必含 goal 类型 + 禁止出现禁度量」软金标。

### 3.3 取数 `query` + `exec`（问数主段）

| 测什么 | 期望 | 实际 | 判分 |
|--------|------|------|------|
| 生成查询 | gold SQL **或** 结构化 encode（维/度量/agg） | `od_run_sql` 文本 / `od_run_query` args | soft：字段+agg 对齐；或 EX |
| 执行结果 | 结果指纹 / 行数区间 / 关键单元格 | Java 查数结果 | **EX**（结果集等价，对齐 BIRD） |
| 闸 | 非法 SQL 拒绝 | sql-guard | exact allow/deny |

### 3.4 图表 `viz` / `bind`（问数选图 · 出板 encode）

| 测什么 | 期望 | 实际 | 判分 |
|--------|------|------|------|
| 问数选图 | `chartType∈{bar,…}` | `suggestChartType` / enrich | exact or allow-set |
| 出板一 Goal 一图 | `goals[i] → charts[i].type/encode` | `planChartsFromFields` / bind | encode 字段+agg exact；type soft |
| 口径 | 禁止 `FeeRate` + SUM | review 前后 charts | exact 违规=0 |

### 3.5 组装 `layout`（出板）

| 测什么 | 期望 | 实际 | 判分 |
|--------|------|------|------|
| 组件数 / 无重叠 / 查询条 | `components.length`、bbox 不叠、≤1 filter | `layoutBoardPatch` | exact |
| 强 replace 不叠板 | 二次生成后 id 集合 = 本次 | apply-patch 后 draft（E2E） | exact |

### 3.6 端到端 `e2e`

| 轨 | 输入 | 期望（粗） | 注意 |
|----|------|------------|------|
| ask | `/ask` + 题 | 有结果卡或诚实 0 行；无假 stub | 不写 draft |
| board | `/board` + 主题 | plan 可见 → 一次 generate → draft 可读 | 禁 run_query |

E2E 失败必须能下钻到失败 stage（评测 runner 按段重放）。

---

## 4. 评测运行时架构

```text
┌─────────────────────────────────────────┐
│  dsh-od-eval（E0 CLI / E1 薄服务）        │
│  cases/*.yaml · runner · scorers · report │
└────────────┬───────────────┬────────────┘
             │               │
     确定性 stage      含 LLM / 真查数 stage
             │               │
             ▼               ▼
   import gen-board.js   HTTP → dsh tools
   ask-enrich / sql-guard   + Java :8082 BI
             │               │
             └─────── scores.json / JUnit 式摘要
```

**硬边界**

- 评测进程 **不** 嵌入用户对话会话状态机。
- 不在评测里重新实现 encode/SQL；只断言与驱动。
- 真数 E2E 用内测库 / 只读账号；CI 默认跑 fixture + 确定性段。
- LLM 段：固定 temperature、记录 model+prompt 版本，分数带「模型指纹」。

---

## 5. 金标集怎么建

| 集 | 规模（起步） | 内容 |
|----|--------------|------|
| `fixtures/merchant-order` | schema + 小样例行 + terms | 与 S1 夹具对齐 |
| `cases/board-plan/*.yaml` | 15～20 | 主题 → 必含 goal 类型 / 澄清 |
| `cases/board-bind-review/*.yaml` | 20+ | kind/R10/布局 |
| `cases/ask-ex/*.yaml` | 30～50 | NL → EX / agg / 空结果 |
| `cases/e2e-smoke/*.yaml` | 5～8 | 每晚或发版前 |

公开集（BIRD Mini-Dev 等）只作可选适配器，不进默认门禁（见 brief §13）。

---

## 6. 与现有测试的关系

| 现有 | 继续做什么 | 评测服务补什么 |
|------|------------|----------------|
| `gen-board.test.js` | 纯函数回归 | 升格为 board-bind/review/layout 金标源 |
| `sql-guard` / `ask-enrich` test | L0 闸 | 纳入 ask-query 门禁子集 |
| `acceptance.yaml` PR-QG-* | 产品验收 ID | 评测报告可映射到 PR-QG；不替代人工 L3 |
| 对话手验 L3 | 体验 | E2E smoke 自动化后仍保留少量手验 |

---

## 7. 交付切片（建议挂 P012 后续或独立子里程碑）

| 切片 | 交付物 | 依赖 | 状态 |
|------|--------|------|------|
| **E0.1** | `packages/dsh-od-eval`：runner + JSON 金标 + board plan/bind/layout/realize/review/worker/cockpit + ask guard/viz/ex | 现有 gen-board / P015 worker 导出 | **已编码** · `pnpm eval` |
| **E0.2** | ask EX 真连 Java 只读执行比对（扩 30 题） | BI 内测库 | **暂缓**（流水线 P0/P1/M1.6 优先） |
| **E0.3** | board plan LLM soft 金标 + 模型指纹报告 | M1.6 LLM Goal | **暂缓** |
| **E1** | 可选：评测 HTTP + 分数存储 + 定时跑 | E0 稳定后 | **暂缓** |

**不做（本期）**

- 把评测做成第二套对话 Agent  
- 以 DashArena / nvBench 公开分替代私有金标  
- 在评测服务里写 DashboardPatch 业务逻辑  

---

## 8. 对你方案的微调一句话

> 「独立评测服务专门打 harness」→ **先做独立评测包打 harness（分段金标）**；跑批/看板需求明确后再把同一 runner 封成薄服务。  
> 分段（规划 / 取数 / 图 / 组装 / E2E）**保留，作为主设计。**
