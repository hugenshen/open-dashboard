"""SQLBot ask pipeline: generate SQL → guard → execute → chart config."""

from __future__ import annotations

import json
import re
from typing import Any, Dict, Generator, List, Optional

from llm_client import chat_completions, llm_configured, llm_settings
from agent.knowledge import fetch_knowledge, format_knowledge_block, prompt_block
from agent.user_context import current_workspace_id
from sqlbot.ask_context import compose_ask_knowledge, pick_few_shots, score_example, value_hints
from sqlbot.guard import assert_allowed_tables, extract_nested_json
from sqlbot.prompts import chart_system, chart_user, m_schema, sample_preview, sql_system, sql_user
from tools.od_bi import bi_call


def run_sqlbot(question: str, dataset_id: str) -> Dict[str, Any]:
    bot: Dict[str, Any] = {"ok": False, "reason": "empty"}
    for ev in iter_sqlbot(question, dataset_id):
        if ev.get("stage") == "done":
            bot = ev.get("result") or bot
    return bot


def iter_sqlbot(question: str, dataset_id: str) -> Generator[Dict[str, Any], None, None]:
    """Yield pipeline stages, then a final {stage: done, result}."""
    if not llm_configured():
        yield {"stage": "done", "result": {"ok": False, "reason": "llm_missing"}}
        return
    schema = bi_call("GET", f"/api/internal/bi/datasets/{dataset_id}/schema")
    if not isinstance(schema, dict):
        yield {"stage": "done", "result": {"ok": False, "reason": "schema"}}
        return
    table = str(schema.get("tableName") or "")
    if not table:
        yield {"stage": "schema", "schema": schema}
        yield {
            "stage": "done",
            "result": {"ok": False, "reason": "no_table", "message": "数据集未绑定物理表", "schema": schema},
        }
        return
    engine = str(schema.get("engine") or "mysql")
    yield {"stage": "schema", "schema": schema}

    sample = ""
    sample_rows: List[Any] = []
    sample_cols: List[Any] = []
    try:
        preview = bi_call(
            "POST",
            "/api/internal/bi/query/dataset",
            {"datasetId": dataset_id, "limit": 3},
        )
        if isinstance(preview, dict):
            sample_rows = list(preview.get("rows") or preview.get("data") or [])
            sample_cols = list(preview.get("columns") or preview.get("fields") or [])
            sample = sample_preview(sample_rows, sample_cols)
    except Exception:
        sample = ""
    yield {"stage": "sample", "rows": sample_rows[:3], "columns": sample_cols, "schema": schema}

    model = str(llm_settings().get("model") or "")
    yield {"stage": "llm_start", "model": model}
    schema_text = m_schema(schema)
    knowledge = _ask_knowledge(question, dataset_id, schema)
    sql_payload, raw_sql_text = _generate_sql(question, engine, schema_text, sample, knowledge=knowledge)
    if not sql_payload.get("success"):
        yield {
            "stage": "llm",
            "ok": False,
            "model": model,
            "message": sql_payload.get("message") or "无法生成 SQL",
        }
        yield {
            "stage": "done",
            "result": {
                "ok": False,
                "reason": "generate",
                "message": sql_payload.get("message") or "无法生成 SQL",
                "raw": raw_sql_text,
                "schema": schema,
            },
        }
        return
    sql = str(sql_payload.get("sql") or "").strip()
    chart_type = str(sql_payload.get("chart-type") or sql_payload.get("chart_type") or "bar")
    brief = str(sql_payload.get("brief") or question[:20])
    yield {"stage": "llm", "ok": True, "model": model, "sql": sql, "brief": brief, "chartType": chart_type}

    try:
        assert_allowed_tables(sql, [table], engine)
        yield {"stage": "guard", "ok": True, "sql": sql}
    except ValueError as e:
        yield {"stage": "guard", "ok": False, "sql": sql, "message": str(e)}
        yield {"stage": "done", "result": {"ok": False, "reason": "guard", "message": str(e), "sql": sql, "schema": schema}}
        return

    yield {"stage": "execute_start", "sql": sql}
    try:
        executed = bi_call(
            "POST",
            "/api/internal/bi/query/sql",
            {"datasetId": dataset_id, "sql": sql, "limit": 1000},
        )
    except Exception as e:
        yield {"stage": "llm_start", "model": model, "retry": True}
        retry = _generate_sql(question, engine, schema_text, sample, error_msg=str(e)[:800], knowledge=knowledge)
        payload2, _ = retry
        if payload2.get("success") and payload2.get("sql"):
            sql = str(payload2["sql"]).strip()
            yield {"stage": "llm", "ok": True, "model": model, "sql": sql, "brief": brief, "chartType": chart_type, "retry": True}
            try:
                assert_allowed_tables(sql, [table], engine)
                yield {"stage": "guard", "ok": True, "sql": sql}
                executed = bi_call(
                    "POST",
                    "/api/internal/bi/query/sql",
                    {"datasetId": dataset_id, "sql": sql, "limit": 1000},
                )
            except Exception as e2:
                yield {"stage": "execute", "ok": False, "message": str(e2), "sql": sql}
                yield {
                    "stage": "done",
                    "result": {"ok": False, "reason": "execute", "message": str(e2), "sql": sql, "schema": schema},
                }
                return
        else:
            yield {"stage": "execute", "ok": False, "message": str(e), "sql": sql}
            yield {
                "stage": "done",
                "result": {"ok": False, "reason": "execute", "message": str(e), "sql": sql, "schema": schema},
            }
            return

    fields = executed.get("fields") or []
    rows = executed.get("data") or []
    columns = [str(f.get("name")) for f in fields if isinstance(f, dict) and f.get("name")]
    column_labels = display_columns(columns, schema)
    row_count = executed.get("rowCount") if isinstance(executed.get("rowCount"), int) else len(rows)
    span = time_span_hint(schema, sample_rows, sample_cols)
    yield {
        "stage": "execute",
        "ok": True,
        "sql": sql,
        "fields": fields,
        "columns": column_labels,
        "columnNames": columns,
        "rows": rows[:8],
        "rowCount": row_count,
        "timeSpanHint": span,
    }

    chart = _generate_chart(question, sql, chart_type, columns) or _heuristic_chart(
        brief, chart_type, columns, rows, labels=column_labels
    )
    encode = _encode_from_chart(dataset_id, chart, columns, labels=column_labels)
    mapped = _map_chart_type(chart.get("type") or chart_type)
    yield {"stage": "chart", "chartType": mapped, "encode": encode, "brief": brief}
    yield {
        "stage": "done",
        "result": {
            "ok": True,
            "datasetId": dataset_id,
            "datasetName": schema.get("name") or table,
            "schema": schema,
            "sql": sql,
            "brief": brief,
            "chartType": mapped,
            "chart": chart,
            "encode": encode,
            "fields": fields,
            "columns": columns,
            "columnLabels": column_labels,
            "rows": rows[:50],
            "rowCount": row_count,
            "truncated": bool(executed.get("truncated")),
            "timeSpanHint": span,
        },
    }


