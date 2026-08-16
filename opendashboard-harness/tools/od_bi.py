"""OD BI tools: definitions in harness, execution via Java /api/internal/bi/*."""

from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable, Dict, List, Optional

from agent.types import AgentTool


def bi_base() -> str:
    return (os.environ.get("OD_BI_BASE") or "http://127.0.0.1:8082").rstrip("/")


def internal_token() -> str:
    return os.environ.get("OD_INTERNAL_TOKEN") or "od-dev-internal"


def bi_call(method: str, path: str, body: Any = None) -> Any:
    url = f"{bi_base()}{path}"
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-OD-Internal-Token": internal_token(),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"BI {method} {path} -> {e.code}: {err}") from e


def bi_health() -> bool:
    try:
        bi_call("GET", "/api/internal/bi/health")
        return True
    except Exception:
        return False


class ToolState:
    def __init__(self) -> None:
        self.applied: Optional[Dict[str, Any]] = None
        self.answers: List[Dict[str, Any]] = []
        self.finished: Optional[Dict[str, Any]] = None
        self.todos: List[Dict[str, Any]] = []
        self.last_plan: Optional[Dict[str, Any]] = None
        self.last_review: Optional[Dict[str, Any]] = None
        self.last_intent: Optional[Dict[str, Any]] = None


