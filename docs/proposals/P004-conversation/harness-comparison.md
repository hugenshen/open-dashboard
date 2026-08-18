# DeepSeek Harness 设计与核心流程 · 与看板/问数项目的综合对比

> 分析对象：
> - `deepseek-harness/` —— 插件化 Agent Harness（Cordis 基底）
> - `open-dashboard/` —— Vue3 看板画布 + Spring Boot BI + `opendashboard-harness`（Python 对话 Harness）
> - 问数 / 仪表盘生成 —— `zte-dmt-sdp-dataai`（OID 平台）、`zte-dmt-sdp-datadriven`（DeerFlow 侧）等
>
> 结论先行：这四套东西解决的是不同层次的问题。把 **Harness 的"可组合/可观察/可治理"工程能力** 反哺到 **看板项目"问数+生成"的 AI 链路** 上，是收益最大、成本可控的一条升级路径。

---

## 一、DeepSeek Harness：设计哲学与核心流程

### 1. 定位与总设计

DeepSeek Harness（下称 dsh）是一个**插件化、可组合的 Agent Harness**，构建在 vendored 的 Cordis 框架之上。第一原则只有一句话：

> **Everything is a plugin（一切都是插件）。**

没有"特权核心"需要你去打补丁。模型适配器、工具注册表、会话日志、Agent 循环本体本身都是插件，全部可以从配置（`cordis.yml` → profile → bundle patch 分层）替换。扩展方式是"在别的插件旁边挂上你的插件"，副作用在一卸载时自动解绑（`ctx.effect()` / `ctx.on()` / `register()` 返回 disposer）。

关键架构概念：
- **Profile / Bundle / Patch 分层**：一个 running dsh 是这样拼出来的 —— profile 按序叠 bundle，再叠用户 `cordis.patch.yml`、home 级 patch、`--patch` overlay。任何一行配置都可被上层 patch 覆盖/插入。`dsh --profile web --dump-config` 能打印你机器实际 boot 出来的全部插件树。
- **Capability seam（能力接缝）**：一个可替换能力 = 三个角色 `Service Definition`（声明接口）＋ `Service Provider`（实现）＋ `Consumer`（使用，通常是模型可调工具）。三件套齐全才算"一个能力"。这正是"换 Provider 整个产品跟着动"的根源。

### 2. 核心包 / 领域

| 包（`packages/`） | 归属 | ctx key |
|---|---|---|
| `core/session` | 只能追加的 `SessionEvent` 日志 + 内存态 | `ctx.sessions` |
| `core/system-prompt` | 提示词分段 + 工具 schema 组装 | `ctx.systemPrompt` |
| `core/tools` | 作用域工具注册表 + 受管执行管线 | `ctx.tools` |
| `core/agent` + `agent-loop` | `Agent` 接口 / 实时注册表 / 默认驱动 | `ctx.agents` / `ctx.agentLoop` |
| `llm/llm` | 消息/流词汇 + 适配器接缝 | `ctx.llm` |
| `skill` / `subagent` / `workflow` / `plan` / `todo` / `guard` / `compaction` … | 各项能力 | … |

### 3. 核心流程

#### 3.1 Turn / Step 循环（agent-loop）
一句话：**一个 step = 一次模型请求 + 它调用的工具；一个 turn = ≥0 个 step，开到第一个输入被领取，关到不再欠任何东西。**

```text
turn/start
  claim next-step 输入 + 一条排队消息
  组装 prompt 片段 + 工具 schemas
  → agent/pre-step                  reject | enter(messages)
      step/start
      从日志派生模型历史 (deriveMessages)
      agent/request → llm/stream → assistant/chunk* → assistant/message
      tool/call* → tools/pre-execute → tools/execute → tools/post-execute → tool/result*
      step/end
  → agent/turn-stopping
turn/end
```

三个可拦截 waterfall：`agent/pre-step`（决定模型看到什么）、`agent/request`、`llm/stream`，以及三个 `tools/*` 事件。水瀑布监听器**必须调用 `next()` 才能放行**。

#### 3.2 会话日志作为唯一事实源（Model-visible ⟺ logged）
模型能看到的**一切**都必须能从会话日志重建。新增一个模型可见输入 = 新增一个 session event（扩展 `SessionEventMap` 并从日志渲染）。fork / resume / 对话记录 / telemetry / 持久化全部从这一条流派生。raw `assistant/chunk` 事件保留 replay 与 UI 保真度。

