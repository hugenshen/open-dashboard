# P004 · 记忆 / 知识体系 / 指标语义对齐 / 数据集自学习 — 端到端落地 POC 方案

> 定位：P004 对话分析（问数 + 看板生成）的**数据质量与语义增强**方案。
> 参考：`ref/deer-flow`（DeepSeek DeerFlow 记忆系统）、`ref/pi`（Pi Agent Harness 会话/知识/评测）。
> 状态：**阶段 1（数据集自学习）已落地**（PR-SL-01..04 pass）；**阶段 2 知识体系 / 阶段 3 Agent 语义增强 / 阶段 4 用户记忆 已按本方案落地**（PR-KB-01..04 / PR-SA-01..05 / PR-UM-01..04 pass，验收判据见 acceptance.yaml）。

---

## 〇、问题回顾（现状代码事实）

1. **字段语义靠关键词硬编码**（`DatasetProfiler.roleOf` / `FieldSemantics.java`）：白/黑名单判 dim/junk/measure，**不看数据本身** → `spending_amount` 认不出是金额、`config_id` 被当 junk、`mch_id` 却被当 dim。
2. **LLM 规划时看不到数据**：`od_get_schema` 只回 `name/label/group/dataType`，**无真实采样行** → 模型只能猜字段含义 → 产出「平均关联配置ID」这类无意义图。
3. **图表规划不读用户意图**：`_plan_charts_from_profile` 纯数据驱动，用户问「趋势」和「对比」产出一样。
4. **无生成前数据探活**：图 emit 后才 `emptyPreview`，空的/查询超时的图会进看板。
5. **无用户记忆**：跨会话不记得用户偏好的指标口径、常用维度、命名习惯。

---

## 一、目标架构（参考 DeerFlow + Pi 的机制映射）

```
┌───────────────────────────── 知识体系层（平台级，跨会话）─────────────────────────────┐
│  IndicatorRegistry（指标注册表）      BusinessGlossary（业务词表）                      │
│  · metric: id/名称/聚合方式/口径       · term → 字段/口径/别名                          │
│  · 由「数据集自学习」+「人工确认」共同填充                                             │
└──────────────┬──────────────────────────────────────────────┬─────────────────────────┘
               │ 注入（frozen-snapshot：静态 prompt 保持缓存，                          │
               │ 知识作为独立 <knowledge> 块注入）              │ 查询/写入
┌──────────────▼─────────────┐                ┌───────────────▼─────────────────────────┐
│  Agent 层（问数/看板生成）   │                │  Memory 层（用户级，跨会话）              │
│  · od_get_schema(带采样)     │                │  · MemoryManager（可插拔 backend）       │
│  · od_profile_dataset(统计)  │                │  · memory_add / memory_search 工具       │
│  · od_interpret_fields(LLM)  │  pre-tool      │  · summarization flush hook（压缩前沉淀）│
│  · od_plan_charts(意图感知)  │  guard         │  · 用户偏好/指标口径/常用维度/命名习惯    │
└──────────────┬─────────────┘                └───────────────┬─────────────────────────┘
               │ 生成前数据探活（emit 前校验行数/空值/超时）      │
┌──────────────▼──────────────────────────────────────────────▼─────────────────────────┐
│  Dataset 自学习（数据集录入时触发，一次录入终身受益）                                     │
│  · schema 采样 20-50 行 → 统计特征（distinct/null 率/数值分布）                          │
│  · 字段角色由「统计 + 命名」联合判定（不再是纯关键词）                                    │
│  · 自动生成候选指标/维度/别名 → 写入 IndicatorRegistry + BusinessGlossary               │
│  · 语义向量（可选）：字段名+label+采样 → embedding，供相似字段/同义词匹配                 │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

### 与参考项目的机制对应

| 需求 | DeerFlow 参考 | Pi 参考 |
|---|---|---|
| 用户记忆 | `MemoryManager` 可插拔（9 方法契约，mem0/honcho/deermem 等 backend 可换）+ `memory_add/search` 工具 + `summarization_hook`（压缩前 flush，`memory_flush_hook`） | 事件溯源会话状态机（append-only JSONL，可 fork lane）+ Compaction 固定模板摘要（Goal/Constraints/Progress(Done/In-Progress/Blocked)/Key Decisions/Next Steps/Critical Context，`compaction.ts` SUMMARIZATION_PROMPT，`retainedTail` 保最近原文） |
| 知识体系 | 无（需自建） | **Skills 文件即知识**（`skills.ts` 扫 SKILL.md frontmatter+markdown，`system-prompt.ts` 以 `<available_skills>` 清单注入、按需读取）——指标口径字典天然用此模式；无 RAG/向量库 |
| 语义对齐 | `FieldSemantics` 关键词（残缺） | Skills + 会话事件溯源；工具参数 TypeBox schema 强校验（`validateToolArguments`）防幻觉参数 |
| 数据集自学习 | 无（需自建） | 无（对 BI 是空白点，需自建） |
| 注入方式 | `dynamic_context_middleware`：静态 prompt 保持 prefix-cache 复用 + `<system-reminder><memory><current_date>` frozen-snapshot 注入 | `system-prompt.ts` 技能清单注入（frozen，不掺动态内容） |
| 多轮/长会话 | summarization 前 memory flush | Compaction 切点不切半轮（`findCutPoint`/`isSplitTurn`）+ 分支摘要（`branch_summary`） |
| 验收 | — | **evals 框架**（`packages/evals`：baseline vs candidate × repetitions + judge 打分 + lift + session JSONL 快照）+ **conformance 测试**（抽象接口多后端共享同一套一致性测试，如 in-memory vs SQLite）+ faux provider（无 API key 也能测 agent 行为） |

> DeerFlow 记忆注入的「frozen-snapshot」是本方案的核心复用点：**静态 system prompt 保持 KV 缓存复用，知识/记忆作为独立块按会话注入**，避免每次生成都重算前缀。

---

## 一·五、端到端整体数据流（存储后如何被使用 —— 一条贯穿时序）

> 这是本方案的**主流程**：从数据录入到用户看到看板，存储的数据在哪个环节被谁写入、谁读取、如何影响产出。四个阶段不是并列的，而是**同一条链上的四个环节**。

```
【T0 · 数据集录入】  （阶段1 自学习触发点）
  用户导入 CSV/Excel 或建数据集
    → DatasetProfileLearner.learn(datasetId)
    → 写 de_dataset_field_profile   [字段统计画像]
    → 写 de_indicator(draft)         [候选指标，如 消费金额→spending_amount(SUM)]
    → 写 de_glossary                 [词表，如 销售额→spending_amount]
    │
    ▼