def build_od_tools(
    linked_dashboard_id: Optional[str],
    state: ToolState,
) -> List[AgentTool]:
    def list_datasets(_: Dict[str, Any]) -> Any:
        return bi_call("GET", "/api/internal/bi/datasets")

    def get_schema(args: Dict[str, Any]) -> Any:
        ds = args.get("datasetId") or ""
        return bi_call("GET", f"/api/internal/bi/datasets/{urllib.parse.quote(str(ds))}/schema")

    def run_sql(args: Dict[str, Any]) -> Any:
        ds = args.get("datasetId")
        sql = args.get("sql") or ""
        from sqlbot.guard import assert_allowed_tables

        schema = bi_call("GET", f"/api/internal/bi/datasets/{urllib.parse.quote(str(ds))}/schema")
        table = (schema or {}).get("tableName") if isinstance(schema, dict) else None
        engine = (schema or {}).get("engine") if isinstance(schema, dict) else None
        if not table:
            raise RuntimeError("dataset has no physical table")
        assert_allowed_tables(str(sql), [str(table)], str(engine) if engine else None)
        executed = bi_call(
            "POST",
            "/api/internal/bi/query/sql",
            {"datasetId": ds, "sql": sql, "limit": args.get("limit") or 1000},
        )
        data = executed.get("data") or []
        answer = {
            "title": args.get("title") or "SQLBot",
            "chartType": args.get("chartType") or "bar",
            "datasetId": ds,
            "sql": executed.get("sql") or sql,
            "fields": executed.get("fields") or [],
            "rows": data[:50],
            "rowCount": executed.get("rowCount") if isinstance(executed.get("rowCount"), int) else len(data),
            "encode": args.get("encode") or {"datasetId": ds},
        }
        state.answers.append(answer)
        return {"ok": True, "rowCount": answer["rowCount"], "sample": data[:5], "fields": executed.get("fields"), "sql": answer["sql"]}

    def run_query(args: Dict[str, Any]) -> Any:
        ds = args.get("datasetId")
        chart_type = args.get("chartType") or "bar"
        title = args.get("title") or "query"
        encode = dict(args.get("encode") or {})
        intent_filters = (state.last_intent or {}).get("filters") if isinstance(state.last_intent, dict) else None
        if intent_filters and not encode.get("filters"):
            encode["filters"] = intent_filters
        inline = {"datasetId": ds, "chartType": chart_type, "title": title, "encode": encode}
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
        data = result.get("data") or []
        answer = {
            "title": title,
            "chartType": chart_type,
            "datasetId": ds,
            "encode": encode,
            "fields": result.get("fields") or [],
            "rows": data[:50],
            "rowCount": len(data),
        }
        state.answers.append(answer)
        return {
            "ok": True,
            "rowCount": len(data),
            "sample": data[:8],
            "fields": result.get("fields"),
            "encode": encode,
            "title": title,
            "chartType": chart_type,
            "columns": [
                str(c.get("name") if isinstance(c, dict) else c) for c in (result.get("fields") or result.get("columns") or [])
            ][:20],
        }

    def board_summary(args: Dict[str, Any]) -> Any:
        dash = args.get("dashboardId") or linked_dashboard_id
        if not dash:
            return {"dashboardId": None, "charts": [], "components": []}
        return bi_call(
            "GET",
            f"/api/internal/bi/board-summary?dashboardId={urllib.parse.quote(str(dash))}",
        )

    def profile_dataset(args: Dict[str, Any]) -> Any:
        ds = args.get("datasetId") or ""
        return bi_call("POST", "/api/internal/bi/profile-dataset", {"datasetId": ds})

    def plan_charts(args: Dict[str, Any]) -> Any:
        ds = str(args.get("datasetId") or "")
        if not ds:
            return {"ok": False, "error": "datasetId required"}
        profile = bi_call("POST", "/api/internal/bi/profile-dataset", {"datasetId": ds})
        planned = _plan_charts_from_profile(ds, profile if isinstance(profile, dict) else {})
        filters = args.get("filters") or (state.last_intent or {}).get("filters")
        if isinstance(planned, dict) and filters:
            for c in planned.get("charts") or []:
                if not isinstance(c, dict):
                    continue
                enc = dict(c.get("encode") or {})
                if not enc.get("filters"):
                    enc["filters"] = filters
                    c["encode"] = enc
        if isinstance(planned, dict) and planned.get("ok") and not planned.get("empty"):
            reviewed = _review_and_repair(
                planned.get("charts") or [],
                planned.get("query"),
                planned.get("probes") or list((profile or {}).get("probes") or []),
            )
            planned["charts"] = reviewed["charts"]
            planned["query"] = reviewed.get("query") or planned.get("query")
            planned["quality"] = {
                "ok": True,
                "issues": reviewed.get("issues") or [],
                "fixes": reviewed.get("fixes") or [],
            }
            if reviewed.get("rationale"):
                planned["rationale"] = list(planned.get("rationale") or []) + list(reviewed["rationale"])
        if isinstance(planned, dict):
            planned["probes"] = list((profile or {}).get("probes") or []) if isinstance(profile, dict) else []
            state.last_plan = planned
            state.last_review = planned.get("quality")
        return planned

    def review_charts(args: Dict[str, Any]) -> Any:
        charts = args.get("charts")
        query = args.get("query")
        probes = args.get("probes") or []
        if (not charts) and isinstance(state.last_plan, dict):
            charts = state.last_plan.get("charts") or []
            if query is None:
                query = state.last_plan.get("query")
            if not probes:
                probes = list(state.last_plan.get("probes") or [])
        if not isinstance(charts, list) or not charts:
            return {"ok": False, "error": "charts required, or call od_plan_charts first"}
        reviewed = _review_and_repair(charts, query, probes if isinstance(probes, list) else [])
        quality = {
            "ok": True,
            "issues": reviewed.get("issues") or [],
            "fixes": reviewed.get("fixes") or [],
        }
        state.last_review = quality
        if isinstance(state.last_plan, dict):
            state.last_plan["charts"] = reviewed.get("charts") or []
            if reviewed.get("query") is not None:
                state.last_plan["query"] = reviewed["query"]
            state.last_plan["quality"] = quality
        return {
            "ok": True,
            "charts": reviewed.get("charts") or [],
            "query": reviewed.get("query"),
            "issues": quality["issues"],
            "fixes": quality["fixes"],
            "rationale": reviewed.get("rationale") or [],
            "quality": quality,
        }

    def write_todos(args: Dict[str, Any]) -> Any:
        todos = args.get("todos") or []
        normalized: List[Dict[str, Any]] = []
        for t in todos:
            if isinstance(t, str):
                normalized.append({"content": t, "status": "pending"})
            elif isinstance(t, dict):
                normalized.append(
                    {
                        "content": t.get("content") or t.get("label") or "",
                        "status": t.get("status") or "pending",
                    }
                )
        state.todos = normalized
        return {"ok": True, "todos": normalized}

    def layout_board(args: Dict[str, Any]) -> Any:
        charts = args.get("charts") or []
        style_id = args.get("styleId") or "feishu-blue"
        title = args.get("title") or "AI 生成看板"
        if not isinstance(charts, list) or not charts:
            return {"ok": False, "error": "charts required: [{type,title,datasetId,encode}]"}
        query = args.get("query") or {}
        probes = []
        if isinstance(state.last_plan, dict):
            probes = list(state.last_plan.get("probes") or [])
        reviewed = _review_and_repair(charts, query, probes)
        state.last_review = {
            "ok": True,
            "issues": reviewed.get("issues") or [],
            "fixes": reviewed.get("fixes") or [],
        }
        charts = reviewed.get("charts") or charts
        if reviewed.get("query") is not None:
            query = reviewed["query"]
        query_items: List[Any] = []
        if isinstance(query, list):
            query_items = query
        elif isinstance(query, dict):
            query_items = list(query.get("items") or [])
        ops: List[Dict[str, Any]] = [
            {"op": "set_layout", "gridCols": 72, "themeRef": "default"},
            {"op": "set_theme", "styleId": style_id},
        ]
        kpis = [c for c in charts if str((c or {}).get("type") or "") == "kpi"]
        tables = [c for c in charts if str((c or {}).get("type") or "") in ("table", "grouptable")]
        plots = [c for c in charts if str((c or {}).get("type") or "") not in ("kpi", "table", "grouptable")]
        seq = 1
        base = int(time.time() * 1000) % 1_000_000_000

        def add_chart(spec: Dict[str, Any], x: int, y: int, w: int, h: int) -> None:
            nonlocal seq
            raw = spec.get("chartId")
            cid = str(raw) if raw is not None and str(raw).isdigit() else str(base + seq)
            seq += 1
            ops.append(
                {
                    "op": "upsert_chart",
                    "chartId": cid,
                    "type": spec.get("type") or "bar",
                    "datasetId": spec.get("datasetId"),
                    "title": spec.get("title") or cid,
                    "encode": spec.get("encode") or {},
                    "style": spec.get("style") or {},
                }
            )
            ops.append(
                {
                    "op": "upsert_component",
                    "id": "c_" + cid,
                    "type": "chart",
                    "chartId": cid,
                    "x": x,
                    "y": y,
                    "w": w,
                    "h": h,
                }
            )

        y = 0
        if query_items:
            ops.append(
                {
                    "op": "upsert_component",
                    "id": "q_filters",
                    "type": "query",
                    "x": 0,
                    "y": 0,
                    "w": 72,
                    "h": 8,
                    "props": {
                        "label": (query.get("label") if isinstance(query, dict) else None) or "查询条件",
                        "items": query_items,
                        "align": "center",
                    },
                }
            )
            y = 9
        kpi_n = min(4, len(kpis))
        kpi_w = 72 if kpi_n == 0 else 72 // kpi_n
        for i, spec in enumerate(kpis[:kpi_n]):
            add_chart(spec, i * kpi_w, y, kpi_w, 10)
        if kpi_n:
            y += 12
        col = 0
        for i, spec in enumerate(plots):
            last = i == len(plots) - 1
            if len(plots) == 1 or (last and col == 0):
                w, x = 72, 0
            else:
                w, x = 36, col * 36
            add_chart(spec, x, y, w, 20)
            if w == 72 or col == 1:
                y += 22
                col = 0
            else:
                col = 1
        if col == 1:
            y += 22
        for spec in tables[:1]:
            add_chart(spec, 0, y, 72, 18)
        patch = {"ops": ops}
        return {
            "ok": True,
            "title": title,
            "patch": patch,
            "chartCount": len(kpis) + len(plots) + len(tables),
            "query": {"items": query_items} if query_items else None,
            "quality": state.last_review,
        }

    def compose_board(args: Dict[str, Any]) -> Any:
        body = {
            "message": args.get("message") or "",
            "datasetIds": args.get("datasetIds") or [],
            "dashboardId": args.get("dashboardId"),
            "styleId": args.get("styleId") or "feishu-blue",
            "mode": args.get("mode") or "replace",
        }
        return bi_call("POST", "/api/internal/bi/compose-board", body)

    def emit_patch(args: Dict[str, Any]) -> Any:
        mode = args.get("mode") or "replace"
        title = args.get("title") or "AI 生成看板"
        patch = _normalize_patch(args.get("patch") or args)
        dash = args.get("dashboardId") or linked_dashboard_id
        applied = bi_call(
            "POST",
            "/api/internal/bi/apply-patch",
            {"dashboardId": dash, "title": title, "mode": mode, "patch": patch},
        )
        state.applied = {"title": title, "mode": mode, "patch": patch, "result": applied}
        return {
            "ok": True,
            "dashboardId": applied.get("dashboardId"),
            "chartCount": len(applied.get("charts") or []),
            "charts": applied.get("charts") or [],
            "terminate": True,
        }

    def finish(args: Dict[str, Any]) -> Any:
        state.finished = {
            "reason": args.get("reason") or "done",
            "detail": args.get("detail"),
            "message": args.get("message"),
        }
        return {"ok": True, "finished": True, "terminate": True}

    return [
        AgentTool(
            name="od_list_datasets",
            description="List datasets (id, name, tableName). Prefer business tables; avoid de_* meta tables.",
            parameters={"type": "object", "properties": {}},
            execute=list_datasets,
        ),
        AgentTool(
            name="write_todos",
            description=(
                "DeerFlow-style planner. Create/update a task list for dashboard generation. "
                "Use for gen: profile data → pick charts from features → layout → emit. "
                "todos: [{content, status: pending|in_progress|completed}]. Keep one in_progress."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "todos": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "content": {"type": "string"},
                                "status": {"type": "string"},
                            },
                            "required": ["content"],
                        },
                    }
                },
                "required": ["todos"],
            },
            execute=write_todos,
        ),
        AgentTool(
            name="od_profile_dataset",
            description=(
                "Analyze dataset features for planning charts: field roles (dim/measure/time), "
                "whether live queries return rows, and a few probe encodes. Call this BEFORE composing a board."
            ),
            parameters={
                "type": "object",
                "properties": {"datasetId": {"type": "string"}},
                "required": ["datasetId"],
            },
            execute=profile_dataset,
        ),
        AgentTool(
            name="od_plan_charts",
            description=(
                "Plan charts from dataset probes (not a fixed KPI+bar+pie template). "
                "Returns {charts, query, rationale, quality}. query.items go to od_layout_board. "
                "Runs a deterministic quality gate (JoyAgent-style critic): no fake KPI compare, "
                "no pie duplicating a bar dim, no raw-timestamp line, table→grouptable. "
                "ONLY emit charts already in this result — never invent unprobed KPI/line/bar. "
                "If empty=true, do NOT emit a board. You may drop 1-2 charts if the user asked, "
                "but do not add encodes that were not probed live."
            ),
            parameters={
                "type": "object",
                "properties": {"datasetId": {"type": "string"}},
                "required": ["datasetId"],
            },
            execute=plan_charts,
        ),
        AgentTool(
            name="od_review_charts",
            description=(
                "JoyAgent-style critic: inspect planned charts and auto-repair quality issues. "
                "Call after od_plan_charts (or with charts). Does not block emit. "
                "od_layout_board also runs this gate so skipping the tool still gets repairs."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "charts": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "type": {"type": "string"},
                                "title": {"type": "string"},
                                "datasetId": {"type": "string"},
                                "encode": {"type": "object"},
                            },
                        },
                    },
                    "query": {"type": "object"},
                    "probes": {"type": "array"},
                },
            },
            execute=review_charts,
        ),
        AgentTool(
            name="od_get_schema",
            description="Get dataset fields (name, label, group, dataType).",
            parameters={
                "type": "object",
                "properties": {"datasetId": {"type": "string"}},
                "required": ["datasetId"],
            },
            execute=get_schema,
        ),
        AgentTool(
            name="od_run_query",
            description="Controlled chartQuery with inline encode. No raw SQL.",
            parameters={
                "type": "object",
                "properties": {
                    "datasetId": {"type": "string"},
                    "chartType": {"type": "string"},
                    "title": {"type": "string"},
                    "encode": {"type": "object"},
                },
                "required": ["datasetId", "chartType", "encode"],
            },
            execute=run_query,
        ),
        AgentTool(
            name="od_run_sql",
            description=(
                "SQLBot Ask-3: execute a SELECT generated from M-Schema. "
                "Only SELECT/WITH against the current dataset table. Never send SQL to the browser."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "datasetId": {"type": "string"},
                    "sql": {"type": "string"},
                    "title": {"type": "string"},
                    "chartType": {"type": "string"},
                    "encode": {"type": "object"},
                    "limit": {"type": "integer"},
                },
                "required": ["datasetId", "sql"],
            },
            execute=run_sql,
        ),
        AgentTool(
            name="od_get_board_summary",
            description="Summarize current draft for multi-turn append.",
            parameters={
                "type": "object",
                "properties": {"dashboardId": {"type": "string"}},
            },
            execute=board_summary,
        ),
        AgentTool(
            name="od_layout_board",
            description=(
                "Turn od_plan_charts output into a DashboardPatch: top query bar (type=query), "
                "KPI row, 2-column plots, full-width grouptable. Pass charts AND query from plan_charts. "
                "Re-runs the quality gate so LLM cannot skip repairs. Do not invent extra charts. Then od_emit_patch."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "styleId": {"type": "string"},
                    "charts": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "type": {"type": "string"},
                                "title": {"type": "string"},
                                "datasetId": {"type": "string"},
                                "encode": {"type": "object"},
                            },
                        },
                    },
                    "query": {
                        "type": "object",
                        "properties": {
                            "label": {"type": "string"},
                            "items": {"type": "array"},
                        },
                    },
                },
                "required": ["charts"],
            },
            execute=layout_board,
        ),
        AgentTool(
            name="od_compose_board",
            description=(
                "LAST-RESORT fallback only when od_profile_dataset and od_plan_charts both fail. "
                "Do NOT use for unconstrained dashboard generation — it is a mechanical template."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "message": {"type": "string"},
                    "datasetIds": {"type": "array", "items": {"type": "string"}},
                    "dashboardId": {"type": "string"},
                    "styleId": {"type": "string"},
                    "mode": {"type": "string"},
                },
                "required": ["message", "datasetIds"],
            },
            execute=compose_board,
        ),
        AgentTool(
            name="od_emit_patch",
            description="Apply DashboardPatch to Java draft. ONLY write path for dashboards.",
            parameters={
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "mode": {"type": "string"},
                    "dashboardId": {"type": "string"},
                    "patch": {"type": "object"},
                },
                "required": ["title", "mode", "patch"],
            },
            execute=emit_patch,
            execution_mode="sequential",
            terminate_on_success=True,
        ),
        AgentTool(
            name="od_finish",
            description="Finish the run. Call once at end.",
            parameters={
                "type": "object",
                "properties": {
                    "reason": {"type": "string"},
                    "detail": {"type": "string"},
                    "message": {"type": "string"},
                },
                "required": ["reason"],
            },
            execute=finish,
            terminate_on_success=True,
        ),
    ]