#### 3.3 工具执行管线（tool-execution-pipeline）—— 治理重点
工具调用不是"直接执行"，而是走一条**可插拔的治理管线**：

```text
model 发出 tool-call 块
  → session event tool/call（执行前先落日志）
  → presentCall (UI 卡片)
  → tools/pre-execute  waterfall（permission / sandbox / hooks）
  → 单调 guard（deny or abstain）
  → ctx.approval（一次性审批；缺席则 deny）
  → tools/execute  waterfall（围绕派发的 timeout/retry/metrics）
  → toolBody（真正的执行体）
  → fs/write-intent 等策略闸 & 工具自产 session events
  → tools/post-execute  waterfall（accept/block/replace/附加 context）
  → 注册表外层归一化（抛错 → isError）
  → finalizeContent（内容不变量）
  → tools/result（只读权威结果）
  → session event tool/result（唯一模型可见落点）
  → tool batch 结算 → 注入 additionalContexts
```

要点：审批/沙箱/守卫/超时/重试/观测**都挂在瀑布上，不侵入工具实现**；一个守卫语义"单调"——后面的监听器不能把前面的 deny 翻回 allow。`ctx.tools.guard()` 注册守卫；`ctx.tools.restrict()` 做 agent 级可见性 mask；`ctx.tools.presentAs()` 切工具呈现方式（native function calling / Code Mode）。

#### 3.4 Capability seam 带来的"一处替换、全局联动"
- 文件系统 / 子进程 Provider 共享同一执行域 → 把 Provider 指向远程沙箱，Bash、PTY、LSP 一起搬走，**没有 Provider fork**。
- Subagent Provider 一个接口下可变：从全新子 agent，到转交另一个产品的 delegated turn。
- Add 背景作业 → `ctx.jobs` + `job_*` 工具。

#### 3.5 扩展点速查（新行为放哪）
| 目标 | 机制 |
|---|---|
| 加模型 Provider | `ctx.llm` 注册适配器 |
| 加模型能力（工具） | `ctx.tools` 注册，schema 进 prompt 组装 |
| 给某会话不同能力集 | 组 agent preset，需 `isolate` realm |
| 加 shell/终端/后台作业 | `ctx.shell` / `ctx.terminals` + 工具 / `ctx.jobs` |
| 拦截请求/工具/turn | 对应 `agent/*` / `tools/*` 事件 |
| 持久会话状态 | 扩展 `SessionEventMap` |
| 子 agent / 工作流 / 计划模式 | `subagent` / `workflow`（worker-thread）/ `plan`（日志化状态）|

#### 3.6 工程纪律（对看板项目最值钱的"隐性设计"）
- **Registrations are effects**：一切通过 `ctx.effect()/on()`，注销即解绑。
- **注册即副作用、可观测、可回放**：工具/事件/会话全部可 trace（`tool_call_trace`、session log）。
- **工具 UI 呈现是设计的一部分**：`generic/terminal/diff/locations`，呈现方法是 `args` 的纯函数。
- **严格类型 + 品牌化 ID**：跨边界的 opaque id 用 `Branded<B>`，不裸 `string`。
- **Trust TypeScript at typed same-process boundary**：不在强类型同进程边界做冗余运行时校验，只在解析器/配置/队列/模型-tool JSON/持久化/worker/进程/wire 边界校验。
- **测试即行为快照**：keyless snapshot 回放模型/用户可见输出，fixture 可跨平台重放。
- **Skills 是 provider 无关的**：`ctx.skills` 注册表，`skill-filesystem` 发现本地 SKILL.md，`tool-skill` 把它们作为目录/加载器工具暴露给模型 —— **发现、目录、加载**三件事解耦。

---

## 二、open-dashboard 的 AI 链路（opendashboard-harness）现状

`open-dashboard` 是 **Vue3 + Spring Boot** 的看板/BI 画布，AI 侧是**一个独立的 Python FastAPI 进程**（`opendashboard-harness`，"Pi-style + DeerFlow" Agent runtime）。核心分工清晰：

```
FE → /v1/conversations/{id}/runs (SSE)
   → Python Agent loop + tools  (lead_agent / run_agent)
   → Java /api/internal/bi/*    (零 AI 的 BI 执行层：chartQuery/datasetQuery/apply-patch)
```