【T1 · 人工确认】(可选，阶段2)
  管理页「指标确认」tab：draft → confirmed（或废弃）
    → de_indicator.status = confirmed
    → 同步生成 skills/od-metrics/SKILL.md（Pi 技能文件）
    │
    ▼
【T2 · 用户发起问数/生成】  （阶段3 读取点）
  用户输入：「看下各状态分布」/「生成分析看板」
    → harness run_agent()
    → transform_context(agent_msgs, dataset_ids, ...)      [runtime.py:865]
        ├─ 读 de_glossary + de_indicator(confirmed) 该会话数据集的行
        ├─ 渲染 <knowledge> 块（指标口径 + 词表）注入 system   [frozen-snapshot]
        └─ 读 memory_store(user_id) 渲染 <memory> 块（用户偏好）   [阶段4]
    │
    ▼
【T3 · LLM 工具环】（阶段3 核心读取）
  模型按 <knowledge>/<memory> 决定调用工具：
    → od_get_schema(ds)
        └─ 读 de_dataset_field_profile.sample_json + role_learned
           → 返回体带 20 行真实采样 + 已学角色   [模型看到「status=0-草稿」「config_id=123」]
    → od_interpret_fields(ds, fields[])   [新工具]
        └─ 模型读字段名+label+采样+统计 → 输出结构化语义
           → 回写 de_indicator.confidence 提升   [自学习闭环]
    → od_plan_charts(ds, intent)
        └─ 读 de_indicator(confirmed) 选指标（agg/unit 权威）
           └─ 读 profile 统计（flag/id 判定查 distinct_values，不再运行时探测）
    │
    ▼
【T4 · emit 前数据探活】（阶段3 质量闸）
  每个待 emit 的图先查询一次：
    rowCount=0 / 全 null / 查询超时 → 剔除或降级，不进看板
    │
    ▼
【T5 · 落盘 + 记忆沉淀】（阶段3→4 写入点）
    → _emit_applied → apply-patch → 看板 draft + revision 记录
    → 会话结束/压缩 → summarization flush
        └─ 写 memory_store(user_id)   [关键结论、用户确认的口径]
    │
    ▼
【T6 · 下一次会话】  （阶段4 闭环）
  用户新会话 → T2 的 <memory> 块已含上次偏好 → 生成默认贴合用户习惯
```

### 数据「写入 → 读取」完整矩阵（谁写、谁读、何时）

| 存储 | 写入方（何时） | 读取方（何时） | 影响什么 |
|---|---|---|---|
| `de_dataset_field_profile` | DatasetProfileLearner（T0 录入时） | `od_get_schema`（T3 模型看采样+角色）、`_plan_charts_from_profile`（T3 flag/id 判定） | LLM 理解字段；规划不选 ID/标志位 |
| `de_indicator` | Learner 写 draft（T0）；管理页确认→confirmed（T1）；`od_interpret_fields` 提升 confidence（T3） | `od_plan_charts`（T3 选指标）、skills SKILL.md（T2 模型按需读） | KPI/图表指标选择有据可依 |
| `de_glossary` | Learner（T0） | `transform_context` `<knowledge>`（T2）、`resolve_intent`/`od_interpret_fields`（T3 词对齐） | 用户自然语言「销售额」→ 命中字段 |
| `skills/od-metrics/SKILL.md` | 确认指标后生成（T1） | LLM 按需读取（T2/T3，Pi 模式） | 完整口径字典（含公式/单位） |
| `memory_store/{user_id}.json` | `memory_add` 工具（会话中，T3/T5）、summarization flush（T5 结束） | `transform_context` `<memory>`（T2 新会话） | 用户偏好/口径/单位跨会话生效 |

### 关键闭环（为什么"自学习"是自洽的）

```
T0 自学习写画像/候选  →  T3 规划/LLM 用画像选对字段  →  T5 生成结果 + 用户反馈
     ↑                                                     │
     └────────  T3 od_interpret_fields 回写 confidence ◄──┘
                 (生成验证了字段语义，反馈给 de_indicator)