def _field_name(item: Any) -> str:
    if isinstance(item, dict):
        return str(item.get("name") or "")
    return str(item or "")


def _field_label(item: Any) -> str:
    if isinstance(item, dict):
        return str(item.get("label") or item.get("name") or "")
    return str(item or "")


def _is_status_like(item: Any) -> bool:
    blob = f"{_field_name(item)} {_field_label(item)}".lower()
    return any(k in blob for k in ("status", "状态", "type", "类型", "channel", "渠道"))


def _pick_measure(measures: List[Any]) -> Optional[Any]:
    for m in measures:
        blob = f"{_field_name(m)} {_field_label(m)}".lower()
        if any(k in blob for k in ("amount", "金额", "销售", "profit", "利润", "qty", "数量")) and "mchincome" not in blob:
            return m
    return measures[0] if measures else None


def _probe_live(probes: List[Any], kind: str, field: str) -> bool:
    hits = [
        p
        for p in probes
        if isinstance(p, dict)
        and str(p.get("kind") or "") == kind
        and str(p.get("field") or p.get("category") or "") == field
    ]
    if not hits:
        return False
    return any(not p.get("emptyValue") and int(p.get("rowCount") or 0) > 0 for p in hits)


def _probe_kpi_live(probes: List[Any], field: str) -> bool:
    hits = [
        p
        for p in probes
        if isinstance(p, dict)
        and str(p.get("kind") or "") in ("kpi", "count")
        and str(p.get("field") or "") == field
    ]
    if not hits:
        return False
    for p in hits:
        if int(p.get("rowCount") or 0) <= 0 or p.get("emptyValue"):
            continue
        if str(p.get("kind") or "") == "kpi" and p.get("kpiValue") is None:
            continue
        return True
    return False