### 1. 双跑通模式（可贵的务实设计）
`run_agent()` 分两路：
- **Lead Agent（LLM 路径）**：重放 ReAct 工具环，`lead_agent.py` / `runtime.py::run_lead`。
- **Deterministic 工具环（无 LLM 降级）**：`run_deterministic`，纯规则 profile→plan→layout→apply。
- LLM 未配置/异常时自动降级「确定性工具环」，不假成功。三种意图 `ask / insight / gen` 由正则 `resolve_intent` 初判，`patch_mode` 判 append/replace。

### 2. 问数（ask / SQLBot）流程
`runtime.py::_run_ask`：
1. `is_suggest_request` → 先反问可问问题（`_emit_question_suggestions`）。
2. 有 LLM → **SQLBot**（`sqlbot/pipeline.py`，DeerFlow「Ask-3」管线：**读 schema → 抽样 → 生成只读 SQL → 校验 → 执行 → 选图**，出错重试）。`guard.py` 用 **sqlglot** 做**只读 + 表白名单**校验（禁 INSERT/UPDATE/DELETE… 危险 pattern、多语句、越权表）。
3. SQLBot 失败 → 退回 `resolve-intent`（Java 意图对齐到字段，`_clarify_from_intent` 澄清缺失项）→ 受控 `chartQuery`（`encode` 取数）。
4. 全程不出库，只在会话内预览，`od_finish(reason=answered)`。

### 3. 看板生成（gen）流程
`runtime.py::_run_gen`（约 DeerFlow planner + JoyAgent critic 质检）：
1. 读看板摘要（多轮 append）。
2. `od_profile_dataset`（看 dim/measure/time、是否 empty、probe）→ `od_plan_charts`（**只按探测出有数的图**，不套模板；内置质检：ferret 假环比/同维饼图/过密折线）→ `od_layout_board`（拿到 `DashboardPatch`）。
3. 落盘唯一入口 `od_emit_patch` → Java `apply-patch`。`plan` 模式先缓存 patch 等用户 confirm。

### 4. 能力/工具清单（tools_od.py）
`od_list_datasets`·`od_get_schema`·`od_run_query`·`od_run_sql`·`od_profile_dataset`·`od_plan_charts`·`od_review_charts`·`od_layout_board`·`od_compose_board`·`od_get_board_summary`·`od_emit_patch`·`od_finish`·`write_todos`。

### 5. Skills / Memory / SSE 事件
- Skills：`skills/*/SKILL.md`，`agent/context.py::load_skills_prompt()` 主动扫目录注入 system prompt。
- Memory：`agent/memory.py` 轻量事实（绑定数据集等启发式，无 LLM），`transform_context` 注入。
- SSE 事件：`step`（tool_start/tool_end/planner/intent_map）、`plan`、`patch`、`chart_ready`、`board_ready`、`answer_sql/table/chart/insight`、`message_delta`、`finish`。前端据此渲染过程。

---

## 三、问数 / 仪表盘生成（zte-dmt-sdp-dataai 及 DeerFlow 侧）现状

### 1. dataai（OID 平台）→「Dify + 确定性解析」路线
`ChartDataServiceImpl`：
- **单图问数 `generateSingleChart`**：`question + dataset 元数据` → `aiWorkflowGateway.requestAiWorkflow`（**调用 Dify 工作流**）→ 返回 `chartType / dimensions / indexes / filters / reason` → `convertToChartViewDTO`（和字段做严格匹配）→ `SQLGenerator.generateSQL` → 执行 → 解析成图。带 `chartReason`（选图理由）、结果校验修正。
- **多图/整看板 `generateMultiChart`**：把 `DatasetTable` 组装成 **Markdown**（`buildDatasetMarkdown`：数据集信息 + 字段表 + 维度/指标清单）喂给 **Dify 多图工作流**，返回 `[{type: chart|summary}]`。
- `executeVquery` = 直接执行用户给的 SQL（有权限校验）。
- 特点：LLM 语义理解（Dify）+ Java 强类型解析/执行分离；缺点是**大段手写 Java 状态机/解析器**（排序、字段映射、百分比格式化…都在 `ChartDataServiceImpl` 里，约 1200+ 行）。

