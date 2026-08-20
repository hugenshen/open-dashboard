# P004 · 数据集自学习与运行时语义增强 POC

> 定位：P004 对话分析（问数 + 看板生成）的数据质量与运行时语义增强方案。
> 边界：本文件只描述 P004 内为了提升生成准确性需要的字段画像、候选指标、词表消费、采样、探活和评测闭环。产品化知识库、跨会话用户记忆、知识管理面归 [P010](../P010-user-memory-ask-knowledge/)；工作区、用户、权限、知识发布与记忆分层治理归 [P009](../P009-workspace-governance/)。
> 验收：判据、状态和证据只维护在 [acceptance.yaml](./acceptance.yaml)，本文只反链验收 ID，不另定义验收表。

---

## 1. 问题回顾

当前问数和仪表盘生成不稳定，根因集中在数据语义不可靠：

1. 字段语义容易被关键词带偏。`DatasetProfiler.roleOf` / `FieldSemantics.java` 只看字段名或少量白黑名单，无法稳定识别金额、状态、ID、长文本。
2. LLM 规划前看不到真实数据样本。`od_get_schema` 如果只返回 `name/label/group/dataType`，模型只能猜字段业务含义。
3. 图表规划缺少意图约束。同一张表下，用户问趋势、对比、占比，不能产出相同图表组合。
4. emit 前缺少统一数据探活。空表、全 null 字段、查询超时如果进入看板，会被用户理解为模型生成不稳定。
5. 记忆和知识一旦没有边界，容易跨用户、跨项目组污染。P004 只能消费当前 run 允许的语义上下文，长期治理必须交给 P010/P009。

---

## 2. 归属与边界

### 2.1 P004 做什么

P004 负责问数/看板生成链路内的语义质量地基：

- 数据集录入或重新学习时写字段画像：`de_dataset_field_profile`。
- 基于画像生成候选指标和候选术语：`de_indicator(draft)`、`de_glossary(candidate)`。
- `od_get_schema` 返回字段角色、统计特征和真实采样，让模型少猜。
- `od_interpret_fields` 只做运行时解释和候选建议，不覆盖人工确认口径。
- `od_plan_charts` 读取已确认指标、词表和 profile 统计，提高图表选择稳定性。
- `od_emit_patch` 前做数据探活，剔除空图、全 null 图和超时图。

### 2.2 P004 不做什么

- 不做跨会话用户记忆的产品定义、管理、删除和长期策略，这些归 P010。
- 不做一级“知识库”管理面、待确认 Inbox、SQL 示例维护，这些归 P010。
- 不做工作区 IAM、项目组、角色、资源 ACL、知识发布版本，这些归 P009。
- 不让 Harness 保存业务权限真相。Harness 只能在 Java internal 返回的授权边界内执行工具。
- 不把模型运行结果自动提升为已确认知识。模型只能提出候选或证据，确认与发布必须有人闸或明确策略。

### 2.3 与 P009 / P010 的分工

| 事项 | P004 | P010 | P009 |
|------|------|------|------|
| 字段画像 | 写入和消费 | 展示入口可跳转 | 后续要求带 `workspaceId` |
| 候选指标 / 词表 | 生成候选、运行时消费 confirmed | 知识库确认、改名、废弃、预览 | 发布流、版本、跨工作区复制 |
| 用户记忆 | 不拥有，只可消费 P010/P009 下发的安全摘要 | 用户 facts、查看、删除、注入策略 | `workspaceId + userId` 分区和审计 |
| 工具执行 | 通过 Harness 工具编排调用 Java internal | 不直接执行工具 | 权限边界、工具策略、审计 |
| 验收 | PR-SL、PR-KB、PR-SA 中的运行时能力 | PR-MEM、PR-KB-UI | PR-WS、PR-GOV |

---

## 3. 目标数据流

```text
T0 数据集录入 / 重新学习
  → Java DatasetProfileLearner.learn(datasetId)
  → 采样、统计、角色判定
  → 写 de_dataset_field_profile
  → 写 de_indicator(draft) / de_glossary(candidate)
  → 可选调用 Harness review-fields 做 LLM 复核
  → confirmed 指标与词表不覆盖

T1 人工确认
  → P010 知识库或现有数据集页确认 candidate / draft
  → Java 将 status 置为 confirmed
  → confirmed 才能进入问数 / 生成运行时上下文

T2 用户发起问数 / 生成
  → FE 直连 Harness public run API
  → Harness 创建 run、记录 trace
  → Harness 向 Java internal 获取授权数据集、schema、confirmed 语义资产
  → Harness ContextBuilder 组装 <knowledge> 和可用工具边界
  → P010/P009 允许时，再按 workspace/user 注入 <memory>

T3 LLM 工具环
  → od_get_schema(datasetId)：读取 profile + sample
  → od_interpret_fields(datasetId, fields)：输出结构化解释和候选建议
  → od_plan_charts(datasetId, intent)：读取 confirmed 指标、词表、profile
  → 工具参数和 datasetId 每次经 Java internal 权限重算

T4 emit 前质量闸
  → 每个图按预算做只读探活
  → rowCount=0 / 全 null / 超时 / 越权 → 剔除或降级
  → 全部不可用时返回可解释错误，不落空看板

T5 落盘与回放
  → Harness adopt/apply 经 Java internal 写 dashboard draft
  → run trace 记录 profileRefs、knowledgeRefs、probe 结果和错误码
  → 长期记忆沉淀交给 P010/P009，不在 P004 内定义
```

