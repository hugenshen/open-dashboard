# P010 · 用户记忆与问数知识库详细设计

> Harness 文件存储切片已编码。验收前不写入 `architecture.html`。
> 本文接住 P004 拆出的跨会话记忆与知识库产品化；工作区/IAM/发布流的完整治理见 [P009](../../P009-workspace-governance)。

对照：`refs/deer-flow` 长期记忆（middleware、workspace/user scoped memory document）；`refs/sqlbot` 术语 + SQL 示例注入；不对照 JoyAgent TableRAG。工作区级隔离见 [P009](../../P009-workspace-governance)。

## 1. 三层记忆

| 层 | 生命周期 | 存储 | 内容 |
|----|----------|------|------|
| Working | 单 run | 运行时 context | board-summary、选中图、当前表 |
| Session | 单对话 | conversation JSON `memory[]` | 绑定数据集、已澄清字段 |
| User | 跨对话 | `{dataDir}/workspaces/{workspaceId}/users/{userId}/memory.json` | 当前工作区内的常用数据集、偏好图类型 |

写闸：置信度低于 0.7 不写；最多 100 条；注入最多 20 条。抽取先规则（绑定数据集），不做 Lead CRUD。

身份：只从 Auth SPI / Harness ContextVar 取 `workspaceId` 和 `userId`。客户端 body 不得带 `userId`；`workspaceId` 只可作为请求上下文线索，最终以服务端上下文和 Java internal 返回边界为准。

## 2. 问数知识

对象：

1. **glossary**：`term` / `aliases` → `field`（必须存在于该数据集 schema，由生成后 sqlglot + 表白名单兜底）。
2. **examples**：自然语言 → 只读 SQL；绑定 `datasetId`；本切片在数据集页维护 `de_dataset_question`（status=active 才注入）。不自动把每次问数沉淀进去。
3. **dimension values**：confirmed `de_glossary` type=dimension 的 `values` 挂到 schema 字段，SQLBot 写入 `<dimension-values>`，过滤必须用原文字面量。

召回：keyword 匹配问题文本；注入 SQLBot `sql_system` 的 `<few-shot-examples>` / `<dimension-values>` / `<business-knowledge>` 以及 Harness `<knowledge>` frozen-snapshot。

问数（dsh）`od_get_schema` 在 terms/metrics/questions 之外再投影 `semantic`：

- `metrics[].expression` 固定为 `AGG(field)`（如 `SUM(pay_amount)`），人写 `formula` 只放 `definition`，不当 SQL
- `dimensions[].values` 为已确认枚举，过滤必须用原文字面量
- `examples` 来自数据集金标准问法（最多 3 条）

未确认候选不进入 `semantic`。不引入 Ossie YAML 作为主存储。

管理面见 [management-design.md](./management-design.md)：一级「知识库」做确认闸门；Java `de_indicator` / `de_glossary` / `de_dataset_question` 为准。Harness 文件库仅过渡，且所有读写必须带 `workspaceId`。

## 3. 与 P008

askable 闸门先于知识召回：无权数据集既不能查 schema，也不能读/写该数据集知识（写接口仍要求 principal）。记忆召回也不能只按 `userId`，必须同时过滤当前 `workspaceId`。

## 4. 评测

`opendashboard-harness/tests/test_knowledge.py` + `eval/runner.py`。术语命中必须出现真实字段名；越权 SQL 示例仍被 sqlglot 拒绝。
