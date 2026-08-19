# P010 · 用户记忆与问数知识库详细设计

> Harness 文件存储切片已编码。验收前不写入 `architecture.html`。

对照：`refs/deer-flow` 长期记忆（middleware、users/{id}/memory.json）；`refs/sqlbot` 术语 + SQL 示例注入；不对照 JoyAgent TableRAG。工作区级隔离见 [P009](../P009-workspace-governance/)。

## 1. 三层记忆

| 层 | 生命周期 | 存储 | 内容 |
|----|----------|------|------|
| Working | 单 run | 运行时 context | board-summary、选中图、当前表 |
| Session | 单对话 | conversation JSON `memory[]` | 绑定数据集、已澄清字段 |
| User | 跨对话 | `{dataDir}/users/{userId}/memory.json` | 常用数据集、偏好图类型 |

写闸：置信度低于 0.7 不写；最多 100 条；注入最多 20 条。抽取先规则（绑定数据集），不做 Lead CRUD。

身份：只从 Auth SPI / Harness ContextVar 取 `userId`。客户端 body 不得带 `userId`。

## 2. 问数知识

对象：

1. **glossary**：`term` / `aliases` → `field`（必须存在于该数据集 schema，由生成后 sqlglot + 表白名单兜底）。
2. **examples**：自然语言 → 只读 SQL；绑定 `datasetId`；人工确认后写入，不自动把每次问数沉淀进去。

召回：keyword 匹配问题文本；注入 SQLBot `sql_system` 的 `<business-knowledge>`。管理面本期为 Harness `PUT /v1/knowledge/{datasetId}`；Java 数据集设置页后置。

## 3. 与 P008

askable 闸门先于知识召回：无权数据集既不能查 schema，也不能读/写该数据集知识（写接口仍要求 principal）。

## 4. 评测

`opendashboard-harness/tests/test_knowledge.py` + `eval/runner.py`。术语命中必须出现真实字段名；越权 SQL 示例仍被 sqlglot 拒绝。