### 2. datadriven（DeerFlow 侧）
`zte-dmt-sdp-datadriven/backend` 是 **DeerFlow / LangGraph** 的 Python Agent harness：`langgraph.json` 声明 `lead_agent` graph、checkpointer；`packages/harness/deerflow/agents` + `subagents`；有 `lead_agent_model_resolution`、`tool_call_trace`、`skills_parser`、`todo_middleware`、`subagent_executor` 等模块和大量测试。这块是"DeerFlow 引用的那套 Lead Agent "的来源。

---

## 四、综合对比（一张表）

| 维度 | deepseek-harness | open-dashboard harness | dataai 问数/生成 |
|---|---|---|---|
| 定位 | 通用 Agent 运行时/框架 | 看板专属 Agent runtime | BI 平台的语义→图表服务 |
| 插件化 | **全插件 + patch 分层** | KV/代码分文件，工具注册表有但非插件 | 模块/服务，非插件 |
| 循环 | turn/step 事件驱动 + 三 waterfall | Lead ReAct 循环 / 确定性循环 | Dify 工作流 + 受控解析 |
| 工具治理 | pre-exec/guard/approval/post-exec 管线 + 单调守卫 | 简单注册 + 状态对象；sqlglot 只读闸（SQL 专用） | 无通用管线；权限校验有 |
| 会话持久 | append-only SessionEvent 日志=事实源 | session_store（内存/会话记录） | 无统一事实源 |
| 可观测/回放 | 会话日志全量可重建 + snapshot 测试 | SSE 事件流可视 | 有限 |
| Skills | provider 无关 catalog/loader | 目录扫描注入 prompt | 无标准 |
| 多 agent / 子任务 | subagent 接口 + workflow | 单 Lead | 无 |
| 计划/审批 | plan 模式 + approval | plan 模式等确认 | 无 |
| 与 BI 强绑定 | 否 | 是（工具→Java BI） | 是 |
| 工程纪律 | 极强（测试/类型/文档门） | 中 | 中（大量手写状态机）|

---

## 五、看板/问数项目可借鉴、可落地的提升点（重点）

按**投入产出比**排序。这些是 Harness 里被验证、且能直接反哺看板项目 AI 链路的工程做法。

### 1. 把「DashboardPatch 写入」做成**带版本/回放**的 patch 命令流（最高价值）
现状：open-dashboard 已有 `set_layout / upsert_chart / upsert_component` 这类 op；看板真相只能经 `od_emit_patch` 写入 —— 这已经是正确方向。
借鉴 Harness：
- **让每次 apply-patch 产生一个不可变、可回放的 ops 记录 + 操作事件**（对标 session event），前端能"撤销/重放/app历史 diff"。这会直接提升多轮 append 的可控性（现在多轮 append 主要靠 `od_get_board_summary` 猜状态）。
- **op 幂等/冲突检测**：同 chartId、重叠坐标的 ops 显式报错或合并（对应 Harness guard 的单调性），避免模型连续俩 patch 打架。

### 2. 引入**可插拔的工具治理管线**（pre-execute → guard → approval → post-execute）
现状：目前工具的"安全"散落在 `od_bi.py`/`sqlbot/guard.py`（只对 SQL 做了 sqlglot 只读/白名单）与 Java `BiInternalController` 的内部 token。非 SQL 工具、exec 权限、超时、重试都没统一治理。
借鉴：
- 把 `od_*` 工具调用包一层 **guard + 审批 + 超时/重试** 的中间件，像 Harness 那样挂而不是侵入每个 executor。这样未来加"执行用户脚本/访问外部 API/写文件"类工具时，安全策略零改动。
- **SQL 只读闸升级为可插拔守卫**：现在 guard 只在本 harness 内拦截，应像 Harness 一样做成"执行前必经的受管闸"，并让守卫"单调"（下游不许放行上游拒绝的）。

### 3. 建立**会话/运行时日志作为唯一事实源** + 全量可回放
现状：`session_store` 记录会话与 message，但模型是否忠实重建、artifacts 是否落库都靠 Python 侧手工维护；前端 SSE 流不保证能按需重放。
借鉴：
- 仿 `SessionEvent` 模型：每次产出 `answer_sql/table/chart`、`patch`、`board_ready` 都写一条**追加式、带顺序的事件**，前端渲染从日志派生（而非只靠直播）。好处：**重连、续跑、审计、测试快照**都能拿到"确定性"结果。
- 用事件日志做 **keyless snapshot 测试**（对标 Harness）："同样的输入 → 断言回放的 answer/patch 事件序列"，把 AI 回归固定下来；现在 reportui/smartreport 大多没有这套。

