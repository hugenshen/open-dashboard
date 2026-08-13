"""Open Dashboard AI harness — DeerFlow-style Lead Agent over Java BI APIs.

Java is zero-AI. This process owns Lead + LLM tool loop (or deterministic fallback).
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Generator, Iterable, List, Optional

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

from lead_agent import run_lead
from llm_client import llm_configured, llm_settings

BI_BASE = os.environ.get("OD_BI_BASE", "http://127.0.0.1:8080").rstrip("/")
INTERNAL_TOKEN = os.environ.get("OD_INTERNAL_TOKEN", "od-dev-internal")
HARNESS_PORT = int(os.environ.get("OD_HARNESS_PORT", "8091"))
# lead | deterministic | auto (lead if LLM key present)
HARNESS_MODE = (os.environ.get("OD_HARNESS_MODE") or "auto").strip().lower()

app = FastAPI(title="opendashboard-harness", version="0.2.0")


def _bi(method: str, path: str, body: Any = None) -> Any:
    url = f"{BI_BASE}{path}"
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-OD-Internal-Token": INTERNAL_TOKEN,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"BI {method} {path} -> {e.code}: {err}") from e
    except Exception as e:
        raise RuntimeError(f"BI {method} {path} failed: {e}") from e


def sse(event: str, data: Dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def step(name: str, detail: str) -> str:
    return sse("step", {"id": name, "label": detail, "name": name, "detail": detail})


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
    if linked and re.search(r"(加|多来|再来|追加|跳转|联动)", q):
        return "append"
    if linked:
        return "append"
    return "replace"


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


def use_lead() -> bool:
    if HARNESS_MODE == "deterministic":
        return False
    if HARNESS_MODE == "lead":
        return True
    return llm_configured()


def run_agent(payload: Dict[str, Any]) -> Generator[str, None, None]:
    if use_lead():
        try:
            yield from run_lead(payload, _bi)
            return
        except RuntimeError as e:
            if "LLM_NOT_CONFIGURED" in str(e):
                yield step("fallback", "LLM 未配置，降级确定性工具环")
            else:
                yield sse("error", {"code": "LEAD", "message": str(e)})
                yield step("fallback", "Lead 失败，降级确定性工具环")
        except Exception as e:
            yield sse("error", {"code": "LEAD", "message": str(e)})
            yield step("fallback", "Lead 异常，降级确定性工具环")

    yield from run_deterministic(payload)


def run_deterministic(payload: Dict[str, Any]) -> Generator[str, None, None]:
    message = payload.get("message") or ""
    intent = resolve_intent(payload.get("intent"), message)
    dataset_ids: List[str] = [str(x) for x in (payload.get("datasetIds") or [])]
    linked = payload.get("linkedDashboardId") or None
    style_id = payload.get("styleId") or "feishu-blue"
    mode = (payload.get("mode") or "auto").lower()

    yield step("context", "确定性工具环（无 Lead/LLM）")
    yield step("intent", f"意图: {intent}")

    if not dataset_ids:
        try:
            listed = _bi("GET", "/api/internal/bi/datasets") or []
            dataset_ids = [str(d["id"]) for d in listed[:3] if d.get("id")]
        except Exception as e:
            yield sse("error", {"code": "BI_DATASETS", "message": str(e)})
            yield sse("finish", {"reason": "error", "detail": "datasets"})
            return

    yield step("schema", f"绑定数据集 {len(dataset_ids)} 个")

    if intent in ("ask", "insight"):
        yield from _run_ask(message, intent, dataset_ids)
        return

    yield from _run_gen(message, dataset_ids, linked, style_id, mode)


def _run_ask(message: str, intent: str, dataset_ids: List[str]) -> Generator[str, None, None]:
    ds_id = dataset_ids[0]
    try:
        schema = _bi("GET", f"/api/internal/bi/datasets/{urllib.parse.quote(ds_id)}/schema")
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

    encode = {
        "datasetId": ds_id,
        "x": [{"field": dim}],
        "y": [{"field": measure, "agg": "SUM"}],
    }
    # Prefer category/value for OD query engine
    encode = {"datasetId": ds_id, "category": dim, "value": measure, "agg": "SUM"}
    inline = {
        "datasetId": ds_id,
        "chartType": "bar" if intent == "ask" else "line",
        "title": f"{measure} by {dim}",
        "encode": encode,
    }
    yield step("query", f"受控 chartQuery: {dim} × {measure}")
    try:
        result = _bi(
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
) -> Generator[str, None, None]:
    mode = patch_mode(message, linked)
    if linked:
        try:
            summary = _bi(
                "GET",
                f"/api/internal/bi/board-summary?dashboardId={urllib.parse.quote(str(linked))}",
            )
            n = len(summary.get("charts") or [])
            yield step("board", f"当前看板摘要：{n} 个图表（mode={mode}）")
        except Exception:
            yield step("board", "无可用看板摘要，按新建处理")

    yield step("compose", "调用平台 compose-board（确定性构图）")
    try:
        composed = _bi(
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
    title = composed.get("title") or "AI 生成看板"
    plan = {
        "title": title,
        "mode": mode,
        "opsCount": len(patch.get("ops") or []),
        "message": message,
        "via": "deterministic",
    }
    if run_mode == "plan":
        yield sse("plan", plan)
        yield sse("finish", {"reason": "awaiting_confirm", "detail": "等待确认计划"})
        return

    yield sse("plan", plan)
    yield step("apply", f"emit_patch mode={mode}")
    try:
        applied = _bi(
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

    dash_id = applied.get("dashboardId")
    charts = applied.get("charts") or []
    yield sse("patch", {"dashboardId": dash_id, "mode": mode, "ops": patch.get("ops") or []})

    empty_n = 0
    for c in charts:
        row_count = int(c.get("rowCount") or 0)
        kpi = c.get("kpiValue")
        chart_empty = row_count == 0
        if str(c.get("chartType")) == "kpi" and kpi is None:
            chart_empty = True
        if chart_empty:
            empty_n += 1
            c = {**c, "rowCount": 0}
        yield sse("chart_ready", c)

    all_empty = bool(charts) and empty_n == len(charts)
    yield sse(
        "board_ready",
        {
            "dashboardId": dash_id,
            "title": title,
            "chartCount": len(charts),
            "emptyPreview": all_empty,
            "mode": mode,
        },
    )

    if not charts:
        hint = f"已生成看板草稿 #{dash_id}"
    elif all_empty:
        hint = (
            f"已生成「{title}」草稿 #{dash_id}，但预览无有效数据"
            "（表可能为空或聚合为 null）。请换有数据的业务数据集，或检查源表。"
        )
    else:
        hint = f"已生成「{title}」看板草稿 #{dash_id}，含 {len(charts)} 个组件（{mode}）。"
    yield sse("message_delta", {"text": hint})
    yield sse("finish", {"reason": "done", "detail": f"applied:{dash_id}", "dashboardId": dash_id})


@app.get("/health")
def health() -> Dict[str, Any]:
    bi_ok = False
    try:
        _bi("GET", "/api/internal/bi/health")
        bi_ok = True
    except Exception:
        bi_ok = False
    cfg = llm_settings()
    return {
        "ok": True,
        "role": "opendashboard-harness",
        "bi": bi_ok,
        "biBase": BI_BASE,
        "mode": HARNESS_MODE,
        "lead": use_lead(),
        "llm": {
            "configured": llm_configured(),
            "baseUrl": cfg["base_url"],
            "model": cfg["model"],
        },
    }


@app.post("/v1/runs")
async def runs(
    request: Request,
    x_od_internal_token: Optional[str] = Header(default=None, alias="X-OD-Internal-Token"),
):
    if INTERNAL_TOKEN and x_od_internal_token != INTERNAL_TOKEN:
        raise HTTPException(status_code=401, detail="bad internal token")
    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="empty body")
    try:
        payload = json.loads(body.decode("utf-8"))
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"invalid json: {e}") from e

    def gen() -> Iterable[str]:
        yield sse(
            "run",
            {
                "runId": payload.get("runId"),
                "conversationId": payload.get("conversationId"),
                "lead": use_lead(),
            },
        )
        try:
            yield from run_agent(payload)
        except Exception as e:
            yield sse("error", {"code": "HARNESS", "message": str(e)})
            yield sse("finish", {"reason": "error", "detail": "exception"})

    return StreamingResponse(gen(), media_type="text/event-stream")


@app.get("/")
def root() -> JSONResponse:
    return JSONResponse({"service": "opendashboard-harness", "docs": "/docs", "version": "0.2.0"})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=HARNESS_PORT, reload=False)