_ISO_TS = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}")


def _chart_kind(spec: Any) -> str:
    return str((spec or {}).get("type") or "").lower()


def _encode_of(spec: Any) -> Dict[str, Any]:
    enc = (spec or {}).get("encode")
    return dict(enc) if isinstance(enc, dict) else {}


def _category_of(spec: Any) -> str:
    enc = _encode_of(spec)
    return str(enc.get("category") or enc.get("field") or "")


def _probe_for(probes: List[Any], kind: str, field: str) -> Optional[Dict[str, Any]]:
    if not field:
        return None
    for p in probes:
        if not isinstance(p, dict):
            continue
        if str(p.get("kind") or "") != kind:
            continue
        if str(p.get("field") or p.get("category") or "") == field:
            return p
    return None


def _sample_looks_iso(sample: Any) -> bool:
    vals: List[str] = []
    if isinstance(sample, list):
        for row in sample[:8]:
            if isinstance(row, list) and row:
                vals.append(str(row[0]))
            elif isinstance(row, dict):
                vals.append(str(row.get("category") or row.get("name") or row.get("x") or next(iter(row.values()), "")))
            else:
                vals.append(str(row))
    elif sample is not None:
        vals.append(str(sample))
    if not vals:
        return False
    hits = sum(1 for v in vals if _ISO_TS.search(v))
    return hits >= 1 and hits >= max(1, (len(vals) + 1) // 2)


def _line_too_granular(spec: Dict[str, Any], probes: List[Any]) -> bool:
    cat = _category_of(spec)
    p = _probe_for(probes, "line", cat)
    if p:
        if p.get("tooGranular"):
            return True
        if int(p.get("rowCount") or 0) > 24:
            return True
        if _sample_looks_iso(p.get("sample")):
            return True
    return _sample_looks_iso(spec.get("sample"))


def _pie_too_many_slices(spec: Dict[str, Any], probes: List[Any]) -> bool:
    cat = _category_of(spec)
    p = _probe_for(probes, "bar", cat) or _probe_for(probes, "pie", cat)
    if not p:
        return False
    card = int(p.get("cardinality") or p.get("rowCount") or 0)
    return card > 8


def _review_and_repair(charts: List[Any], query: Any, probes: List[Any]) -> Dict[str, Any]:
    """Deterministic critic (JoyAgent-style). Auto-fix, never block emit."""
    issues: List[str] = []
    fixes: List[str] = []
    rationale: List[str] = []
    out: List[Dict[str, Any]] = []
    bar_cats = {
        _category_of(c)
        for c in charts
        if isinstance(c, dict) and _chart_kind(c) == "bar" and _category_of(c)
    }
    seen_pie: set[str] = set()
    saw_table = False

    for raw in charts:
        if not isinstance(raw, dict):
            continue
        spec = dict(raw)
        kind = _chart_kind(spec)
        enc = _encode_of(spec)
        style = dict(spec["style"]) if isinstance(spec.get("style"), dict) else {}

        if kind == "kpi":
            calc = str(enc.get("calc") or "none").lower()
            if calc not in ("yoy", "mom"):
                if calc != "none" or style.get("showCompare") is not False:
                    issues.append("kpi_fake_compare")
                    fixes.append("kpi_disable_compare")
                    rationale.append("KPI 未指定同比/环比，关闭假对比避免 0.0%")
                enc["calc"] = "none"
                style["showCompare"] = False
            spec["encode"] = enc
            spec["style"] = style
            out.append(spec)
            continue

        if kind in ("table", "grouptable"):
            if saw_table:
                issues.append("duplicate_table")
                fixes.append("drop_extra_table")
                rationale.append("只保留一张汇总表垫底")
                continue
            saw_table = True
            if kind == "table":
                issues.append("detail_table")
                fixes.append("table_to_grouptable")
                rationale.append("明细表改汇总表，避免全列竖排表头")
                spec["type"] = "grouptable"
                title = str(spec.get("title") or "汇总")
                if "汇总" not in title:
                    spec["title"] = f"{title}汇总"
            spec["encode"] = enc
            out.append(spec)
            continue

        if kind in ("pie", "donut"):
            cat = _category_of(spec)
            if cat and cat in bar_cats:
                issues.append("duplicate_dim_pie")
                fixes.append("drop_pie_same_as_bar")
                rationale.append(f"饼图与柱图共用维度「{cat}」，去掉饼图")
                continue
            if cat and cat in seen_pie:
                issues.append("duplicate_pie")
                fixes.append("drop_duplicate_pie")
                continue
            if _pie_too_many_slices(spec, probes or []):
                issues.append("pie_high_cardinality")
                fixes.append("drop_pie_too_many_slices")
                rationale.append("饼图分类过多，去掉以免扇区不可读")
                continue
            if cat:
                seen_pie.add(cat)
            spec["encode"] = enc
            out.append(spec)
            continue

        if kind == "line":
            if _line_too_granular(spec, probes or []):
                issues.append("line_too_granular")
                fixes.append("drop_raw_timestamp_line")
                rationale.append("趋势轴是原始时间戳或点数过多，去掉折线避免轴标签重叠")
                continue
            spec["encode"] = enc
            out.append(spec)
            continue

        spec["encode"] = enc
        if style:
            spec["style"] = style
        out.append(spec)

    return {
        "charts": out,
        "query": query,
        "issues": issues,
        "fixes": fixes,
        "rationale": rationale,
    }


def _plan_charts_from_profile(dataset_id: str, profile: Dict[str, Any]) -> Dict[str, Any]:
    if not profile.get("ok"):
        return {"ok": False, "error": profile.get("error") or "profile failed"}

    name = str(profile.get("name") or dataset_id)
    measures = list(profile.get("measures") or [])
    dims = list(profile.get("dims") or [])
    times = list(profile.get("timeFields") or [])
    probes = list(profile.get("probes") or [])
    query_fields = list(profile.get("queryFields") or [])
    empty = bool(profile.get("empty"))
    hint = profile.get("hint")

    if empty:
        return {
            "ok": True,
            "empty": True,
            "title": name,
            "hint": hint or "探测查询无有效行，不要写空看板。",
            "charts": [],
            "query": {"items": []},
            "rationale": [f"数据集「{name}」无有效数据，跳过构图。请换有行的业务表。"],
        }

    charts: List[Dict[str, Any]] = []
    rationale: List[str] = []

    def kpi(title: str, value: str, agg: str, why: str) -> None:
        charts.append(
            {
                "type": "kpi",
                "title": title,
                "datasetId": dataset_id,
                "encode": {"datasetId": dataset_id, "value": value, "agg": agg, "calc": "none"},
                "style": {"showCompare": False, "showTitle": True},
            }
        )
        rationale.append(why)

    def plot(kind: str, title: str, category: str, value: str, agg: str, why: str) -> None:
        charts.append(
            {
                "type": kind,
                "title": title,
                "datasetId": dataset_id,
                "encode": {"datasetId": dataset_id, "category": category, "value": value, "agg": agg},
            }
        )
        rationale.append(why)

    count_key = _field_name(dims[0]) if dims else ""
    if count_key and _probe_kpi_live(probes, count_key):
        kpi("记录数", count_key, "COUNT", f"用 {_field_label(dims[0])} 计数看规模")

    for m in measures[:4]:
        if sum(1 for c in charts if c.get("type") == "kpi") >= 4:
            break
        mn, ml = _field_name(m), _field_label(m)
        if not mn:
            continue
        agg = "AVG" if any(k in f"{mn} {ml}".lower() for k in ("rate", "率")) else "SUM"
        if _probe_kpi_live(probes, mn):
            kpi(ml or mn, mn, agg, f"指标「{ml or mn}」做 KPI（{agg}）")

    best = next((m for m in measures if _probe_kpi_live(probes, _field_name(m))), None) or _pick_measure(measures)
    value = _field_name(best) if best else count_key
    value_label = _field_label(best) if best else "记录数"
    agg = "SUM" if best else "COUNT"
    if best and any(k in f"{_field_name(best)} {_field_label(best)}".lower() for k in ("rate", "率")):
        agg = "AVG"

    used_dims: set[str] = set()
    if value and dims:
        d0 = dims[0]
        d0n, d0l = _field_name(d0), _field_label(d0)
        if d0n and _probe_live(probes, "bar", d0n):
            plot("bar", f"{d0l} · {value_label}", d0n, value, agg, f"「{d0l}」基数适合对比，配 {value_label}")
            used_dims.add(d0n)
        pie_src = next((d for d in dims if _is_status_like(d)), dims[1] if len(dims) > 1 else None)
        if pie_src is not None:
            pn, pl = _field_name(pie_src), _field_label(pie_src)
            if pn and pn not in used_dims and _probe_live(probes, "bar", pn):
                plot("pie", f"{pl} 构成", pn, value, agg, f"「{pl}」是另一类别字段，用饼图看构成")
                used_dims.add(pn)
        for extra in dims[1:]:
            if len([c for c in charts if c.get("type") not in ("kpi", "table", "grouptable")]) >= 4:
                break
            en, el = _field_name(extra), _field_label(extra)
            if not en or en in used_dims:
                continue
            if not _probe_live(probes, "bar", en):
                continue
            plot("bar", f"{el} · {value_label}", en, value, agg, f"补充对比「{el}」")
            used_dims.add(en)

    lined = False
    if value and times:
        for t0 in times:
            tn, tl = _field_name(t0), _field_label(t0)
            if tn and _probe_live(probes, "line", tn):
                plot("line", f"{tl}走势 · {value_label}", tn, value, agg, f"有时间字段「{tl}」且探测有行，做趋势")
                lined = True
                break
    if not lined and value and len(dims) > 2:
        for extra in dims:
            en, el = _field_name(extra), _field_label(extra)
            if not en or en in used_dims:
                continue
            if not _probe_live(probes, "bar", en):
                continue
            plot("bar", f"{el} · {value_label}", en, value, agg, f"无可用趋势，用「{el}」补对比")
            break

    if value and dims:
        d0 = dims[0]
        d0n, d0l = _field_name(d0), _field_label(d0)
        if d0n and (_probe_live(probes, "bar", d0n) or d0n in used_dims):
            plot("grouptable", f"{d0l}汇总", d0n, value, agg, f"汇总表垫底，避免明细全列")

    query_items: List[Dict[str, Any]] = []
    for qf in query_fields[:3]:
        kind = str(qf.get("kind") or "select") if isinstance(qf, dict) else "select"
        fn = _field_name(qf)
        fl = _field_label(qf)
        if not fn:
            continue
        query_items.append(
            {
                "kind": "dateRange" if kind in ("date", "dateRange") else "select",
                "field": fn,
                "label": fl,
                "scope": "all",
                "targetChartIds": [],
            }
        )

    if not charts:
        return {
            "ok": True,
            "empty": True,
            "title": name,
            "hint": hint or "字段角色不足，无法规划图表",
            "charts": [],
            "query": {"items": query_items},
            "rationale": [f"「{name}」缺少可用维度/指标，无法按特征构图。"],
        }

    return {
        "ok": True,
        "empty": False,
        "title": f"{name}分析",
        "charts": charts[:10],
        "query": {"label": "查询条件", "items": query_items},
        "rationale": rationale[:10],
        "features": {
            "dims": [_field_label(d) for d in dims[:6]],
            "measures": [_field_label(m) for m in measures[:6]],
            "timeFields": [_field_label(t) for t in times[:3]],
            "liveRowHint": profile.get("liveRowHint"),
        },
    }


def _normalize_patch(patch: Any) -> Dict[str, Any]:
    if isinstance(patch, str):
        try:
            patch = json.loads(patch)
        except json.JSONDecodeError:
            return {"ops": []}
    if not isinstance(patch, dict):
        return {"ops": []}
    ops = patch.get("ops")
    if not isinstance(ops, list) and isinstance(patch.get("patch"), dict):
        return _normalize_patch(patch.get("patch"))
    if not isinstance(ops, list):
        return {"ops": []}
    return patch


def dumps_result(obj: Any) -> str:
    try:
        return json.dumps(obj, ensure_ascii=False, default=str)
    except Exception:
        return json.dumps({"raw": str(obj)}, ensure_ascii=False)