### 4. Skills 从"目录扫描注入"升级为 **provider 无关的 catalog + 按需 loader**
现状：`load_skills_prompt()` 把 `skills/*/SKILL.md` 全量拼进 system prompt —— 简单直接，但所有技能永远在场，token 浪费、且新技能即改系统提示词。
借鉴：
- 参考 Harness 的 **skill 注册表 + 目录工具 + 加载器工具**：模型先"看目录/按需 load"技能，而不是一股脑注入。
- 把「ask / gen / append / confirm / 问题澄清」等做成真正的**技能项**而非散落的硬编码分支，便于按会话能力集裁剪。

### 5. 补上 **plan 审批 + 子任务编排** 两层缺失
- **plan 审批**：现在 `plan` 模式/`confirm-plan` 已雏形（`awaitingConfirm: true`），可借鉴 Harness `plan`（计划作为日志化状态）把"计划 → 审批 → 执行"做成一等会话事件，便于审计。
- **子 agent / 工作流**：看板项目目前单 Lead。下一步"问题太多 → 并行 profile 多个数据集再合图""一个看板分多路生成再合并"是天然的多 agent 场景，可参考 Harness `subagent` + `workflow`（worker-thread 并行 + 阶段/屏障），或复制 Open-dashboard 已有的 SSE 父子 `parent` 事件思路（`_sqlbot_child_step` 已有雏形）。

### 6. 工具 UI/过程呈现**纯函数化 + 结构化进度**
现状：`_tool_preview` 已做得很细（schema/query/profile 三类 preview）——这是亮点。
借鉴：把"每个 step 的呈现"抽象成 **args 的纯函数**（Harness 的 `generic/terminal/diff`），把展示逻辑与执行解耦，前端渲染与后端 trace 可复用同一结构。

### 7. 统一 multi-turn 的**记忆/上下文**，而不是启发式
现状：`memory.py` 只有"绑定数据集"这种启发式事实。
借鉴：学 Harness "anything model-visible must be logged & reconstructable"：把"用户是否点名某图表/某数据集、本轮 pad 过的相对定位"等也写成结构化事件而非裸文本注入，多轮 append 会更稳。

### 8. 工程纪律（可迁移的"便宜"项）
- 强类型 + branded ID：`dashboardId/chartId/runId` 用 branded 类型，杜绝裸 string 传错。
- 测试 = 行为快照：给 Lead/确定性两路的 SSE 输出录 keyless snapshot 回放。
- 工具/守卫全部"注册即副作用、可卸载"，禁掉硬编码 tunable（`SYSTEM_PROMPT`/`max_rounds` 提到配置）。
- 用文档门 / 契约门（OpenAPI 已做得很好，可再加"每次工具 schema 变化必须同步 OpenAPI"的闸）。

---

## 六、一句话总评

- **deepseek-harness** 给的是一套**可组合、可观测、可治理**的通用 Agent 运行时方法论，它的插件接缝、会话日志事实源、工具治理管线、Skills provider 无关性，是任何 AI 链路都应具备的"地基能力"。
- **open-dashboard harness 已经是这几个项目里 AI 架构最接近 Harness 思路的**：双跑通（LLM/确定性）、SSE 过程流、patch-only 写入、SQL 只读闸、deerflow 质检 —— 底子非常好，差的是"地基工程化"：**可回放日志、可插拔治理、provider 无关 skills、多 agent 编排**。
- **dataai/Dify 路线**语义理解能力强（Dify 编排 + Markdown schema），但**硬编码状态机多、无统一事实源、工具治理弱**，更适合把"确定性解析/执行/质检"下沉成可复用管线，语义部分才交给 LLM。

> 建议落地顺序：**① patch 带版本/回放 → ② 工具治理中间件(guard/审批/超时) → ③ 会话事件日志=事实源 + snapshot 测试 → ④ provider 无关 skills catalog → ⑤ 多数据集并行子 agent → ⑥ 工程纪律（branded id / 测试快照 / 文档门）**。先做 ①②③ 就能显著提升看板生成的可靠性与可审计性。
