"""OD BI tools for Lead Agent (call Java /api/internal/bi/*)."""

from __future__ import annotations

import json
import urllib.parse
from typing import Any, Callable, Dict, List, Optional


TOOL_SPECS: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "od_list_datasets",
            "description": "List available datasets (id, name, tableName). Prefer business tables; avoid de_* meta/studio tables unless user asks.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "od_get_schema",
            "description": "Get dataset fields (name, label, group, dataType).",
            "parameters": {
                "type": "object",
                "properties": {"datasetId": {"type": "string"}},
                "required": ["datasetId"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "od_run_query",
            "description": "Run controlled chartQuery with inline encode. Do not invent SQL.",
            "parameters": {
                "type": "object",
                "properties": {
                    "datasetId": {"type": "string"},
                    "chartType": {"type": "string", "enum": ["bar", "line", "pie", "kpi", "table"]},
                    "title": {"type": "string"},
                    "encode": {"type": "object"},
                },
                "required": ["datasetId", "chartType", "encode"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "od_get_board_summary",
            "description": "Summarize current draft dashboard charts/components for multi-turn append.",
            "parameters": {
                "type": "object",
                "properties": {"dashboardId": {"type": "string"}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "od_compose_board",
            "description": "Optional platform helper that drafts a DashboardPatch from schema (deterministic). Prefer crafting your own patch after reading schema when you can choose better fields/titles.",
            "parameters": {
                "type": "object",
                "properties": {
                    "message": {"type": "string"},
                    "datasetIds": {"type": "array", "items": {"type": "string"}},
                    "dashboardId": {"type": "string"},
                    "styleId": {"type": "string"},
                    "mode": {"type": "string", "enum": ["append", "replace"]},
                },
                "required": ["message", "datasetIds"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "od_emit_patch",
            "description": "Apply DashboardPatch to Java draft. This is the ONLY way to write a dashboard. mode=append for multi-turn add charts; replace for full rebuild.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "mode": {"type": "string", "enum": ["append", "replace"]},
                    "dashboardId": {"type": "string"},
                    "patch": {
                        "type": "object",
                        "description": "DashboardPatch: {dashboardId?, ops:[{op, ...}]}",
                    },
                },
                "required": ["title", "mode", "patch"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "od_finish",
            "description": "Finish the run after answers or board write. Call exactly once at the end.",
            "parameters": {
                "type": "object",
                "properties": {
                    "reason": {
                        "type": "string",
                        "enum": ["done", "answered", "awaiting_confirm", "error"],
                    },
                    "detail": {"type": "string"},
                    "message": {"type": "string", "description": "User-facing summary text"},
                },
                "required": ["reason"],
            },
        },
    },
]


def make_tool_executor(bi: Callable[..., Any], linked_dashboard_id: Optional[str]) -> Callable[[str, Dict[str, Any]], Any]:
    state: Dict[str, Any] = {
        "applied": None,
        "answers": [],
        "finished": None,
    }

    def exec_tool(name: str, args: Dict[str, Any]) -> Any:
        if name == "od_list_datasets":
            return bi("GET", "/api/internal/bi/datasets")

        if name == "od_get_schema":
            ds = args.get("datasetId") or ""
            return bi("GET", f"/api/internal/bi/datasets/{urllib.parse.quote(str(ds))}/schema")

        if name == "od_run_query":
            ds = args.get("datasetId")
            chart_type = args.get("chartType") or "bar"
            title = args.get("title") or "query"
            encode = args.get("encode") or {}
            inline = {
                "datasetId": ds,
                "chartType": chart_type,
                "title": title,
                "encode": encode,
            }
            result = bi(
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
            state["answers"].append(answer)
            return {"ok": True, "rowCount": len(data), "sample": data[:5], "fields": result.get("fields")}

        if name == "od_get_board_summary":
            dash = args.get("dashboardId") or linked_dashboard_id
            if not dash:
                return {"dashboardId": None, "charts": [], "components": []}
            return bi(
                "GET",
                f"/api/internal/bi/board-summary?dashboardId={urllib.parse.quote(str(dash))}",
            )

        if name == "od_compose_board":
            body = {
                "message": args.get("message") or "",
                "datasetIds": args.get("datasetIds") or [],
                "dashboardId": args.get("dashboardId"),
                "styleId": args.get("styleId") or "feishu-blue",
                "mode": args.get("mode") or "replace",
            }
            return bi("POST", "/api/internal/bi/compose-board", body)

        if name == "od_emit_patch":
            mode = args.get("mode") or "replace"
            title = args.get("title") or "AI 生成看板"
            patch = args.get("patch") or {}
            dash = args.get("dashboardId") or linked_dashboard_id
            applied = bi(
                "POST",
                "/api/internal/bi/apply-patch",
                {
                    "dashboardId": dash,
                    "title": title,
                    "mode": mode,
                    "patch": patch,
                },
            )
            state["applied"] = {"title": title, "mode": mode, "patch": patch, "result": applied}
            return {
                "ok": True,
                "dashboardId": applied.get("dashboardId"),
                "chartCount": len(applied.get("charts") or []),
                "charts": applied.get("charts") or [],
            }

        if name == "od_finish":
            state["finished"] = {
                "reason": args.get("reason") or "done",
                "detail": args.get("detail"),
                "message": args.get("message"),
            }
            return {"ok": True, "finished": True}

        return {"ok": False, "error": f"unknown tool {name}"}

    exec_tool.state = state  # type: ignore[attr-defined]
    return exec_tool


def dumps_tool_result(obj: Any) -> str:
    try:
        return json.dumps(obj, ensure_ascii=False, default=str)
    except Exception:
        return json.dumps({"raw": str(obj)}, ensure_ascii=False)
