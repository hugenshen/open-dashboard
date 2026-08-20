# P010 · 知识库产品设计（管理端维护 + 用户端消费）

> P004 只保留自学习、字段语义、confirmed 语义消费和 emit 探活；跨会话记忆、知识库管理面由本文承接。
> **本文补产品面**：谁在哪维护、确认闸门、对话里怎么看见。高保 [`knowledge.html`](../../prototypes/hi-fi/knowledge.html)。

## 要解决什么

问数已经会吃 `de_indicator` / `de_glossary` / 金标准问法 / 用户记忆，但人看不到这条链：

| 现状 | 问题 |
|------|------|
| 数据集页「指标确认」 | 埋在数据集详情，分析师进对话时找不到 |
| 「维度管理」菜单 | 名字只覆盖词表的一半；金标准问法、记忆都不在 |
| 对话文件列「知识库 · 二期」 | 引擎已注入，入口还标二期 |
| 用户记忆无界面 | 只能靠 flush 写入，无法查看/删除错误偏好 |

结果：GMV 对不上字段时，用户以为模型笨，其实是候选没确认、或确认了但对话里看不出用了哪条知识。

## 给谁

| 角色 | 来知识库做什么 |
|------|----------------|
| 数据管理员 | 确认/改名/废弃候选口径与维度；维护金标准问法 |
| 分析师 | 看当前表会注入什么；删掉自己的错误记忆；从知识库一键试问 |

不做：工作区发布流（[P009](../P009-workspace-governance/)）、向量 RAG、把每次问数自动写成金标准 SQL。

## 信息架构

前端同一个产品壳分成两组入口：

| 区域 | 页面 | 知识/记忆关系 |
|------|------|---------------|
| 用户使用端 | 工作台、对话分析、仪表盘、报告 | 只消费已授权、已确认的知识；展示“用到的知识”和个人记忆结果，不做发布管理 |
| 管理端 | 数据源、数据集、知识库、成员权限 | 维护候选、指标、术语、SQL 示例、SOP、个人记忆删除和工作区记忆策略 |

左侧管理端资源栏：**数据源 → 数据集 → 知识库 → 成员权限**。

- **数据集**：表、字段角色、触发「重新学习」、**本切片维护高频问法（NL→SQL）**。学习只写候选，不直接进问数。
- **维度管理** `/dimensions`：确认公共维度与取值；confirmed 后问数注入 `<dimension-values>`。默认进入有待确认的第一张表，没有则进第一张表；空态不占右侧详情栏。
- **知识库**（后续一级入口）：按表审核自学习候选，收敛指标口径、词表、问法和我的记忆。已启用的才注入问数。
- 对话：思考过程展示命中条；文件列可链到本页。

```
录入/学习（数据集）
  → 候选 inbox（管理端 · 知识库 · 待确认）
  → 已确认指标 / 词表 / 问法
  → 用户端对话分析 run 注入 <knowledge> + <memory>
  → 对话可见命中；记忆可删
```

### 五个知识工作台

| Tab | 对象 | 默认范围 | 确认前 | 确认后 |
|-----|------|----------|--------|--------|
| 待确认 | 自学习候选（指标 + 维度） | 当前人有权的 askable 表 | **不注入**问数 | — |
| 指标口径 | `de_indicator` | 按数据集 | 仅管理可见 | `<metrics>` + KPI 规划 |
| 词表与维度 | `de_glossary` | 按数据集 / 类型 | 不进查询条 | `<terms>` + 查询条预填 |
| 金标准问法 | `de_dataset_question` | 按数据集（**本切片在数据集页**） | 停用不注入 | SQLBot few-shot |
| 我的记忆 | `workspaces/{workspaceId}/users/{userId}/memory.json` | 当前工作区内仅本人 | 描述性 facts 才落盘 | `<memory>` 跨会话 |

写闸沿用已编码规则：候选 ≠ 已确认；记忆只要当前 workspace 下的 user + durable + descriptive；SQL 示例仍受表白名单约束。

## 关键交互

### 1. 待确认 Inbox

卡片：候选名、来源字段、数据集、置信度、抽样值。主按钮 **确认并用于问数**；次按钮改名 / 废弃。

确认后右侧立刻出「问数时会注入」预览（与 Harness frozen-snapshot 同构，给真人看的版本）：

```
指标  销售额 → spending_amount（SUM，元）
词表  GMV、成交额 → spending_amount
维度  区域 = 华东 / 华南 / 华北
```

不要只改状态 badge。

### 2. 指标 / 词表 / 问法

- 列表可按数据集、状态筛选。
- 词表展开维度值 chips；脏值（工号尾巴等）默认隐藏，可「看原始值」。
- 金标准问法：自然语言 + 只读 SQL；本切片在数据集页「高频问法」维护，保存时前端提示「表名不可改」。点「试问」带 `q` + `autorun` + `datasetId` 进 `/conversations`。后续知识库 Hub 再收敛展示。

### 3. 我的记忆

只列「系统从对话沉淀」的偏好（常用表、口径、图类型）。用户可 **删除**，不能手写查询结果行。空态说明：问过并纠正过口径后才会出现。

### 4. 对话消费

思考过程增加一级折叠「用到的知识」（已有 step.preview 可承载）：命中术语 / 口径 / 问法各几条。点条目跳知识库对应行。

文件列「知识库」不再标二期：列出本会话 `knowledgeRefs`，底链「管理知识库」。没有知识管理权限的用户仍可查看本次命中摘要，但跳转管理页时由 Java public API 拦截写操作。

## 与已有代码的边界

| 已有 | 本期产品面怎么用 |
|------|------------------|
| `DatasetProfileLearner` + 数据集「重新学习」 | 继续在数据集页触发：规则采样统计 → Harness LLM 复核角色/别名；已确认指标/词表不覆盖；不搬到知识库 |
| `DatasetManage` 指标确认 tab | 高保定稿后收敛进知识库「指标口径」，数据集页只留入口 |
| `DimensionManage.vue` `/dimensions` | 后续应收敛为管理端「知识库」实现；历史 `/dimensions` 可作为兼容跳转，不再作为产品主入口 |
| `GET /api/internal/bi/knowledge` | 只读 confirmed；管理面走 public glossary/indicator/questions |
| Harness `PUT /v1/knowledge/{datasetId}` 文件库 | 过渡期与 Java 表并存；新管理面以 Java 表为准 |
| P009 `knowledgeRefs` 发布态 | 本期全部视为工作区内已确认即可注入；发布流后置 |

## 非目标

- 跨工作区知识市场、审核人、版本 diff（P009）
- TableRAG / 向量检索
- 对话结果卡上「存为金标准」一键（容易污染，二期再做人工挑选）
- 在 architecture.html 写未验收的一级菜单（代码改菜单后再同步）

## 实现落点（对照高保后编码）

- FE：数据集页 `DatasetManage.vue` 高频问法 tab（本切片）；后续 `src/knowledge/views/KnowledgeHub.vue` 或扩展 `DimensionManage.vue`
- 契约：`/api/glossary` `/api/indicator` `/api/dataset/{id}/questions`、internal `GET /api/internal/bi/datasets/{id}/questions`；OpenAPI 已补
- 对话：`ConversationWorkspace` 展示 `knowledgeRefs`；试问带 `datasetId`
- 注入引擎：SQLBot `sqlbot/ask_context.py` 拼 few-shot + `<dimension-values>`；Java `knowledgeFor` 只出 confirmed，维度带 values
