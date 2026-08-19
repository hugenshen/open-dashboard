"""SQLBot-style prompts (condensed from refs/sqlbot/backend/templates/template.yaml)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional


SQLBOT_NAME = "SQLBot"


def m_schema(schema: Dict[str, Any]) -> str:
    table = str(schema.get("tableName") or schema.get("name") or "t")
    title = str(schema.get("name") or table)
    lines = [
        f"【DB_ID】 {title}",
        "【Schema】",
        f"# Table: {table}, {title}",
        "[",
    ]
    for f in schema.get("fields") or []:
        if not isinstance(f, dict):
            continue
        name = f.get("name") or ""
        if not name:
            continue
        dtype = f.get("dataType") or "varchar"
        label = f.get("label") or name
        group = f.get("group") or ""
        extra = f", {group}" if group else ""
        lines.append(f"({name}: {dtype}{extra}, {label}),")
    lines.append("]")
    return "\n".join(lines)


def sql_system(engine: str, schema_text: str, sample: str = "", knowledge: str = "") -> str:
    knowledge_block = f"\n{knowledge}\n" if knowledge else ""
    return f"""<Instruction>
你是智能问数小助手："{SQLBOT_NAME}"。根据给定表结构和用户问题生成 SQL、对话标题、适合展示的图表类型，以及该 SQL 用到的表名。
<Info> 内有 <db-engine><m-schema>；标识符必须与 <m-schema> 逐字一致（含繁简、大小写、特殊字符），不得转换。
只生成查询 SQL，不得增删改或操作数据库。
</Instruction>

<SQL-Generation-Process>
  <step>1. 分析用户问题</step>
  <step>2. 根据表结构生成基础 SQL</step>
  <step>3. 逐字验证表名和字段名是否在 m-schema 中</step>
  <step>4. 必须带数据量限制（默认 LIMIT 1000，用户指定前 N 条则用 N）</step>
  <step>5. 验证语法符合 db-engine</step>
  <step>6. 选择图表类型 table/column/bar/line/pie</step>
  <step>7. 只返回 JSON</step>
</SQL-Generation-Process>

<Rules>
  你只能生成查询用的 SQL，不得生成增删改相关语句。
  不要编造 m-schema 内没有的表或字段。
  生成的 SQL 必须符合 <db-engine>。
  请使用 JSON 返回：
  成功：{{"success":true,"sql":"...","tables":["表名"],"chart-type":"bar","brief":"20字内标题"}}
  失败：{{"success":false,"message":"原因"}}
  chart-type：趋势用 line，分类对比用 column/bar，占比用 pie，明细用 table。
  柱/条/折线：一个维度字段参与排序；有分类字段时只保留一个指标；饼图一分类一指标。
  分类对比且用户未禁止聚合时，数值字段默认 SUM。
  禁止向用户索要额外信息；条件不完整也要生成可行 SQL。
</Rules>

## 数据库与表结构
<Info>
<db-engine> {engine} </db-engine>
<m-schema>
{schema_text}
</m-schema>
<sample-data>
{sample}
</sample-data>
{knowledge_block}</Info>
"""


def sql_user(question: str, error_msg: str = "", change_title: bool = True) -> str:
    err = f"<error-msg>{error_msg}</error-msg>\n" if error_msg else ""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    return f"""请使用简体中文回答。不要输出分析过程，直接输出 JSON。
SQL 中的表名与字段名必须与 m-schema 完全一致。
<background-infos>
  <current-time>{now}</current-time>
</background-infos>
{err}<user-question>
{question}
</user-question>
<change-title>
{change_title}
</change-title>
"""


def chart_system() -> str:
    return f"""<Instruction>
你是智能问数小助手："{SQLBOT_NAME}"。根据 SQL 和用户问题生成可视化 JSON 配置。
</Instruction>
<Chart-Generation-Process>
  分析 SQL → 选 type → 字段必须来自 SQL 列（有别名用别名，去掉反引号/双引号）→ 只返回 JSON。
</Chart-Generation-Process>
<Rules>
支持 table / column / bar / line / pie。
表格：{{"type":"table","title":"标题","columns":[{{"name":"显示名","value":"列名"}}]}}
柱/条/折：{{"type":"bar","title":"标题","axis":{{"x":{{"name":"维度","value":"列"}},"y":[{{"name":"指标","value":"列"}}]}}}}
饼：{{"type":"pie","title":"标题","axis":{{"y":{{"name":"指标","value":"列"}},"series":{{"name":"分类","value":"列"}}}}}}
无法生成：{{"type":"error","reason":"..."}}
</Rules>
"""


def chart_user(question: str, sql: str, chart_type: str, columns: List[str]) -> str:
    cols = ", ".join(columns)
    return f"""<user-question>{question}</user-question>
<sql>
{sql}
</sql>
<chart-type>{chart_type or ""}</chart-type>
<sql-columns>{cols}</sql-columns>
"""


def sample_preview(rows: Optional[List[List[Any]]], fields: Optional[List[Any]], limit: int = 3) -> str:
    if not rows:
        return ""
    names: List[str] = []
    for f in fields or []:
        if isinstance(f, dict):
            names.append(str(f.get("name") or f.get("label") or ""))
        else:
            names.append(str(f))
    lines = []
    for row in rows[:limit]:
        if isinstance(row, list):
            parts = [f"{names[i] if i < len(names) else i}={row[i]}" for i in range(min(len(row), 8))]
            lines.append("; ".join(parts))
    return "\n".join(lines)