def _ask_knowledge(question: str, dataset_id: str, schema: Dict[str, Any]) -> str:
    """Compose few-shot gold SQL + confirmed terms/values for the SQLBot prompt."""
    examples: List[Any] = []
    try:
        raw = bi_call("GET", f"/api/internal/bi/datasets/{dataset_id}/questions?limit=8")
        if isinstance(raw, list):
            examples = raw
    except Exception:
        examples = []
    shots = pick_few_shots(question, examples, limit=3)
    for ex in shots:
        qid = ex.get("id")
        if not qid or score_example(question, str(ex.get("question") or "")) <= 0:
            continue
        try:
            bi_call("POST", f"/api/internal/bi/questions/{qid}/hit")
        except Exception:
            pass
    java_block = ""
    try:
        payload = fetch_knowledge([dataset_id])
        java_block = format_knowledge_block(payload.get("metrics") or [], payload.get("terms") or [])
    except Exception:
        java_block = ""
    file_block = prompt_block(question, dataset_id, workspace_id=current_workspace_id())
    value_block = value_hints(question, schema.get("fields") or [])
    return compose_ask_knowledge(
        few_shots=shots,
        file_block=file_block,
        java_block=java_block,
        value_block=value_block,
    )


def _generate_sql(
    question: str,
    engine: str,
    schema_text: str,
    sample: str,
    error_msg: str = "",
    knowledge: str = "",
) -> tuple[Dict[str, Any], str]:
    messages = [
        {"role": "system", "content": sql_system(engine, schema_text, sample, knowledge=knowledge)},
        {"role": "user", "content": sql_user(question, error_msg=error_msg)},
    ]
    resp = chat_completions(messages, temperature=0)
    text = _content(resp)
    blob = extract_nested_json(text) or text
    try:
        data = json.loads(blob)
        if isinstance(data, dict):
            return data, text
    except Exception:
        pass
    return {"success": False, "message": "Cannot parse sql from answer"}, text


