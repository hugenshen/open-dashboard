"""Pi-aligned Agent runtime: tool loop + OD SSE mapping."""

from __future__ import annotations

import json
import os
import re
import urllib.parse
from typing import Any, Dict, Generator, List, Optional

from agent.context import convert_to_llm, history_to_agent_messages, transform_context
from agent.memory import maybe_extract_fact, remember
from agent.types import AgentMessage, sse, step
from agent import session_store
from llm_client import chat_completions, llm_configured, llm_settings
from sqlbot.pipeline import bar_heights, iter_sqlbot
from sqlbot.suggest import is_suggest_request, suggest_follows
from tools.od_bi import ToolState, bi_call, dumps_result
from tools.registry import create_registry


def harness_mode() -> str:
    return (os.environ.get("OD_HARNESS_MODE") or "auto").strip().lower()


def use_lead() -> bool:
    mode = harness_mode()
    if mode == "deterministic":
        return False
    if mode == "lead":
        return True
    return llm_configured()


def resolve_intent(explicit: Optional[str], message: str) -> str:
    if explicit:
        v = explicit.strip().lower()
        if v in ("ask", "insight", "gen"):
            return v
    q = message or ""
    if re.search(r"(为什么|原因|归因|驱动|异常|下滑|下跌|下降)", q):
        return "insight"
    if re.search(r"(生成.*(看板|仪表盘)|经营分析仪表盘|直接生成|做.*看板|加.*图|多来一些|再加)", q):
        return "gen"
    return "ask"


def patch_mode(message: str, linked: Optional[str]) -> str:
    q = message or ""
    if re.search(r"(重新生成|整页|替换全部|从零)", q):
        return "replace"
    if linked:
        return "append"
    return "replace"


def is_specific_board_request(message: str) -> bool:
    """True when the user asked to tweak/add a specific chart rather than a full board."""
    q = message or ""
    return bool(re.search(r"(再加|加一张|只要|仅要|改成|换成|追加|这一张|把.+改)", q))


def _parse_args(raw: Any) -> Dict[str, Any]:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(raw) if raw.strip() else {}
        except json.JSONDecodeError:
            return {"_raw": raw}
    return {}


def _compact_fields(raw: Any) -> List[Dict[str, str]]:
    items: Any = raw
    if isinstance(raw, dict):
        items = raw.get("fields") or raw.get("columns") or []
    if not isinstance(items, list):
        return []
    out: List[Dict[str, str]] = []
    for f in items[:40]:
        if isinstance(f, str):
            name = f.strip()
            if name:
                out.append({"name": name, "label": name})
            continue
        if not isinstance(f, dict):
            continue
        name = str(f.get("name") or f.get("field") or "").strip()
        if not name:
            continue
        out.append(
            {
                "name": name,
                "label": str(f.get("label") or f.get("title") or name),
                "dataType": str(f.get("dataType") or f.get("type") or ""),
                "group": str(f.get("group") or f.get("fieldGroup") or f.get("role") or ""),
            }
        )
    return out


def _labels_of(items: Any, limit: int = 8) -> List[str]:
    out: List[str] = []
    if not isinstance(items, list):
        return out
    for x in items:
        if len(out) >= limit:
            break
        if isinstance(x, str) and x.strip():
            out.append(x.strip())
        elif isinstance(x, dict):
            lab = str(x.get("label") or x.get("name") or "").strip()
            if lab:
                out.append(lab)
    return out


def _encode_line(encode: Any, title: str = "", chart_type: str = "") -> str:
    enc = encode if isinstance(encode, dict) else {}
    bits: List[str] = []
    if title:
        bits.append(str(title))
    if chart_type:
        bits.append(str(chart_type))
    agg = str(enc.get("agg") or "").strip()
    value = str(enc.get("value") or enc.get("field") or "").strip()
    cat = str(enc.get("category") or "").strip()
    if agg and value:
        bits.append(f"{agg}({value})")
    elif value:
        bits.append(value)
    if cat:
        bits.append(f"按 {cat}")
    if enc.get("filters"):
        bits.append("含筛选")
    return " · ".join(bits)


def _probe_items(probes: Any) -> List[str]:
    out: List[str] = []
    if not isinstance(probes, list):
        return out
    for p in probes[:12]:
        if not isinstance(p, dict):
            continue
        kind = str(p.get("kind") or "探测")
        field = str(p.get("field") or p.get("category") or "")
        value = str(p.get("value") or "")
        bit = f"{kind} {field}".strip()
        if value:
            bit += f" × {value}"
        kpi = p.get("kpiValue")
        n = p.get("rowCount")
        if kpi is not None:
            bit += f" = {kpi}"
        elif isinstance(n, int):
            bit += f" → {n} 行"
        if p.get("emptyValue") or p.get("tooGranular"):
            bit += "（跳过）"
        out.append(bit)
    return out