---

## 4. 数据模型

### 4.1 P004 当前语义表

```sql
CREATE TABLE de_dataset_field_profile (
  dataset_id   VARCHAR(64)  NOT NULL,
  field_name   VARCHAR(128) NOT NULL,
  field_label  VARCHAR(255),
  data_type    VARCHAR(32),
  role_learned VARCHAR(16),            -- dim | measure | time | flag | id | junk | text
  role_source  VARCHAR(16),            -- stats | naming | llm | manual
  distinct_count   BIGINT,
  null_count       BIGINT,
  null_rate        DOUBLE PRECISION,
  numeric_min      DOUBLE PRECISION,
  numeric_max      DOUBLE PRECISION,
  distinct_values  JSONB,
  is_timestamp_like BOOLEAN,
  sample_json      JSONB,
  learned_at   BIGINT,
  PRIMARY KEY (dataset_id, field_name)
);

CREATE TABLE de_indicator (
  id           BIGSERIAL PRIMARY KEY,
  dataset_id   VARCHAR(64) NOT NULL,
  field_name   VARCHAR(128) NOT NULL,
  name         VARCHAR(128) NOT NULL,
  agg          VARCHAR(16),             -- SUM | AVG | COUNT | MIN | MAX
  unit         VARCHAR(32),
  formula      TEXT,
  description  TEXT,
  status       VARCHAR(16) DEFAULT 'draft',   -- draft | confirmed | deprecated
  source       VARCHAR(16) DEFAULT 'learned', -- learned | manual | llm
  confidence   REAL DEFAULT 0,
  created_at   BIGINT,
  updated_at   BIGINT,
  UNIQUE (dataset_id, field_name, name)
);

CREATE TABLE de_glossary (
  id           BIGSERIAL PRIMARY KEY,
  term         VARCHAR(128) NOT NULL,
  type         VARCHAR(16),             -- metric | dimension | entity | flag
  dataset_id   VARCHAR(64),
  canonical_field VARCHAR(128),
  aliases      JSONB,
  values_json  JSONB,
  status       VARCHAR(16) DEFAULT 'candidate', -- candidate | confirmed | merged | deprecated
  source       VARCHAR(16) DEFAULT 'learned',
  confidence   REAL DEFAULT 0,
  created_at   BIGINT,
  updated_at   BIGINT,
  UNIQUE (term, dataset_id)
);
```

### 4.2 工作区演进约束

P004 当前表以 `dataset_id` 为主键边界；进入 P009 工作区治理后，语义资产必须具备以下约束：

- Java 侧业务/知识表补 `workspaceId`，或通过 dataset 归属可稳定反查 `workspaceId`。
- Harness run 必须携带 `workspaceId`、`userId`、`conversationId`。
- `de_indicator` / `de_glossary` 只允许召回当前工作区、当前用户有权数据集下的 confirmed 记录。
- 跨工作区复用只能复制成新版本，不允许同一条知识隐式跨工作区可见。
- 记忆存储不使用单独 `{userId}` 作为全局 key；至少使用 `workspaceId + userId`。

---

## 5. 关键机制

### 5.1 字段角色判定

字段角色以统计为主、命名为辅、LLM 复核只作为候选建议：

```text
1. timestamp-like → time
2. distinct_count <= 2 且值域类似 0/1、y/n、true/false → flag
3. distinct_count 接近总行数且数值或长串 → id
4. 数值型、非 id/flag、可聚合 → measure
5. 字符串低基数 → dim
6. 长文本、JSON、描述内容 → text 或 junk
```

命名规则只修正候选分，不做一票否决。比如字段名含 `amount` 但 distinct 与行数近似时，应进入人工确认或 LLM 复核，不直接当成金额指标。

### 5.2 LLM 复核写闸

`review-fields` 和 `od_interpret_fields` 的结果必须经过写闸：

- 只允许改 `role_learned`、`role_source=llm`、候选业务名、候选别名和候选置信度。
- 不覆盖 `status=confirmed` 的指标和词表。
- 不把一次生成成功自动当成 confirmed。
- 所有 LLM 建议写 trace，便于回放“为什么这个字段被当成金额/状态/ID”。
- LLM 不可用时保留规则画像，run 继续降级执行。