def _generate_chart(question: str, sql: str, chart_type: str, columns: List[str]) -> Optional[Dict[str, Any]]:
    try:
        resp = chat_completions(
            [
                {"role": "system", "content": chart_system()},
                {"role": "user", "content": chart_user(question, sql, chart_type, columns)},
            ],
            temperature=0,
        )
        text = _content(resp)
        blob = extract_nested_json(text) or text
        data = json.loads(blob)
        if isinstance(data, dict) and data.get("type") and data.get("type") != "error":
            return data
    except Exception:
        return None
    return None


def _heuristic_chart(
    title: str,
    chart_type: str,
    columns: List[str],
    rows: List[List[Any]],
    labels: Optional[List[str]] = None,
) -> Dict[str, Any]:
    ctype = _map_chart_type(chart_type)
    shown = labels if labels and len(labels) == len(columns) else columns
    if len(columns) >= 2:
        return {
            "type": ctype if ctype != "table" else "bar",
            "title": title,
            "axis": {
                "x": {"name": shown[0], "value": columns[0]},
                "y": [{"name": shown[1], "value": columns[1]}],
            },
        }
    return {"type": "table", "title": title, "columns": [{"name": shown[i], "value": columns[i]} for i in range(len(columns))]}


def _encode_from_chart(
    dataset_id: str,
    chart: Dict[str, Any],
    columns: List[str],
    labels: Optional[List[str]] = None,
) -> Dict[str, Any]:
    axis = chart.get("axis") if isinstance(chart.get("axis"), dict) else {}
    x = axis.get("x") if isinstance(axis.get("x"), dict) else {}
    y = axis.get("y")
    y0 = y[0] if isinstance(y, list) and y and isinstance(y[0], dict) else (y if isinstance(y, dict) else {})
    series = axis.get("series") if isinstance(axis.get("series"), dict) else {}
    dim = x.get("value") or series.get("value") or (columns[0] if columns else None)
    measure = y0.get("value") if isinstance(y0, dict) else (columns[1] if len(columns) > 1 else None)
    shown = labels if labels and len(labels) == len(columns) else columns
    label_by_name = {columns[i]: shown[i] for i in range(len(columns))}
    encode: Dict[str, Any] = {"datasetId": dataset_id, "agg": "SUM"}
    if dim:
        encode["category"] = dim
        encode["categoryLabel"] = str(x.get("name") or label_by_name.get(str(dim), dim))
    if measure:
        encode["value"] = measure
        encode["valueLabel"] = str(y0.get("name") or label_by_name.get(str(measure), measure))
    return encode


def _map_chart_type(raw: str) -> str:
    t = (raw or "bar").lower()
    if t == "column":
        return "bar"
    if t in ("bar", "line", "pie", "table"):
        return t
    return "bar"


def _content(resp: Dict[str, Any]) -> str:
    choice = (resp.get("choices") or [{}])[0]
    msg = choice.get("message") or {}
    return str(msg.get("content") or "")