def _schema_preview(schema: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(schema, dict):
        return None
    fields = _compact_fields(schema)
    if not fields:
        return None
    table = str(schema.get("tableName") or schema.get("name") or "")
    hint = f"{len(fields)} 个字段"
    if table:
        hint = f"{hint} · {table}"
    return {"kind": "schema", "hint": hint, "fields": fields, "tableName": table}


def _query_preview(result: Any, args: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    args = args if isinstance(args, dict) else {}
    data = result if isinstance(result, dict) else {}
    encode = data.get("encode") or args.get("encode") or {}
    title = str(data.get("title") or args.get("title") or "")
    chart_type = str(data.get("chartType") or args.get("chartType") or "")
    sample = data.get("sample") or data.get("rows") or []
    if not isinstance(sample, list):
        sample = []
    rows = data.get("rowCount")
    if not isinstance(rows, int):
        rows = len(sample)
    columns = data.get("columns") or []
    if not isinstance(columns, list):
        columns = []
    columns = [str(c.get("name") if isinstance(c, dict) else c) for c in columns[:20]]
    fields = _compact_fields(data)
    if not columns and fields:
        columns = [f["name"] for f in fields[:20]]
    summary = _encode_line(encode, title, chart_type)
    hint = f"{rows} 行" if data else "查询中"
    if summary:
        hint = f"{summary} · {hint}" if data else summary
    sql = str(data.get("sql") or args.get("sql") or "")[:4000]
    return {
        "kind": "query",
        "hint": hint[:80],
        "summary": summary,
        "sql": sql,
        "fields": fields,
        "sample": sample[:8],
        "columns": columns,
        "encode": encode if isinstance(encode, dict) else {},
        "title": title,
        "chartType": chart_type,
        "rowCount": rows,
    }


def _profile_preview(result: Dict[str, Any]) -> Dict[str, Any]:
    fields = _compact_fields(result)
    dims = _labels_of(result.get("dims"))
    measures = _labels_of(result.get("measures"))
    times = _labels_of(result.get("timeFields"))
    probes = _probe_items(result.get("probes"))
    empty = bool(result.get("empty"))
    bits: List[str] = []
    if dims:
        bits.append("维度 " + "、".join(dims))
    if measures:
        bits.append("指标 " + "、".join(measures))
    if times:
        bits.append("时间 " + "、".join(times))
    summary = str(result.get("hint") or "")[:400]
    if not summary:
        summary = "；".join(bits)
    n = len(fields)
    hint = "无有效行" if empty else (f"{n} 个字段" if n else "已分析")
    if dims or measures:
        hint = f"维度 {len(dims)} · 指标 {len(measures)}"
        if empty:
            hint += " · 无有效行"
    items: List[str] = []
    items.extend(bits)
    items.extend(probes)
    return {
        "kind": "profile",
        "hint": hint,
        "summary": summary,
        "fields": fields,
        "items": items,
        "dims": dims,
        "measures": measures,
        "timeFields": times,
        "tableName": str(result.get("tableName") or result.get("name") or ""),
    }


def _tool_preview(name: str, result: Any, args: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    args = args if isinstance(args, dict) else {}
    if name == "od_get_schema":
        prev = _schema_preview(result)
        if prev:
            return prev
        ds = args.get("datasetId")
        if ds:
            return {"kind": "schema", "hint": "读取中", "summary": f"数据集 {ds}"}
        return None
    if name == "od_list_datasets":
        rows = result if isinstance(result, list) else None
        if rows is None and isinstance(result, dict):
            rows = result.get("datasets") or result.get("items") or result.get("data") or []
        if isinstance(rows, list):
            names = []
            for x in rows[:20]:
                if isinstance(x, dict):
                    names.append(str(x.get("name") or x.get("id") or ""))
                else:
                    names.append(str(x))
            names = [n for n in names if n]
            return {"kind": "list", "hint": f"{len(rows)} 个数据集", "items": names}
        return None
    if not isinstance(result, dict):
        result = {}
    if name == "od_profile_dataset":
        if not result and args.get("datasetId"):
            return {"kind": "profile", "hint": "分析中", "summary": f"数据集 {args.get('datasetId')}"}
        if result:
            return _profile_preview(result)
        return None
    if name in ("od_run_query", "od_run_sql"):
        return _query_preview(result, args)
    return None


def _query_from_applied(applied_wrap: Dict[str, Any]) -> Any:
    applied = applied_wrap.get("result") or {}
    if isinstance(applied.get("query"), dict):
        return applied.get("query")
    patch = applied_wrap.get("patch") or {}
    for op in patch.get("ops") or []:
        if not isinstance(op, dict):
            continue
        if str(op.get("op") or "") != "upsert_component":
            continue
        if str(op.get("type") or "") != "query":
            continue
        props = op.get("props") or {}
        return {
            "label": (props.get("label") if isinstance(props, dict) else None) or "查询条件",
            "items": (props.get("items") if isinstance(props, dict) else None) or [],
        }
    return None


def _load_intent_plan(message: str, dataset_ids: List[str]) -> Optional[Dict[str, Any]]:
    try:
        plan = bi_call(
            "POST",
            "/api/internal/bi/resolve-intent",
            {"message": message, "datasetIds": dataset_ids},
        )
        return plan if isinstance(plan, dict) else None
    except Exception:
        return None


def _clarify_from_intent(plan: Dict[str, Any], message: str) -> Generator[str, None, None]:
    unresolved = plan.get("unresolved") or []
    bits: List[str] = []
    for u in unresolved:
        if isinstance(u, dict):
            bits.append(f"{u.get('phrase') or ''}：{u.get('reason') or ''}")
    html = "无法按原意取数。"
    if bits:
        html += "缺字段：" + "；".join(bits)
    mapped = plan.get("mapping") or []
    if mapped:
        hits = []
        for x in mapped:
            if isinstance(x, dict):
                hits.append(f"{x.get('phrase')}→{x.get('label') or x.get('field')}")
        if hits:
            html += "。已对齐：" + "、".join(hits)
    ds_id = str(plan.get("datasetId") or "")
    if ds_id:
        yield from _emit_question_suggestions(
            ds_id,
            message,
            title="当前数据集无法完整回答该问题",
            failed_reason=html,
        )
        return
    yield sse(
        "answer_clarify",
        {
            "title": "当前数据集无法完整回答该问题",
            "headlineHtml": str(plan.get("rewrite") or ""),
            "insightHtml": html,
            "follows": ["各区域销售额对比"],
            "question": message,
        },
    )
    yield sse("finish", {"reason": "answered", "detail": "clarify"})


def _emit_question_suggestions(
    ds_id: str,
    message: str,
    *,
    title: str = "先选一个问数问题",
    failed_reason: Optional[str] = None,
) -> Generator[str, None, None]:
    yield step(
        "suggest",
        "根据当前表反问可问问题",
        kind="tool_start",
        tool="od_get_schema",
    )
    try:
        schema = bi_call("GET", f"/api/internal/bi/datasets/{urllib.parse.quote(ds_id)}/schema")
    except Exception as e:
        yield sse("error", {"code": "SCHEMA", "message": str(e)})
        yield sse("finish", {"reason": "error", "detail": "schema"})
        return
    if not isinstance(schema, dict):
        yield sse("error", {"code": "SCHEMA", "message": "no schema"})
        yield sse("finish", {"reason": "error", "detail": "schema"})
        return
    prev = _schema_preview(schema)
    name = str(schema.get("name") or schema.get("tableName") or "当前表")
    yield step(
        "suggest",
        f"根据「{name}」字段反问可问问题",
        kind="tool_end",
        tool="od_get_schema",
        preview=prev,
        hint=(prev or {}).get("hint") or name,
    )
    follows = suggest_follows(schema, seed=message)
    if not follows:
        follows = [f"{name}有多少行"]
    yield sse(
        "answer_clarify",
        {
            "title": title,
            "headlineHtml": f"当前表是「{name}」。点一个具体问题，我会生成 SQL 并出图。",
            "insightHtml": str(failed_reason or "下面是根据这张表字段生成的可问问题，也可以自己输入。"),
            "follows": follows,
            "question": message,
            "datasetId": ds_id,
            "datasetName": name,
        },
    )
    yield sse("finish", {"reason": "answered", "detail": "suggest"})


def _quality_label(result: Dict[str, Any]) -> str:
    quality = result.get("quality") if isinstance(result.get("quality"), dict) else result
    fixes = list((quality or {}).get("fixes") or []) if isinstance(quality, dict) else []
    seen: List[str] = []
    for f in fixes:
        s = str(f)
        if s and s not in seen:
            seen.append(s)
    if not seen:
        return "质检通过"
    return "质检修复：" + "、".join(seen[:6])


def _emit_applied(applied_wrap: Dict[str, Any]) -> Generator[str, None, None]:
    title = applied_wrap.get("title") or "AI 生成看板"
    mode = applied_wrap.get("mode") or "replace"
    patch = applied_wrap.get("patch") or {}
    applied = applied_wrap.get("result") or {}
    dash_id = applied.get("dashboardId")
    charts = applied.get("charts") or []
    yield sse("patch", {"dashboardId": dash_id, "mode": mode, "ops": patch.get("ops") or []})
    live: List[Dict[str, Any]] = []
    empty_n = 0
    for c in charts:
        row_count = int(c.get("rowCount") or 0)
        kpi = c.get("kpiValue")
        chart_empty = row_count == 0
        if str(c.get("chartType")) == "kpi" and kpi is None:
            chart_empty = True
        if chart_empty:
            empty_n += 1
            continue
        live.append(c)
        yield sse("chart_ready", c)
    all_empty = bool(charts) and empty_n == len(charts)
    yield sse(
        "board_ready",
        {
            "dashboardId": dash_id,
            "title": title,
            "chartCount": len(live),
            "emptyPreview": all_empty,
            "mode": mode,
            "charts": live,
            "query": _query_from_applied(applied_wrap),
        },
    )


def _chart_titles(patch: Dict[str, Any]) -> List[str]:
    out: List[str] = []
    for op in (patch or {}).get("ops") or []:
        if not isinstance(op, dict):
            continue
        if str(op.get("op") or "") != "upsert_chart":
            continue
        title = op.get("title")
        if title:
            out.append(str(title))
    return out


def _store_pending(conversation_id: str, run_id: str, pending: Dict[str, Any]) -> None:
    if conversation_id and run_id:
        session_store.set_run_pending(conversation_id, run_id, pending)


def _plan_sse(pending: Dict[str, Any], message: str, via: str) -> str:
    patch = pending.get("patch") or {}
    return sse(
        "plan",
        {
            "title": pending.get("title"),
            "mode": pending.get("mode"),
            "opsCount": len(patch.get("ops") or []),
            "charts": _chart_titles(patch),
            "message": message,
            "via": via,
            "awaitingConfirm": True,
        },
    )


def run_confirm_plan(pending: Dict[str, Any]) -> Generator[str, None, None]:
    title = pending.get("title") or "AI 生成看板"
    mode = pending.get("mode") or "replace"
    patch = pending.get("patch") or {}
    linked = pending.get("linkedDashboardId")
    yield step("apply", "确认计划，写入看板草稿")
    try:
        applied = bi_call(
            "POST",
            "/api/internal/bi/apply-patch",
            {
                "dashboardId": linked,
                "title": title,
                "mode": mode,
                "patch": patch,
            },
        )
    except Exception as e:
        yield sse("error", {"code": "APPLY", "message": str(e)})
        yield sse("finish", {"reason": "error", "detail": "apply"})
        return
    yield from _emit_applied({"title": title, "mode": mode, "patch": patch, "result": applied})
    dash_id = applied.get("dashboardId")
    charts = applied.get("charts") or []
    hint = f"已生成「{title}」看板草稿 #{dash_id}，含 {len(charts)} 个组件。"
    yield sse("message_delta", {"text": hint})
    yield sse("finish", {"reason": "done", "detail": f"applied:{dash_id}", "dashboardId": dash_id})


def run_agent(payload: Dict[str, Any]) -> Generator[str, None, None]:
    """Entry: lead if LLM configured (per mode), else deterministic. No silent fake success when mode=lead."""
    mode = harness_mode()
    if use_lead():
        try:
            yield from run_lead(payload)
            return
        except RuntimeError as e:
            if "LLM_NOT_CONFIGURED" in str(e):
                if mode == "lead":
                    yield sse("error", {"code": "LLM_NOT_CONFIGURED", "message": str(e)})
                    yield sse("finish", {"reason": "error", "detail": "llm_not_configured"})
                    return
                yield step("fallback", "LLM 未配置，降级确定性工具环")
            else:
                yield sse("error", {"code": "LEAD", "message": str(e)})
                if mode == "lead":
                    yield sse("finish", {"reason": "error", "detail": "lead"})
                    return
                yield step("fallback", "Lead 失败，降级确定性工具环")
        except Exception as e:
            yield sse("error", {"code": "LEAD", "message": str(e)})
            if mode == "lead":
                yield sse("finish", {"reason": "error", "detail": "lead_exception"})
                return
            yield step("fallback", "Lead 异常，降级确定性工具环")
    elif mode == "lead":
        yield sse("error", {"code": "LLM_NOT_CONFIGURED", "message": "OD_LLM_API_KEY missing"})
        yield sse("finish", {"reason": "error", "detail": "llm_not_configured"})
        return

    yield from run_deterministic(payload)


def run_lead(payload: Dict[str, Any], *, max_rounds: int = 14) -> Generator[str, None, None]:
    if not llm_configured():
        raise RuntimeError("LLM_NOT_CONFIGURED")

    cfg = llm_settings()
    conversation_id = str(payload.get("conversationId") or "")
    run_id = str(payload.get("runId") or "")
    message = payload.get("message") or ""
    dataset_ids: List[str] = [str(x) for x in (payload.get("datasetIds") or [])]
    linked = payload.get("linkedDashboardId") or None
    style_id = payload.get("styleId") or "feishu-blue"
    intent = payload.get("intent")
    run_mode = (payload.get("mode") or "auto").lower()
    history = payload.get("history") or []

    yield step("agent_start", f"Pi Agent · model={cfg['model']}")
    resolved = resolve_intent(intent, message)
    intent = resolved
    if not dataset_ids:
        yield sse("error", {"code": "BI_DATASETS", "message": "未选择数据集"})
        yield sse("finish", {"reason": "error", "detail": "datasets"})
        return
    if intent in ("ask", "insight"):
        yield from _run_ask(message, intent, dataset_ids)
        return
    yield step("context", "transformContext + skills + memory")

    fact = maybe_extract_fact(message, dataset_ids)
    if conversation_id and fact:
        remember(conversation_id, fact)

    board_summary = None
    if linked:
        try:
            board_summary = bi_call(
                "GET",
                f"/api/internal/bi/board-summary?dashboardId={urllib.parse.quote(str(linked))}",
            )
        except Exception:
            board_summary = None

    tools, state, by_name = create_registry(linked, defer_apply=(run_mode == "plan"))
    openai_tools = [t.openai_spec() for t in tools]

    intent_plan = _load_intent_plan(message, dataset_ids)
    if intent_plan:
        state.last_intent = intent_plan
        yield sse("intent_map", intent_plan)
        yield step(
            "intent_map",
            "已对齐用户短语到字段" if not intent_plan.get("unresolved") else "意图未完全对齐，需要澄清",
        )
        if resolved == "ask" and intent_plan.get("unresolved"):
            yield from _clarify_from_intent(intent_plan, message)
            return

    agent_msgs: List[AgentMessage] = history_to_agent_messages(history)
    agent_msgs.append(
        AgentMessage(
            role="user",
            content=json.dumps(
                {
                    "message": message,
                    "intent": intent,
                    "mode": run_mode,
                    "styleId": style_id,
                    "datasetIds": dataset_ids,
                    "linkedDashboardId": linked,
                    "intentPlan": intent_plan,
                },
                ensure_ascii=False,
            ),
        )
    )
    agent_msgs = transform_context(
        agent_msgs,
        conversation_id=conversation_id or "anon",
        board_summary=board_summary,
        dataset_ids=dataset_ids,
        style_id=style_id,
        intent=intent,
    )

    finished = False
    board_emitted = False

    for round_i in range(max_rounds):
        llm_messages = convert_to_llm(agent_msgs)
        resp = chat_completions(llm_messages, tools=openai_tools)
        choice = (resp.get("choices") or [{}])[0]
        msg = choice.get("message") or {}
        tool_calls = msg.get("tool_calls") or []
        content = msg.get("content")

        asst = AgentMessage(role="assistant", content=content, tool_calls=tool_calls or None)
        agent_msgs.append(asst)

        if content and not tool_calls:
            yield sse("message_delta", {"text": str(content)[:2000]})

        if not tool_calls:
            incomplete = [
                t
                for t in (state.todos or [])
                if isinstance(t, dict) and str(t.get("status") or "") != "completed"
            ]
            if incomplete and not state.applied and not state.pending and resolved == "gen" and round_i < max_rounds - 1:
                agent_msgs.append(
                    AgentMessage(
                        role="user",
                        content=(
                            "<system_reminder>\n规划任务尚未完成，不要提前结束：\n"
                            + "\n".join(f"- [{t.get('status')}] {t.get('content')}" for t in incomplete)
                            + "\n继续：od_profile_dataset → od_plan_charts → od_review_charts → od_layout_board → od_emit_patch。"
                            " 全部完成后把 write_todos 标为 completed，再 od_finish。"
                            " 禁止调用 od_compose_board 机械模板。\n</system_reminder>"
                        ),
                    )
                )
                yield step("planner", "任务未完成，继续按数据特征规划")
                continue
            if state.pending and run_mode == "plan":
                yield _plan_sse(state.pending, message, "pi+llm")
                _store_pending(conversation_id, run_id, state.pending)
                yield sse("finish", {"reason": "awaiting_confirm", "detail": "等待确认计划"})
                finished = True
                break
            if state.applied and not board_emitted:
                yield from _emit_applied(state.applied)
                board_emitted = True
            if state.answers and resolved != "gen" and not board_emitted:
                for ans in state.answers:
                    yield sse(
                        "answer_table",
                        {
                            "title": ans.get("title"),
                            "datasetId": ans.get("datasetId"),
                            "fields": ans.get("fields") or [],
                            "rows": ans.get("rows") or [],
                            "rowCount": ans.get("rowCount") or 0,
                            "encode": ans.get("encode") or {},
                        },
                    )
                    yield sse(
                        "answer_chart",
                        {
                            "title": ans.get("title"),
                            "chartType": ans.get("chartType"),
                            "datasetId": ans.get("datasetId"),
                            "encode": ans.get("encode") or {},
                            "rowCount": ans.get("rowCount") or 0,
                        },
                    )
                yield sse("finish", {"reason": "answered", "detail": "lead_text"})
            elif state.applied:
                dash = (state.applied.get("result") or {}).get("dashboardId")
                yield sse("finish", {"reason": "done", "detail": f"applied:{dash}", "dashboardId": dash})
            else:
                yield sse("finish", {"reason": "answered", "detail": "lead_no_tools"})
            finished = True
            break

        # Tools run sequentially in Python (write tools marked sequential in registry).
        for tc in tool_calls:
            fn = tc.get("function") or {}
            name = fn.get("name") or ""
            args = _parse_args(fn.get("arguments"))
            yield step(
                "tool_execution_start",
                f"调用 {name}",
                kind="tool_start",
                tool=name,
                preview=_tool_preview(name, None, args),
            )
            tool = by_name.get(name)
            try:
                if not tool:
                    result: Any = {"ok": False, "error": f"unknown tool: {name}"}
                else:
                    result = tool.execute(args)
            except Exception as e:
                result = {"ok": False, "error": str(e)}
            preview = _tool_preview(name, result, args)
            hint = preview.get("hint") if isinstance(preview, dict) else None
            yield step("tool_execution_end", f"{name} 完成", kind="tool_end", tool=name, preview=preview, hint=hint)

            if name == "write_todos" and isinstance(result, dict) and result.get("ok"):
                todos = result.get("todos") or []
                labels = [str(t.get("content") or "") for t in todos if isinstance(t, dict)]
                yield sse(
                    "plan",
                    {
                        "title": "Agent 规划",
                        "steps": todos,
                        "awaitingConfirm": False,
                        "via": "planner",
                    },
                )
                if labels:
                    yield step("planner", "规划：" + " → ".join(labels[:8]))

            if name == "od_plan_charts" and isinstance(result, dict) and result.get("ok"):
                if result.get("empty"):
                    yield step("planner", str(result.get("hint") or "数据无有效行，不写空看板"))
                else:
                    n = len(result.get("charts") or [])
                    why = "；".join(str(x) for x in (result.get("rationale") or [])[:4])
                    yield step("planner", f"按特征规划 {n} 张图" + (f"：{why}" if why else ""))
                    yield step("planner", _quality_label(result))

            if name in ("od_review_charts", "od_layout_board") and isinstance(result, dict) and result.get("ok"):
                yield step("planner", _quality_label(result))

            if name == "od_emit_patch" and isinstance(result, dict) and result.get("ok"):
                if run_mode == "plan" and state.pending:
                    yield _plan_sse(state.pending, message, "pi+llm")
                    _store_pending(conversation_id, run_id, state.pending)
                    yield sse("finish", {"reason": "awaiting_confirm", "detail": "等待确认计划"})
                    finished = True
                elif state.applied and not board_emitted:
                    yield from _emit_applied(state.applied)
                    board_emitted = True

            if name == "od_finish":
                fin = state.finished or {}
                emit_answers = resolved != "gen" and not board_emitted
                for ans in state.answers or [] if emit_answers else []:
                    yield sse(
                        "answer_table",
                        {
                            "title": ans.get("title"),
                            "datasetId": ans.get("datasetId"),
                            "fields": ans.get("fields") or [],
                            "rows": ans.get("rows") or [],
                            "rowCount": ans.get("rowCount") or 0,
                            "encode": ans.get("encode") or {},
                        },
                    )
                    if re.search(r"(洞察|为什么|归因)", message or "") or (intent == "insight"):
                        yield sse(
                            "answer_insight",
                            {
                                "title": ans.get("title") or "洞察",
                                "html": fin.get("message") or f"查询返回 {ans.get('rowCount') or 0} 行。",
                                "follows": ["保存到仪表盘", "生成整页看板"],
                            },
                        )
                    else:
                        yield sse(
                            "answer_chart",
                            {
                                "title": ans.get("title"),
                                "chartType": ans.get("chartType"),
                                "datasetId": ans.get("datasetId"),
                                "encode": ans.get("encode") or {},
                                "rowCount": ans.get("rowCount") or 0,
                            },
                        )
                if fin.get("message"):
                    yield sse("message_delta", {"text": fin["message"]})
                elif board_emitted and state.applied:
                    dash = (state.applied.get("result") or {}).get("dashboardId")
                    title = state.applied.get("title")
                    yield sse("message_delta", {"text": f"已由 Agent 生成「{title}」草稿 #{dash}。"})
                reason = fin.get("reason") or "done"
                detail = fin.get("detail") or "lead"
                finish_payload: Dict[str, Any] = {"reason": reason, "detail": detail}
                if state.applied:
                    finish_payload["dashboardId"] = (state.applied.get("result") or {}).get("dashboardId")
                yield sse("finish", finish_payload)
                finished = True

            agent_msgs.append(
                AgentMessage(
                    role="tool",
                    tool_call_id=tc.get("id") or name,
                    name=name,
                    content=dumps_result(result),
                )
            )
            if finished:
                break
            if isinstance(result, dict) and result.get("terminate") and tool and tool.execution_mode == "sequential":
                # Prefer end after sequential write tools when model forgets od_finish next turn
                pass

        if finished:
            break

    if not finished:
        if run_mode == "plan" and state.pending:
            yield _plan_sse(state.pending, message, "pi+llm")
            _store_pending(conversation_id, run_id, state.pending)
            yield sse("finish", {"reason": "awaiting_confirm", "detail": "等待确认计划"})
            yield step("agent_end", "Agent 结束")
            return
        if state.applied and not board_emitted:
            yield from _emit_applied(state.applied)
        yield sse("error", {"code": "LEAD_MAX_ROUNDS", "message": "超过最大工具轮次"})
        yield sse("finish", {"reason": "error", "detail": "max_rounds"})
    yield step("agent_end", "Agent 结束")


def pick_fields(schema: Dict[str, Any]) -> tuple[Optional[str], Optional[str], Optional[str]]:
    fields = schema.get("fields") or []
    dim = None
    measure = None
    for f in fields:
        g = (f.get("group") or "").lower()
        name = f.get("name") or ""
        if dim is None and g in ("dim", "dimension", "d"):
            dim = name
        if measure is None and g in ("quota", "measure", "m", "metric"):
            measure = name
    if dim is None and fields:
        dim = fields[0].get("name")
    if measure is None and len(fields) > 1:
        measure = fields[1].get("name")
    elif measure is None and fields:
        measure = fields[0].get("name")
    return schema.get("id"), dim, measure


def run_deterministic(payload: Dict[str, Any]) -> Generator[str, None, None]:
    message = payload.get("message") or ""
    intent = resolve_intent(payload.get("intent"), message)
    dataset_ids: List[str] = [str(x) for x in (payload.get("datasetIds") or [])]
    linked = payload.get("linkedDashboardId") or None
    style_id = payload.get("styleId") or "feishu-blue"
    mode = (payload.get("mode") or "auto").lower()
    conversation_id = str(payload.get("conversationId") or "")

    yield step("context", "确定性工具环（无 Lead/LLM）")
    yield step("intent", f"意图: {intent}")

    fact = maybe_extract_fact(message, dataset_ids)
    if conversation_id and fact:
        remember(conversation_id, fact)

    if not dataset_ids:
        yield sse("error", {"code": "BI_DATASETS", "message": "未选择数据集"})
        yield sse("finish", {"reason": "error", "detail": "datasets"})
        return

    yield step("schema", f"读取 {len(dataset_ids)} 个数据集的字段")

    if intent in ("ask", "insight"):
        yield from _run_ask(message, intent, dataset_ids)
        return

    yield from _run_gen(
        message,
        dataset_ids,
        linked,
        style_id,
        mode,
        conversation_id,
        str(payload.get("runId") or ""),
    )


def _emit_sqlbot(bot: Dict[str, Any]) -> Generator[str, None, None]:
    sql = str(bot.get("sql") or "")
    title = str(bot.get("brief") or bot.get("chart", {}).get("title") or "问数结果")
    chart_type = str(bot.get("chartType") or "bar")
    rows = bot.get("rows") or []
    columns = bot.get("columns") or []
    encode = bot.get("encode") or {}
    yield sse("answer_sql", {"sql": sql, "title": title, "datasetId": bot.get("datasetId")})
    yield sse(
        "answer_table",
        {
            "title": title,
            "datasetId": bot.get("datasetId"),
            "datasetName": bot.get("datasetName"),
            "columns": columns,
            "rows": rows,
            "rowCount": bot.get("rowCount") or len(rows),
            "truncated": bot.get("truncated"),
            "encode": encode,
            "sql": sql,
        },
    )
    labels = [str(r[0]) for r in rows[:8] if isinstance(r, list) and r]
    yield sse(
        "answer_chart",
        {
            "title": title,
            "chartType": chart_type,
            "datasetId": bot.get("datasetId"),
            "datasetName": bot.get("datasetName"),
            "encode": encode,
            "rowCount": bot.get("rowCount") or len(rows),
            "labels": labels,
            "heights": bar_heights(rows, 1 if len(columns) > 1 else 0),
            "sql": sql,
        },
    )
    yield sse("finish", {"reason": "answered", "detail": "sqlbot"})


def _sqlbot_child_step(ev: Dict[str, Any]) -> Generator[str, None, None]:
    stage = str(ev.get("stage") or "")
    parent = "sqlbot"
    if stage == "schema":
        prev = _schema_preview(ev.get("schema"))
        yield step(
            "sqlbot_schema",
            "读取字段 Schema",
            kind="tool_end",
            tool="od_get_schema",
            parent=parent,
            preview=prev,
            hint=(prev or {}).get("hint"),
        )
        return
    if stage == "sample":
        cols = ev.get("columns") or []
        col_names = [str(c.get("name") if isinstance(c, dict) else c) for c in cols][:20]
        rows = ev.get("rows") or []
        prev = {
            "kind": "query",
            "hint": f"{len(rows)} 行抽样",
            "summary": "用前几行帮助模型理解字段取值",
            "sample": rows,
            "columns": col_names,
            "fields": _compact_fields({"columns": cols} if cols else ev.get("schema") or {}),
        }
        yield step(
            "sqlbot_sample",
            "抽样预览",
            kind="tool_end",
            tool="od_run_query",
            parent=parent,
            preview=prev,
            hint=prev["hint"],
        )
        return
    if stage == "llm_start":
        model = str(ev.get("model") or "LLM")
        extra = "（按错误重试）" if ev.get("retry") else ""
        yield step(
            "sqlbot_llm",
            f"模型 {model} 生成 SQL{extra}",
            kind="tool_start",
            tool="sqlbot_llm",
            parent=parent,
            preview={"kind": "sql", "hint": model, "summary": "按表结构与抽样生成只读 SQL"},
            hint=model,
        )
        return
    if stage == "llm":
        model = str(ev.get("model") or "LLM")
        if ev.get("ok"):
            prev = {
                "kind": "sql",
                "hint": str(ev.get("brief") or "已生成"),
                "sql": str(ev.get("sql") or "")[:4000],
                "summary": str(ev.get("brief") or ""),
            }
            yield step(
                "sqlbot_llm",
                f"模型 {model} 生成 SQL",
                kind="tool_end",
                tool="sqlbot_llm",
                parent=parent,
                preview=prev,
                hint=prev["hint"],
            )
        else:
            yield step(
                "sqlbot_llm",
                f"模型 {model} 未能生成 SQL",
                kind="tool_end",
                tool="sqlbot_llm",
                parent=parent,
                preview={"kind": "sql", "summary": str(ev.get("message") or ""), "hint": "失败"},
            )
        return
    if stage == "guard":
        ok = bool(ev.get("ok"))
        prev = {
            "kind": "sql",
            "hint": "只读校验通过" if ok else "校验未通过",
            "sql": str(ev.get("sql") or "")[:4000],
            "summary": str(ev.get("message") or ("仅允许 SELECT/WITH，且必须是当前数据集的表" if ok else "")),
        }
        yield step(
            "sqlbot_guard",
            "只读校验",
            kind="tool_end",
            tool="sqlbot_guard",
            parent=parent,
            preview=prev,
            hint=prev["hint"],
        )
        return
    if stage == "execute_start":
        yield step(
            "sqlbot_exec",
            "执行查询",
            kind="tool_start",
            tool="od_run_query",
            parent=parent,
            preview={"kind": "query", "sql": str(ev.get("sql") or "")[:4000], "hint": "查询中"},
            hint="查询中",
        )
        return
    if stage == "execute":
        if ev.get("ok"):
            n = ev.get("rowCount") or 0
            prev = {
                "kind": "query",
                "hint": f"{n} 行",
                "sql": str(ev.get("sql") or "")[:4000],
                "sample": ev.get("rows") or [],
                "columns": ev.get("columns") or [],
                "fields": _compact_fields({"fields": ev.get("fields") or []}),
                "rowCount": n,
            }
            yield step(
                "sqlbot_exec",
                "执行查询",
                kind="tool_end",
                tool="od_run_query",
                parent=parent,
                preview=prev,
                hint=prev["hint"],
            )
        else:
            yield step(
                "sqlbot_exec",
                "执行查询失败",
                kind="tool_end",
                tool="od_run_query",
                parent=parent,
                preview={
                    "kind": "query",
                    "summary": str(ev.get("message") or ""),
                    "sql": str(ev.get("sql") or "")[:4000],
                    "hint": "失败",
                },
            )
        return
    if stage == "chart":
        enc = ev.get("encode") if isinstance(ev.get("encode"), dict) else {}
        summary = _encode_line(enc, str(ev.get("brief") or ""), str(ev.get("chartType") or ""))
        yield step(
            "sqlbot_chart",
            "选择图表",
            kind="tool_end",
            tool="sqlbot_chart",
            parent=parent,
            preview={"kind": "profile", "hint": str(ev.get("chartType") or "bar"), "summary": summary, "encode": enc},
            hint=str(ev.get("chartType") or "bar"),
        )


def _run_ask(message: str, intent: str, dataset_ids: List[str]) -> Generator[str, None, None]:
    ds_id = dataset_ids[0]
    if is_suggest_request(message):
        yield from _emit_question_suggestions(ds_id, message)
        return
    if llm_configured():
        yield step("sqlbot", "SQLBot 生成 SQL", kind="tool_start", tool="sqlbot")
        bot: Dict[str, Any] = {"ok": False, "reason": "error"}
        try:
            for ev in iter_sqlbot(message, ds_id):
                if ev.get("stage") == "done":
                    bot = ev.get("result") or bot
                    break
                yield from _sqlbot_child_step(ev)
        except Exception as e:
            bot = {"ok": False, "reason": "error", "message": str(e)}
        done_prev = None
        done_hint = None
        if bot.get("ok"):
            n = bot.get("rowCount") if isinstance(bot.get("rowCount"), int) else len(bot.get("rows") or [])
            done_prev = {
                "kind": "sql",
                "hint": f"已生成 SQL · {n} 行",
                "sql": str(bot.get("sql") or "")[:4000],
            }
            done_hint = done_prev["hint"]
        yield step(
            "sqlbot",
            "SQLBot 生成 SQL",
            kind="tool_end",
            tool="sqlbot",
            preview=done_prev,
            hint=done_hint,
        )
        if bot.get("ok"):
            yield from _emit_sqlbot(bot)
            return
        if bot.get("reason") == "generate":
            yield from _emit_question_suggestions(
                ds_id,
                message,
                title="无法生成 SQL",
                failed_reason=str(
                    bot.get("message")
                    or "未识别到具体问数需求。请点一个基于当前表的问题，或自己输入指标/维度。"
                ),
            )
            return
        yield step("sqlbot_fallback", str(bot.get("message") or "SQLBot 未命中，回退意图卡"))

    intent_plan = _load_intent_plan(message, dataset_ids)
    if intent_plan:
        yield sse("intent_map", intent_plan)
        yield step(
            "intent_map",
            "已对齐用户短语到字段" if not intent_plan.get("unresolved") else "意图未完全对齐，需要澄清",
        )
        if intent_plan.get("unresolved"):
            yield from _clarify_from_intent(intent_plan, message)
            return

    cards = (intent_plan or {}).get("cards") or []
    primary = next((c for c in cards if isinstance(c, dict) and c.get("chartType") in ("bar", "line")), None)
    if primary is None and cards:
        primary = cards[0] if isinstance(cards[0], dict) else None

    if primary and primary.get("measure"):
        ds_id = str((intent_plan or {}).get("datasetId") or ds_id)
        dim = primary.get("dimension")
        measure = primary.get("measure")
        chart_type = str(primary.get("chartType") or ("bar" if intent == "ask" else "line"))
        encode: Dict[str, Any] = {
            "datasetId": ds_id,
            "value": measure,
            "agg": primary.get("agg") or "SUM",
        }
        if dim:
            encode["category"] = dim
        if (intent_plan or {}).get("filters"):
            encode["filters"] = intent_plan.get("filters")
        title = str(primary.get("title") or f"{measure}")
        yield step("query", f"受控 chartQuery: {title}")
        try:
            result = bi_call(
                "POST",
                "/api/internal/bi/query/chart",
                {
                    "chartId": "ask_preview",
                    "dashboardId": None,
                    "view": "draft",
                    "inline": {
                        "datasetId": ds_id,
                        "chartType": chart_type or "bar",
                        "title": title,
                        "encode": encode,
                    },
                    "context": {},
                },
            )
        except Exception as e:
            yield sse("error", {"code": "QUERY", "message": str(e)})
            yield sse("finish", {"reason": "error", "detail": "query"})
            return
        rows = result.get("data") or []
        yield sse(
            "answer_table",
            {
                "title": title,
                "datasetId": ds_id,
                "columns": [c.get("name") for c in (result.get("fields") or []) if isinstance(c, dict)],
                "rows": rows[:50],
                "rowCount": len(rows),
                "encode": encode,
            },
        )
        yield sse(
            "answer_chart",
            {
                "title": title,
                "chartType": chart_type or "bar",
                "datasetId": ds_id,
                "encode": encode,
                "rowCount": len(rows),
                "insightHtml": str((intent_plan or {}).get("rewrite") or ""),
            },
        )
        yield sse("finish", {"reason": "answered", "detail": "intent_query"})
        return

    try:
        schema = bi_call("GET", f"/api/internal/bi/datasets/{urllib.parse.quote(ds_id)}/schema")
    except Exception as e:
        yield sse("error", {"code": "SCHEMA", "message": str(e)})
        yield sse("finish", {"reason": "error", "detail": "schema"})
        return

    yield step("evidence", f"读取 schema: {schema.get('name') or ds_id}")
    _, dim, measure = pick_fields(schema)
    if not dim or not measure:
        yield sse(
            "answer_insight",
            {
                "title": "无法问数",
                "html": f"数据集 <strong>{schema.get('name') or ds_id}</strong> 缺少可用维度/指标字段。",
                "follows": ["换一个数据集", "直接生成看板"],
            },
        )
        yield sse("finish", {"reason": "answered", "detail": "clarify"})
        return

    encode = {"datasetId": ds_id, "category": dim, "value": measure, "agg": "SUM"}
    inline = {
        "datasetId": ds_id,
        "chartType": "bar" if intent == "ask" else "line",
        "title": f"{measure} by {dim}",
        "encode": encode,
    }
    yield step("query", f"受控 chartQuery: {dim} × {measure}")
    try:
        result = bi_call(
            "POST",
            "/api/internal/bi/query/chart",
            {
                "chartId": "ask_preview",
                "dashboardId": None,
                "view": "draft",
                "inline": inline,
                "context": {},
            },
        )
    except Exception as e:
        yield sse("error", {"code": "QUERY", "message": str(e)})
        yield sse("finish", {"reason": "error", "detail": "query"})
        return

    data = result.get("data") or []
    row_count = len(data)
    empty = row_count == 0 or (row_count == 1 and data[0] and all(v is None for v in data[0]))

    if empty:
        yield sse(
            "answer_insight",
            {
                "title": "查询无有效数据",
                "html": (
                    f"已对 <strong>{schema.get('name') or ds_id}</strong> 按 "
                    f"<strong>{dim}</strong> / <strong>{measure}</strong> 聚合，结果为空。"
                ),
                "follows": ["换订单表再问", "直接生成看板看看结构"],
            },
        )
        yield sse("finish", {"reason": "answered", "detail": "empty"})
        return

    labels = [str(r[0]) for r in data[:8] if r]
    yield sse(
        "answer_table",
        {
            "title": f"{schema.get('name') or ds_id} · {measure}",
            "datasetId": ds_id,
            "fields": result.get("fields") or [],
            "rows": data[:50],
            "rowCount": row_count,
            "encode": encode,
        },
    )
    yield sse(
        "answer_chart",
        {
            "title": inline["title"],
            "chartType": inline["chartType"],
            "datasetId": ds_id,
            "encode": encode,
            "labels": labels,
            "rowCount": row_count,
        },
    )
    if intent == "insight":
        top = labels[0] if labels else "—"
        yield sse(
            "answer_insight",
            {
                "title": "初步解读",
                "html": f"基于实时查询，<strong>{dim}</strong> 上 <strong>{top}</strong> 等出现在前列（共 {row_count} 行）。",
                "follows": ["保存到仪表盘", "生成整页看板"],
            },
        )
    yield sse("message_delta", {"text": f"问数完成：{row_count} 行（会话预览，未写入看板）。"})
    yield sse("finish", {"reason": "answered", "detail": intent})


def _run_gen(
    message: str,
    dataset_ids: List[str],
    linked: Optional[str],
    style_id: str,
    run_mode: str,
    conversation_id: str = "",
    run_id: str = "",
) -> Generator[str, None, None]:
    mode = patch_mode(message, linked)
    if not dataset_ids:
        yield sse("error", {"code": "BI_DATASETS", "message": "未选择数据集"})
        yield sse("finish", {"reason": "error", "detail": "datasets"})
        return
    if linked:
        try:
            summary = bi_call(
                "GET",
                f"/api/internal/bi/board-summary?dashboardId={urllib.parse.quote(str(linked))}",
            )
            n = len(summary.get("charts") or [])
            yield step("board", f"当前看板摘要：{n} 个图表（mode={mode}）")
        except Exception:
            yield step("board", "无可用看板摘要，按新建处理")

    tools, _state, by_name = create_registry(linked)
    ds_id = dataset_ids[0]
    planned: Dict[str, Any] = {}
    yield step("planner", "分析数据特征 → 按特征选图 → 质检修复")
    try:
        planned = by_name["od_plan_charts"].execute({"datasetId": ds_id}) or {}
    except Exception as e:
        yield step("fallback", f"plan_charts 失败，降级 compose：{e}")
        planned = {"ok": False}

    patch: Dict[str, Any] = {}
    title = "AI 生成看板"
    composed: Dict[str, Any] = {}

    if isinstance(planned, dict) and planned.get("ok") and not planned.get("empty") and planned.get("charts"):
        n = len(planned.get("charts") or [])
        yield step("planner", f"按特征规划 {n} 张图")
        yield step("planner", _quality_label(planned))
        laid = by_name["od_layout_board"].execute(
            {
                "title": planned.get("title") or title,
                "styleId": style_id,
                "charts": planned.get("charts"),
                "query": planned.get("query"),
            }
        )
        if not (isinstance(laid, dict) and laid.get("ok")):
            yield sse("error", {"code": "LAYOUT", "message": (laid or {}).get("error") or "layout failed"})
            yield sse("finish", {"reason": "error", "detail": "layout"})
            return
        yield step("planner", _quality_label(laid))
        patch = laid.get("patch") or {}
        title = laid.get("title") or planned.get("title") or title
    else:
        if isinstance(planned, dict) and planned.get("empty"):
            yield step("planner", str(planned.get("hint") or "数据无有效行，不写空看板"))
            yield sse("message_delta", {"text": str(planned.get("hint") or "探测无有效行，请换有数据的业务表。")})
            yield sse("finish", {"reason": "answered", "detail": "empty_dataset"})
            return
        yield step("compose", "规划失败，降级 compose-board")
        try:
            composed = bi_call(
                "POST",
                "/api/internal/bi/compose-board",
                {
                    "message": message,
                    "dashboardId": linked if mode == "append" else None,
                    "styleId": style_id,
                    "datasetIds": dataset_ids,
                    "mode": mode,
                },
            )
        except Exception as e:
            yield sse("error", {"code": "COMPOSE", "message": str(e)})
            yield sse("finish", {"reason": "error", "detail": "compose"})
            return
        if not composed.get("ok"):
            yield sse(
                "error",
                {
                    "code": "COMPOSE",
                    "message": composed.get("error") or "compose failed",
                    "missing": composed.get("missing"),
                },
            )
            yield sse("finish", {"reason": "error", "detail": "compose"})
            return
        patch = composed.get("patch") or {}
        title = composed.get("title") or title

    plan = {
        "title": title,
        "mode": mode,
        "opsCount": len(patch.get("ops") or []),
        "charts": _chart_titles(patch),
        "message": message,
        "via": "deterministic",
    }
    if run_mode == "plan":
        plan["awaitingConfirm"] = True
        yield sse("plan", plan)
        _store_pending(
            conversation_id,
            run_id,
            {
                "title": title,
                "mode": mode,
                "patch": patch,
                "linkedDashboardId": linked,
                "styleId": style_id,
            },
        )
        yield sse("finish", {"reason": "awaiting_confirm", "detail": "等待确认计划"})
        return

    yield step("apply", "写入看板草稿")
    try:
        applied = bi_call(
            "POST",
            "/api/internal/bi/apply-patch",
            {
                "dashboardId": linked,
                "title": title,
                "mode": mode,
                "patch": patch,
            },
        )
    except Exception as e:
        yield sse("error", {"code": "APPLY", "message": str(e)})
        yield sse("finish", {"reason": "error", "detail": "apply"})
        return

    yield from _emit_applied({"title": title, "mode": mode, "patch": patch, "result": applied})
    dash_id = applied.get("dashboardId")
    charts = applied.get("charts") or []

    weak = bool(composed.get("weakDataset") or (planned.get("features") or {}).get("weakDataset"))
    ds_name = composed.get("datasetName") or planned.get("title") or ""
    if not charts:
        hint = (
            f"已生成「{title}」草稿 #{dash_id}，但预览无有效数据"
            "（表可能为空或聚合为 null）。请换有数据的业务数据集，或检查源表。"
        )
    else:
        hint = f"已生成「{title}」看板草稿 #{dash_id}，含 {len(charts)} 个组件。"
    if weak:
        hint += (
            f" 当前用的是元数据/验证集「{ds_name}」，经营分析请改选「订单表」「销售明细」等业务数据集。"
        )
    yield sse("message_delta", {"text": hint})
    yield sse("finish", {"reason": "done", "detail": f"applied:{dash_id}", "dashboardId": dash_id})