### 5.3 知识注入

P004 只消费已确认的运行时语义：

```xml
<system-reminder>
<knowledge>
<metrics>销售额 -> spending_amount(SUM, 元)</metrics>
<terms>GMV = spending_amount; 门店 = channel</terms>
</knowledge>
</system-reminder>
```

约束：

- `<knowledge>` 来自 Java internal 按授权过滤后的 confirmed 指标和词表。
- 静态 system prompt 不混入动态知识，保持 prompt 前缀稳定。
- `skills/od-metrics/SKILL.md` 只能作为本地 POC 的只读口径快照；产品化知识以 P010/P009 的 Java 表、审核状态和版本为准。
- 未确认 candidate 不注入问数和看板生成。

### 5.4 记忆消费

P004 不定义长期记忆存储，只允许在 P010/P009 给出安全摘要后消费：

```xml
<system-reminder>
<memory>
- 用户偏好金额用万元展示
</memory>
</system-reminder>
```

约束：

- 记忆归 Harness，但必须按 `workspaceId + userId` 过滤。
- 记忆优先级低于 Java 权限边界和 confirmed 知识。
- 记忆不能扩大数据权限，不能覆盖已发布指标口径，不能暴露无权资源名。
- 用户查看、删除、禁用记忆归 P010 管理面；工作区记忆治理归 P009。

### 5.5 数据探活

emit 前探活必须有预算，不能为了稳定性引入新的超时源：

- 单图探活超时建议 2-5 秒；整次 run 有总预算。
- 优先复用 `de_dataset_field_profile` 的统计信息，避免对大表重复做 `COUNT(DISTINCT)`。
- 只读查询必须走 Java internal，继续受表白名单和权限校验。
- 空图剔除后要记录 `probeStatus`、`rowCount`、`reason`。
- 全部图被剔除时，返回“当前授权数据无可展示结果”的明确错误，不生成空看板。

---

## 6. ref 借鉴原则

refs 借机制，不照搬边界：

| ref 机制 | 借鉴 | OD 落地约束 |
|----------|------|-------------|
| DeerFlow dynamic context | 动态 `<knowledge>` / `<memory>` 独立注入 | 注入内容必须先经过 Java/P009 授权边界 |
| DeerFlow memory filtering | 长期记忆只收描述性事实 | 长期存储和管理归 P010/P009，不归 P004 |
| Pi skills | 知识以稳定 markdown 快照被模型按需读取 | 只作为 POC 快照；正式知识以 Java 表和版本为准 |
| Pi tool schema | 工具参数结构化校验 | 工具执行还必须经 Java internal 权限重算 |
| Pi evals | baseline/candidate + golden case | 验收状态仍以 `acceptance.yaml` 为唯一真相 |

---

## 7. 风险与修正

| 风险 | 修正 |
|------|------|
| P004/P010/P009 混用导致开发入口漂移 | 本文只保留 P004 运行时语义增强；知识库和记忆产品化跳 P010；工作区治理跳 P009 |
| 单 userId 记忆跨项目组污染 | 所有新增记忆路径以 `workspaceId + userId` 为 key；旧 `{userId}` 文件只作为迁移输入 |
| LLM 回写导致错误自增强 | LLM 只能写候选/证据；confirmed 需要人闸或明确策略 |
| 探活大表拖慢生成 | profile 统计优先、单图超时、run 总预算、结果入 trace |
| candidate 知识误注入 | 只读 confirmed；P010 管理面负责确认和预览 |

---

## 8. 验收反链

验收细节只在 [acceptance.yaml](./acceptance.yaml)：

| 能力 | P004 验收 ID |
|------|--------------|
| 字段画像、自学习、采样 | PR-SL-01..05 |
| confirmed 指标/词表运行时消费 | PR-KB-01..04 |
| 采样、字段解释、意图规划、探活 | PR-SA-01..05 |
| 对话主流程与 Patch 闭环 | PR-CONV-01..12 |

跨会话记忆、知识库 UI、可删除记忆、SQL 示例和管理面验收见 [P010 acceptance.yaml](../P010-user-memory-ask-knowledge/acceptance.yaml)。工作区隔离、用户体系、权限、知识发布和审计验收见 [P009 acceptance.yaml](../P009-workspace-governance/acceptance.yaml)。

---

## 9. 落地顺序

```text
P004 语义地基
  → 字段画像 / 候选指标 / 候选词表
  → schema 采样 / 字段解释 / 图表意图
  → emit 前探活 / trace 可回放
  → P010 知识库与记忆管理面
  → P009 工作区、IAM、知识发布、记忆分层治理
```

P004 可以先把单工作区或默认工作区跑稳；一旦接入多个项目组，所有 run、知识召回、记忆召回和 trace 必须落到 P009 的 `workspaceId` 边界内。