_FIELD_TOKENS = {
    "order": "订单",
    "cnt": "数",
    "count": "数",
    "num": "数",
    "mch": "商户",
    "merchant": "商户",
    "app": "应用",
    "total": "总",
    "amount": "金额",
    "amt": "金额",
    "avg": "平均",
    "average": "平均",
    "success": "成功",
    "succ": "成功",
    "refund": "退款",
    "income": "收入",
    "plat": "平台",
    "platform": "平台",
    "profit": "利润",
    "pay": "支付",
    "fee": "手续费",
    "qty": "数量",
    "id": "ID",
    "name": "名称",
    "time": "时间",
    "date": "日期",
    "status": "状态",
    "type": "类型",
    "user": "用户",
    "rate": "率",
}


def _has_cjk(text: str) -> bool:
    return any("\u4e00" <= ch <= "\u9fff" for ch in text)


def humanize_ident(name: str) -> str:
    raw = (name or "").strip()
    if not raw or _has_cjk(raw):
        return raw
    parts = [p for p in re.split(r"[_\s]+", raw) if p]
    if not parts:
        return raw
    mapped: List[str] = []
    for part in parts:
        token = _FIELD_TOKENS.get(part.lower())
        if not token:
            return raw
        mapped.append(token)
    return "".join(mapped) or raw


def display_columns(columns: List[str], schema: Optional[Dict[str, Any]] = None) -> List[str]:
    index: Dict[str, str] = {}
    for f in (schema or {}).get("fields") or []:
        if not isinstance(f, dict):
            continue
        name = str(f.get("name") or "").strip()
        label = str(f.get("label") or "").strip()
        if name and label:
            index[name.lower()] = label
    out: List[str] = []
    for col in columns:
        key = str(col or "").strip()
        if not key:
            out.append(key)
            continue
        if _has_cjk(key):
            out.append(key)
            continue
        lab = index.get(key.lower())
        if lab and _has_cjk(lab):
            out.append(lab)
            continue
        out.append(humanize_ident(key))
    return out


def is_empty_query(rows: Any, row_count: Any = None) -> bool:
    data = rows if isinstance(rows, list) else []
    n = row_count if isinstance(row_count, int) else len(data)
    if n <= 0:
        return True
    if n == 1 and data and isinstance(data[0], list) and all(v is None for v in data[0]):
        return True
    return False


def time_span_hint(schema: Dict[str, Any], sample_rows: List[Any], sample_cols: List[Any]) -> str:
    """Best-effort min/max date from schema time fields + sample rows (not a full table scan)."""
    time_names: List[str] = []
    for f in schema.get("fields") or []:
        if not isinstance(f, dict):
            continue
        name = str(f.get("name") or "")
        if not name:
            continue
        group = str(f.get("group") or "").lower()
        dtype = str(f.get("dataType") or "").lower()
        if group in ("time", "date") or "date" in dtype or "time" in dtype:
            time_names.append(name)
    if not time_names or not sample_rows:
        return ""
    col_names: List[str] = []
    for c in sample_cols or []:
        if isinstance(c, dict):
            col_names.append(str(c.get("name") or ""))
        else:
            col_names.append(str(c))
    values: List[str] = []
    for name in time_names:
        idx = col_names.index(name) if name in col_names else -1
        for row in sample_rows:
            raw = None
            if isinstance(row, list) and 0 <= idx < len(row):
                raw = row[idx]
            elif isinstance(row, dict):
                raw = row.get(name)
            if raw is None or raw == "":
                continue
            values.append(str(raw)[:10])
    values = [v for v in values if v]
    if not values:
        return ""
    lo, hi = min(values), max(values)
    if lo == hi:
        return f"样本时间约 {lo}"
    return f"样本时间约 {lo} ～ {hi}"


def bar_heights(rows: List[List[Any]], value_index: int = 1) -> List[float]:
    nums: List[float] = []
    for row in rows[:8]:
        if not isinstance(row, list) or len(row) <= value_index:
            nums.append(0)
            continue
        try:
            nums.append(float(re.sub(r"[^0-9.+-]", "", str(row[value_index])) or 0))
        except Exception:
            nums.append(0)
    mx = max(nums) if nums else 0
    if mx <= 0:
        return [8 for _ in nums]
    return [max(8.0, min(100.0, n / mx * 100)) for n in nums]