T2 <knowledge>/<memory> 注入  →  T3 产出贴合意图/偏好  →  T5 新记忆沉淀
     ↑                                                    │
     └──────────── T6 下次会话复用，越用越准 ◄────────────┘
```

---

## 二、分阶段落地 POC（每阶段可独立验收）

> **实现约束（不自由发挥）**：以下每一环的实现逻辑**直接沿用 ref 项目的具体代码机制**，只做场景适配（消息类型/字段名换成 BI 的），不改设计模式。对应关系见各阶段「沿用 ref」小节。

### 阶段 0：可复用实现基线（先看 ref 怎么写的，再动手）

以下三个机制是本方案所有阶段的**实现骨架**，来自 `ref/deer-flow` 与 `ref/pi`，落地时直接照搬结构：

| ref 机制 | 位置 | 我们怎么照搬 |
|---|---|---|
| **MemoryManager 契约（可插拔 backend）** | `deer-flow/agents/memory/manager.py` | harness 建 `memory/manager.py`：`add(thread, msgs)` + `get_context(user)` 抽象方法 + `supports_search` 类变量 + `mode=middleware/tool`；backend 目录放 `noop`（默认）+ `deermem`（本地文件） |
| **消息过滤规则（哪些进记忆）** | `deer-flow/.../mem0/message_filtering.py`（与 deermem 同规则） | 保留：用户输入 + 最终 assistant 回复；丢弃：工具调用消息/工具输出/上传占位消息（BI 场景加：丢弃 `intent_map`/`plan` 等系统事件） |
| **信号检测（correction/reinforcement/preference/decision）** | `deer-flow/.../deermem/core/message_processing.py` + `message_patterns/*.yaml` | 建 `message_patterns/`：correction.yaml（不对/你理解错了/改用…）、decision.yaml（就用/决定用…）、preference.yaml（以后/习惯/喜欢…）、trivial.yaml（过滤废话）——中英文正则，照搬 YAML 格式 |
| **LLM 事实抽取（fact_extraction）** | `deer-flow/.../deermem/core/prompts/fact_extraction.yaml` | 照搬 prompt：消息 → JSON `{facts:[{content, category, confidence}]}`，category 限定 preference/knowledge/context/behavior/goal/correction |
| **记忆更新三标签闸门（scope/durability/authority）** | `deer-flow/.../deermem/core/prompts/memory_update.chat.yaml` | 照搬：LLM 给每条候选打 `scope=user/thread/project`、`durability=durable/temporary`、`authority=transactional/descriptive`；**只有 user+durable+descriptive 才入库**——防止把一次性任务细节写进长期记忆 |
| **记忆分层存储结构** | `deer-flow/.../deermem/core/storage.py` `create_empty_memory()` | 照搬 document shape：`{version, revision, lastUpdated, user{workContext,personalContext,topOfMind}, history{...}, facts[]}`，带 revision 冲突检测 |
| **注入格式（frozen-snapshot）** | `deer-flow/.../middlewares/dynamic_context_middleware.py` | 照搬 `<system-reminder><memory>…</memory></system-reminder>` 独立 SystemMessage 注入，静态 system prompt 不掺动态内容 |
| **Debounced 异步写队列** | `deer-flow/.../deermem/core/queue.py` | 照搬：`add()` 入队，后台线程 debounce 合并 + 批量 LLM 抽取，不阻塞对话主线程 |
| **Compaction 摘要模板** | `pi/packages/agent/src/harness/compaction/compaction.ts`（SUMMARIZATION_PROMPT L424-498） | 长会话压缩时，把「用户意图/已确认指标口径/关键决策」按 Goal/Constraints/Progress/Done/Blocked/Key Decisions/Next Steps/Critical Context 模板摘要，`retainedTail` 保留最近原文 |
| **Skills 文件即知识** | `pi/packages/agent/src/harness/skills.ts` + `system-prompt.ts` | 指标口径字典写 `skills/od-metrics/SKILL.md`（frontmatter: name/description + markdown 正文），`system-prompt.ts` 以 `<available_skills>` 清单注入、模型按需读取 |
| **evals 验收** | `pi/packages/evals/`（baseline vs candidate × reps + judge + lift） | 字段角色/意图→图型验收用同一模式：`describe.for` 跑 golden case × N，judge 打分，session 快照 |

---

### 阶段 1：数据集自学习（数据质量地基）— 改动最集中、收益最高

> **沿用 ref**：字段角色的「统计 + 命名联合判定」借鉴 ref 的确定性写闸思路（DeerMem 用 scope/durability/authority 三标签确定性过滤 LLM 输出；我们把同样的"确定性闸门"用在字段角色上——统计特征为准，命名只作候选打分）；「采样喂给模型理解」沿用 Pi 的 constrained-sampling 思路（`pi/packages/ai/src/api/constrained-sampling.ts`——给 LLM 的结构化输入要真实、schema 化，而不是猜）。
> 具体实现：新增 `DatasetProfileLearner` 照搬 DeerMem `updater.py` 的「先过滤→再判定→确定性写闸→落库」四段式；角色判定的规则表（flag/id/measure/dim）作为**确定性写闸**，LLM 只在阶段 3 的 `od_interpret_fields` 里做语义解释（提升 confidence），不直接改角色。

**目标**：数据集录入/首次使用时，自动产出「统计特征 + 字段角色 + 候选指标/维度/别名」，替代纯关键词判断。

**① 流程（触发链）**：

```
数据集录入/导入成功 (DatasetService.importFile / create)
  → 触发 DatasetProfileLearner.learn(datasetId)   [后台异步，不阻塞录入返回]
  → 1. 取字段元数据（de_dataset_field 已有）
  → 2. 采样：SELECT * FROM {table} LIMIT 50   [只读探活，失败不阻断]
  → 3. 逐字段统计：DISTINCT COUNT / NULL COUNT / MIN/MAX / 取值集合(≤20) / 是否时间戳
  → 4. 角色联合判定（统计 + 命名打分，见下）
  → 5. 生成候选指标/别名（词法清洗 + 命名模式）
  → 6. 写入 de_dataset_field_profile（统计）+ de_indicator（候选 draft）+ de_glossary（别名）
  → 7. 标记 dataset.profileLearnedAt = now（幂等：已学习则跳过或增量更新）
```

**② 存储（新增 2 张表 + 复用 1 张）**：

```sql
-- 字段统计画像（每数据集每字段一行）
CREATE TABLE de_dataset_field_profile (
  dataset_id   VARCHAR(64)  NOT NULL,
  field_name   VARCHAR(128) NOT NULL,
  field_label  VARCHAR(255),
  data_type    VARCHAR(32),
  role_learned VARCHAR(16),            -- dim | measure | time | flag | id | junk | text
  role_source  VARCHAR(16),            -- stats | naming | both | manual
  distinct_count   BIGINT,
  null_count       BIGINT,
  null_rate        DOUBLE PRECISION,
  numeric_min      DOUBLE PRECISION,
  numeric_max      DOUBLE PRECISION,
  distinct_values  JSONB,              -- 低基数取值集合 ["0","1"]；高基数存 [min,max]
  is_timestamp_like BOOLEAN,
  sample_json      JSONB,              -- 该字段 20 行真实采样（LLM 语义判断用）
  learned_at   BIGINT,
  PRIMARY KEY (dataset_id, field_name)
);

-- 指标注册表（候选 + 已确认）
CREATE TABLE de_indicator (
  id           BIGSERIAL PRIMARY KEY,
  dataset_id   VARCHAR(64) NOT NULL,
  field_name   VARCHAR(128) NOT NULL,
  name         VARCHAR(128) NOT NULL,   -- 业务名「消费金额」
  agg          VARCHAR(16),             -- SUM | AVG | COUNT | MIN | MAX
  unit         VARCHAR(32),             -- 元 | 万元 | % | 件 …
  formula      TEXT,                    -- 口径说明（如「订单金额 - 退款」）
  description  TEXT,
  status       VARCHAR(16) DEFAULT 'draft',   -- draft | confirmed | deprecated
  source       VARCHAR(16) DEFAULT 'learned', -- learned | manual
  confidence   REAL DEFAULT 0,          -- 0-1，统计/LLM 给的可信度
  created_at   BIGINT,
  updated_at   BIGINT,
  UNIQUE (dataset_id, field_name, name)
);

-- 业务词表（术语 → 字段/别名 对齐）
CREATE TABLE de_glossary (
  id           BIGSERIAL PRIMARY KEY,
  term         VARCHAR(128) NOT NULL,   -- 用户可能说的词「销售额」「消费金额」
  type         VARCHAR(16),             -- metric | dimension | entity | flag
  dataset_id   VARCHAR(64),
  canonical_field VARCHAR(128),         -- 对齐到哪个字段
  aliases      JSONB,                   -- ["销售额","sales","GMV"]
  source       VARCHAR(16) DEFAULT 'learned',
  confidence   REAL DEFAULT 0,
  created_at   BIGINT,
  UNIQUE (term, dataset_id)
);
```

**③ 存储数据如何使用**：

| 存储 | 消费方 | 用途 |
|---|---|---|
| `de_dataset_field_profile.role_learned` | 后端 `DatasetProfiler`（替换 `roleOf` 关键词一票否决） | profile 接口直接读 learned 角色，不再现场猜 |
| `de_dataset_field_profile.distinct_values` | harness `_enrich_count_profile` / `_is_flag_field` | 标志位/ID 判定改为查统计，替代运行时探测查询（省一次查询） |
| `de_dataset_field_profile.sample_json` | harness `od_get_schema`（阶段 3） | 返回体带真实采样，LLM 理解字段 |
| `de_indicator`（draft 候选） | 人工确认 → confirmed；harness `od_plan_charts` 优先用 confirmed 指标 | 生成看板时指标选择有据可依 |
| `de_glossary` | harness `transform_context` 知识注入（阶段 2）；LLM 意图对齐 | 用户说「销售额」→ 命中 `spending_amount` |

**④ 角色联合判定规则（统计优先、命名兜底）**：

```
1. is_timestamp_like → time
2. distinct_count <= 2 且取值 ∈ {0,1,y/n,true/false} → flag（不聚合）
3. distinct_count ≈ 总行数（> 行数*0.9）且数值 → id（不聚合）
4. 数值型且 distinct 高且非 id/flag → measure（候选：SUM/AVG）
5. 字符串低基数（distinct <= 200）→ dim
6. 其余 → text/junk
命名规则仅作「候选打分」修正（如 label 含「金额」但统计像 id → 仍判 id）
```

**改动文件**：`DatasetProfiler.java`（读 learned role）、`FieldSemantics.java`（降级为打分）、新增 `DatasetProfileLearner.java` + `DatasetProfileRepository`、2 张新表 DDL、harness `tools/od_bi.py`（读 profile 统计）。

### 阶段 2：知识体系（IndicatorRegistry + BusinessGlossary）

> **沿用 ref**：
> - 注入方式**照搬 DeerFlow `dynamic_context_middleware.py`**——静态 system prompt 不掺知识（保持 KV 前缀缓存复用），`<knowledge>` 作为独立 SystemMessage 按会话注入（frozen-snapshot 模式，代码结构照搬 middleware 的 `_inject()` + 首会话冻结快照逻辑）。
> - 指标字典**照搬 Pi `skills.ts` + `system-prompt.ts`**——`skills/od-metrics/SKILL.md` 用 frontmatter（`name`/`description`）+ markdown 正文，`system-prompt.ts` 以 `<available_skills><skill><name><description><location>` 清单注入、模型按描述按需读取完整文件（`formatSkillInvocation` 用 `<skill name=...>` 包裹）。
> - 「指标确认」的 draft→confirmed 流程**照搬 DeerMem 的 `confirmationCount` 机制**——指标被多次生成使用且用户未纠偏时 confidence 递增，人工确认即置 confirmed（对应 DeerMem fact 的 confirmationCount 语义）。

**① 流程**：

```
de_indicator(draft) 生成后
  → 后台批量 LLM 校验（可选，OD_LLM_API_KEY 存在时）：字段名+label+采样+统计
    → 输出 name/agg/unit/口径/confidence → 更新 draft 的 confidence
  → 人工确认（数据集管理页新增「指标确认」tab）：draft → confirmed
  → confirmed 指标 + 词表 → 生成 skills/od-metrics/SKILL.md（Pi 模式）
  → 每会话 transform_context 时：查询该会话数据集的 confirmed 指标 + 词表
    → 渲染 <knowledge> 块注入 system（frozen-snapshot）
```

**② 存储**：`de_indicator` + `de_glossary`（结构见阶段 1）。

**③ 使用**：

| 存储 | 消费方 | 用途 |
|---|---|---|
| `de_indicator`(confirmed) | `_plan_charts_from_profile` | 指标 KPI 优先从 confirmed 选（agg/unit 权威），替代现场猜 |
| `de_indicator`(confirmed) | skills `od-metrics/SKILL.md` | 模型按需读取完整口径字典（Pi skills 模式） |
| `de_glossary` | `transform_context` `<knowledge>` 块 | 用户自然语言词 → 字段对齐 |
| `de_glossary` | `resolve_intent` / `od_interpret_fields` | 意图短语映射到字段（intent_map 增强） |

**注入格式（frozen-snapshot）**：
```xml
<system-reminder>
<knowledge>
<metrics>消费金额→spending_amount(SUM,元)；销售数量→qty(SUM,件)</metrics>
<terms>销售额=spending_amount；GMV=spending_amount</terms>
</knowledge>
</system-reminder>
```
静态 system prompt 不含 knowledge（保持 KV 缓存复用），知识随会话注入。

### 阶段 2·五：公共维度管理（维度自学习的落地）

**目标**：把表里**低基数、语义可复用**的维度（状态/渠道/区域/用户/产品/类型）连同**维度值**抽取为公共维度，提供「维度管理」菜单统一查看/确认/改名，并消费到查询条预填、意图对齐与看板维度推荐。

**① 学习策略（在阶段 1 自学习时同步抽取）**：

```
Learner.learn(datasetId) 写 de_dataset_field_profile 后
  → 对每个 role=dim 的字段，按「公共维度候选」条件过滤：
      · distinctCount ≤ 20（低基数，值可枚举）
      · 非长文本（dataType=STRING 且 distinct 低；排除 report_content 类）
      · 非时间（已归 time）
  → 满足条件 → upsert de_glossary：
      term = 字段 label（如「状态：0-草稿」→ 短名「状态」）
      type = 'dimension'
      canonical_field = 字段名（status）
      aliases = [label 清洗出的别名]
      values = distinctValues（维度值，如 ["0-草稿","1-发布","2-归档"]）
      dataset_id / confidence / source=learned
  → 幂等：同 (term, dataset_id) 已存在则更新 values/confidence
```

**② 存储（de_glossary 表扩展 values 列）**：

```sql
-- 在阶段 1 的 de_glossary DDL 基础上，增加维度值列
ALTER TABLE de_glossary ADD COLUMN IF NOT EXISTS values_json JSONB NULL; -- 维度枚举值 ["0-草稿","1-发布"]
ALTER TABLE de_glossary ADD COLUMN IF NOT EXISTS status VARCHAR(16) DEFAULT 'candidate'; -- candidate | confirmed | merged
```

**③ 维度管理页（新菜单「维度管理」）**：

| 交互 | 行为 |
|---|---|
| 列表 | 按数据集/类型（dimension/metric/entity）分组展示：term、来源字段、维度值（chips）、基数、状态（候选/已确认）、置信度 |
| 确认 | candidate → confirmed（确认后进入 `<knowledge>` 注入 + 查询条预填） |
| 改名/别名 | 编辑 term 与 aliases（如「状态：0-草稿」→ term=状态、alias=草稿） |
| 合并 | 同语义维度合并（跨表 status 值统一口径，如 "0-草稿" 与 "草稿" 合并） |
| 删除 | 废弃候选 |

**④ 消费方（价值落点）**：

| 消费方 | 用途 |
|---|---|
| 查询条 select 预填 | 生成看板/问数时，维度管理里的 confirmed 维度值直接做 select 选项（替代实时查询） |
| 意图对齐 | 用户说「草稿状态的报告」→ 命中 `status` 维度 + 值「0-草稿」（resolve_intent 增强） |
| `<knowledge>` 注入 | confirmed 公共维度（term+values）进 frozen-snapshot，模型生成时按统一口径选维度 |
| 看板维度推荐 | `od_plan_charts` 优先用 confirmed 公共维度（跨数据集一致） |

**改动文件**：`V12__glossary_dimension.sql`（values/status 列）、`Learner` 抽取逻辑、`GlossaryGateway`/`GlossaryRepository`、`DimensionController`（列表/确认/改名/合并）、前端 `DimensionManage.vue` + 路由菜单。

### 阶段 3：Agent 语义增强（LLM 路径理解字段）

> **沿用 ref**：
> - `od_interpret_fields` 的**结构化输出**照搬 Pi `constrained-sampling.ts`——给 LLM 的 schema 只含 `type/properties/required` 等简单键，输出强校验（对应 Pi `validateToolArguments()` 在 loop 内校验，防幻觉参数）。
> - **工具环接入**照搬 Pi `agent-loop.ts`——新工具按 `AgentTool(label + schema + execute + executionMode)` 注册，`beforeToolCall` 钩子做字段权限/可聚合性拦截（对应我们 emit 前数据探活）。
> - **采样喂 LLM**照搬 Pi 的「给模型真实上下文」思路（session 原文保留，不让模型猜）。

**① 流程**：

```
Lead 路径规划前：
  od_get_schema(ds)  → 返回体带 sample（来自 de_dataset_field_profile.sample_json）
  od_interpret_fields(ds, fields[])  → LLM 逐字段输出语义：
      {field, role, businessMeaning, aggregatable, alias[], suggestedAgg}
      [新工具；LLM 不可用时回退 learned role]
  od_plan_charts(ds, intent)  → 读用户问题 + 指标/维度语义 → 选图组合
  emit 前数据探活：每图查询一次，rowCount=0 或全 null → 剔除/降级（不 emit）
```

**② 存储**：复用阶段 1/2（profile + indicator + glossary）；`od_interpret_fields` 结果可回写 `de_indicator.confidence` 提升。

**③ 使用**：
- `od_get_schema.sample`：LLM 看到真实行（`status=0-草稿`、`config_id=123`），字段含义一目了然
- `od_interpret_fields`：一次性覆盖未知字段名（`insight_object_values` 这类黑话字段）
- `intent → charts`：`_plan_charts_from_profile(ds, profile, mode, intent)`，意图决定图表类型组合
- **数据探活**：emit 前校验，杜绝空图/全 null 图进看板（回应「展示的数据最重要」）

**改动文件**：`tools/od_bi.py`（schema 带 sample、新工具 od_interpret_fields、plan 加 intent、emit 前探活）、`agent/runtime.py`（LLM 环接入新工具）、`agent/context.py`（提示词加字段语义要求）。

### 阶段 4：用户记忆（跨会话）

> **沿用 ref**：本阶段**整体照搬 DeerMem backend 的实现逻辑**（`ref/deer-flow/agents/memory/backends/deermem/`），只把消息类型/场景词换成 BI 的。不改设计模式。

**① 流程（照搬 DeerMem 五模块）**：

```
【写路径】（会话进行中，仿 deermem/core/{queue,message_processing,updater}.py）
  add(thread_id, messages)                        [MemoryManager.add 入口]
    → filter_messages_for_memory(messages)        [照搬 message_filtering.py：
       保留用户输入+最终 assistant 回复；丢弃工具调用/工具输出/上传占位/
       intent_map/plan 等系统事件]
    → detect_signals(messages[-6:])               [照搬 message_patterns/*.yaml：
       correction「不对/你理解错了」/ decision「就用/决定用」/
       preference「以后/习惯」/ reinforcement「很好/对」]
    → 入 MemoryUpdateQueue（debounce 合并，后台线程处理，不阻塞对话）[照搬 queue.py]
    → MemoryUpdater 调 LLM：
        fact_extraction prompt（照搬 fact_extraction.yaml）
          → {facts:[{content, category(preference|knowledge|context|behavior|goal|correction), confidence}]}
        再由 memory_update prompt（照搬 memory_update.chat.yaml）打三标签：
          scope=user|thread|project, durability=durable|temporary, authority=transactional|descriptive
        → 只有 scope=user + durable + descriptive 才写入 storage  [确定性写闸]
    → storage.upsert（revision 冲突检测）          [照搬 storage.py]

【读路径】（新会话开始，仿 deermem/core/{retrieval,prompt}.py）
  get_context(user_id)                            [MemoryManager.get_context]
    → 读该 user 的 memory.json
    → format_memory_for_injection（照搬 prompt.py）：
       按 max_injection_chars 预算逐条拼 "- {fact.content}"，保整条不切半
       （照搬 mem0_manager.get_context 的 entry-boundary 截断逻辑）
    → 返回注入文本
  transform_context 渲染 <system-reminder><memory>…</memory></system-reminder>
    [照搬 dynamic_context_middleware.py：静态 prompt 不掺动态内容]
```

**② 存储（照搬 DeerMem `create_empty_memory()` document shape）**：

`~/.od-harness/memory/{user_id}.json`（每用户一文件，带 revision 乐观锁）：

```json
{
  "version": "1.0",
  "revision": 3,
  "lastUpdated": "2026-08-18T12:00:00Z",
  "user": {
    "workContext":  { "summary": "数据产品经理，负责 BI 看板体系", "updatedAt": "..." },
    "personalContext": { "summary": "偏好万元单位，深色主题", "updatedAt": "..." },
    "topOfMind": { "summary": "近期在搭指标口径字典；关注销售与报告配置两个数据集", "updatedAt": "..." }
  },
  "history": {
    "recentMonths": { "summary": "…", "updatedAt": "..." },
    "earlierContext": { "summary": "…", "updatedAt": "..." },
    "longTermBackground": { "summary": "…", "updatedAt": "..." }
  },
  "facts": [
    {
      "id": "f_1a2b",
      "content": "用户偏好金额用万元展示",
      "category": "preference",
      "confidence": 0.9,
      "source": {"type": "conversation", "threadId": "t_11"},
      "confirmationCount": 1,
      "createdAt": "...", "updatedAt": "..."
    },
    {
      "id": "f_3c4d",
      "content": "用户常用维度：状态、产品",
      "category": "behavior",
      "confidence": 0.7,
      "source": {"type": "conversation", "threadId": "t_12"},
      "confirmationCount": 2,
      "createdAt": "...", "updatedAt": "..."
    }
  ]
}
```

（字段语义完全照搬 DeerMem：`facts[]` 含 id/content/category/confidence/source/confirmationCount/时间戳；`user.*`/`history.*` 是分层摘要区，由 updater 维护。）

**③ 使用（照搬 format_memory_for_injection + memory tools）**：

| 存储 | 消费方 | 用途 |
|---|---|---|
| `facts`（preference） | `transform_context` `<memory>` 块（get_context） | 会话 B 生成时默认「万元」单位（PR-UM-03） |
| `user.personalContext` | `<memory>` 块 | 用户偏好/背景一句话注入 |
| `user.topOfMind` | `<memory>` 块 | 当前关注点（最近在做哪个数据集） |
| `memory_search`（照搬 deermem search：大小写不敏感子串） | agent 工具环 `memory_search(query)` | 按需召回（query-aware，不全部塞 prompt） |
| `memory_add`（照搬 mem0/deermem add 工具） | agent 工具环 | 显式写入「以后金额用万元」 |

**注入格式（照搬 dynamic_context_middleware）**：
```xml
<system-reminder>
<memory>
- 用户偏好金额用万元展示
- 用户常用维度：状态、产品
</memory>
</system-reminder>
```

**改动文件**：harness 新增 `agent/memory/`（manager.py 契约 + backends/noop + backends/deermem 目录，照搬 ref 结构）、`memory_add/memory_search` 工具注册（照搬 `deer-flow/.../memory/tools.py`）、`transform_context` 注入 `<memory>`（照搬 middleware）、会话结束 flush 钩子（照搬 `summarization_hook.py`）。

---

## 三、验收准则（每阶段独立 gate）

### 阶段 1（数据集自学习）
| ID | 验收项 | 判据 |
|---|---|---|
| PR-SL-01 | 字段统计特征 | 录入 ds_1ea87e50 后，`de_dataset_field_profile` 有每字段 distinct/nullRate/数值分布 |
| PR-SL-02 | 角色判定正确 | `config_id`→junk(id)、`spending_amount`→measure、`status`→dim、`enable_flag`→flag；**全部由统计判定，不看关键词** |
| PR-SL-03 | 采样进 schema | `od_get_schema(ds_1ea87e50)` 返回体含 ≥10 行真实采样 |
| PR-SL-04 | 候选指标生成 | 自学习产出「消费金额(amount,SUM)」类候选指标，status=draft |
| PR-SL-05 | 回归 | e2e_seed_fact 的 amount/qty 仍正确 measure；报告表不产出 ID/标志位聚合 |

### 阶段 2（知识体系）
| ID | 验收项 | 判据 |
|---|---|---|
| PR-KB-01 | 指标注册表 | `de_indicator` 可 CRUD，含 agg/unit/口径/status/confidence |
| PR-KB-02 | 词表对齐 | 问「销售额」能匹配到 `spending_amount`（经 alias） |
| PR-KB-03 | 知识注入 | harness 生成的 system 含 `<knowledge>` 块（frozen-snapshot，静态 prompt 不变） |
| PR-KB-04 | skills 指标字典 | `skills/od-metrics/SKILL.md` 存在，模型可读取已确认指标 |

### 阶段 3（Agent 语义增强）
| ID | 验收项 | 判据 |
|---|---|---|
| PR-SA-01 | LLM 见采样 | Lead 路径 `od_get_schema` 后模型消息含真实采样行（trace 可查） |
| PR-SA-02 | 字段解释 | `od_interpret_fields` 对未知字段（如 `insight_object_values`）输出合理 role/含义 |
| PR-SA-03 | 意图→图表 | 问「按月份看趋势」产出含 line；问「各区域对比」产出 hbar；问「渠道占比」产出 pie |
| PR-SA-04 | 数据探活 | 无数据/全 null 的图在 emit 前被剔除（不再进 emptyPreview） |
| PR-SA-05 | 端到端 | ds_1ea87e50 生成看板：4 图全基于 status 计数，无 ID/标志位聚合（回归基线） |

### 阶段 4（用户记忆）
| ID | 验收项 | 判据 |
|---|---|---|
| PR-UM-01 | 记忆写入 | `memory_add` 工具可写「用户偏好 X」，落盘 user 维度 |
| PR-UM-02 | 记忆检索 | `memory_search` 可召回，注入 `<memory>` 块 |
| PR-UM-03 | 跨会话生效 | 会话 A 确认「金额用万元」→ 会话 B 生成默认万元单位 |
| PR-UM-04 | 压缩沉淀 | 长会话结束，关键结论自动进记忆（无手动操作） |

### 全局
| ID | 验收项 | 判据 |
|---|---|---|
| PR-E2E-01 | 全链路 | 新数据集录入→自学习→问数/生成→（记忆沉淀）→再会话，端到端可用 |
| PR-E2E-02 | 回归 | 既有 P004 验收（PR-CONV-02/03/04/09-12）不回归 |
| PR-E2E-03 | 评测 | 复用 harness-evaluation.md 的 golden case 集，新增字段角色/意图案例 |

### 数据流验收（存储数据确实被消费，而非只写不读）
| ID | 验收项 | 判据 |
|---|---|---|
| PR-DF-01 | profile 被读 | 生成时 `od_get_schema` 返回体含 `sample_json` 与 `role_learned`（抓 SSE 的 schema 事件验证），且规划不再产生 ID/标志位聚合（证明 role 生效） |
| PR-DF-02 | 指标被用 | 数据集有 confirmed 指标时，生成看板 KPI 从 `de_indicator` 取 agg/unit（看板 title/encode 含 confirmed 指标名与单位） |
| PR-DF-03 | 词表被用 | 用户输入含 glossary term（如「销售额」）时，trace 中 `intent_map`/`od_interpret_fields` 命中对应字段 |
| PR-DF-04 | 记忆被读 | 新会话 system 含 `<memory>` 块（trace 的 context 事件可查），且偏好（如万元）影响生成单位 |
| PR-DF-05 | 探活闸生效 | 对空表/全 null 数据集生成：无空图进看板（board_ready 的 charts 均 rowCount>0） |
| PR-DF-06 | 自学习闭环 | 生成验证后的字段语义回写 `de_indicator.confidence`（生成前后 confidence 值变化） |

---

## 三·五、每阶段交付物清单（代码 + 数据 + 可验证产物）

| 阶段 | 代码交付 | 数据交付 | 可验证产物 |
|---|---|---|---|
| 1 数据集自学习 | `DatasetProfileLearner.java`、`DatasetProfileRepository`、2 张新表 DDL、`FieldSemantics` 降级 | `de_dataset_field_profile` 每字段统计行；`de_indicator` draft 候选；`de_glossary` 别名 | 录入 ds_1ea87e50 后三张表有数据；`od_get_schema` 含 sample |
| 2 知识体系 | `de_indicator` CRUD 接口 + 管理页确认 tab、`transform_context` 知识注入、`skills/od-metrics/SKILL.md` 生成器 | confirmed 指标 + 词表 + SKILL.md 文件 | 管理页确认「消费金额」→ confirmed；新会话 system 含 `<knowledge>` |
| 3 Agent 语义 | `od_get_schema` 带 sample、`od_interpret_fields` 工具、plan 加 intent、emit 前探活 | `od_interpret_fields` 结果回写 indicator confidence | 趋势/对比/占比问题产出对应图型；空数据图 emit 前被剔除 |
| 4 用户记忆 | `agent/memory_store.py`、`memory_add/search` 工具、`transform_context` 记忆注入、flush 钩子 | `~/.od-harness/memory/{user_id}.json` | 会话 A 偏好 → 会话 B 生效；长会话自动沉淀 |

---

## 四、落地顺序与依赖

```
阶段1 数据集自学习 ──► 阶段2 知识体系 ──► 阶段3 Agent语义 ──► 阶段4 用户记忆
   （地基，无依赖）      （依赖1的表）      （依赖1+2）        （依赖3的注入机制）
```

- **先做阶段 1**：它是数据质量的总根源，且独立可验收。
- **阶段 2** 承接阶段 1 的候选指标，人工确认后成为权威口径。
- **阶段 3** 让 LLM 真正"看到数据"，叠加阶段 2 的知识。
- **阶段 4** 最后做（记忆的价值建立在前面语义准确之上）。

> 与之前评估一致：**双 agent（规划+质检）暂缓**——当前确定性 A 层权威已保证规划稳定，质检缺口在数据/语义（阶段 1-3），不在"多一个 LLM 角色"。
