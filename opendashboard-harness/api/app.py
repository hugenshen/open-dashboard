"""FastAPI: health + /v1/conversations* + legacy /v1/runs."""

from __future__ import annotations

import json
import os
from typing import Any, Dict, Iterable, List, Optional

from env_loader import load_dotenv

_loaded_env = load_dotenv()

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel

from agent import session_store
from agent.runtime import harness_mode, run_agent, run_confirm_plan, use_lead
from agent.types import sse
from llm_client import llm_configured, llm_settings
from tools.od_bi import bi_base, bi_health

app = FastAPI(title="opendashboard-harness", version="0.3.0")

STYLES = [
    {
        "id": "feishu-blue",
        "name": "默认飞书蓝",
        "description": "与产品顶栏一致的清晰商务风",
        "tokens": {"accent": "#3370ff", "bg": "#f5f6f8", "density": "comfortable"},
    },
    {
        "id": "ops-daily",
        "name": "经营日报",
        "description": "KPI 突出、信息密度中等",
        "tokens": {"accent": "#1f6feb", "bg": "#f7f8fa", "density": "compact"},
    },
    {
        "id": "finance-minimal",
        "name": "财务极简",
        "description": "留白多、字重克制",
        "tokens": {"accent": "#0f766e", "bg": "#fafafa", "density": "airy"},
    },
    {
        "id": "monitor-dark",
        "name": "监控深色",
        "description": "深底高对比，适合值班墙",
        "tokens": {"accent": "#38bdf8", "bg": "#0f172a", "density": "compact", "theme": "dark"},
    },
    {
        "id": "report-clean",
        "name": "汇报清爽",
        "description": "浅底、适合截图发群",
        "tokens": {"accent": "#2563eb", "bg": "#ffffff", "density": "comfortable"},
    },
]


class CreateConversationBody(BaseModel):
    title: Optional[str] = None
    datasetIds: Optional[List[str]] = None
    linkedDashboardId: Optional[str] = None


class UpdateConversationBody(BaseModel):
    title: Optional[str] = None
    layoutPrefs: Optional[Dict[str, Any]] = None
    datasetIds: Optional[List[str]] = None
    linkedDashboardId: Optional[str] = None


class RunBody(BaseModel):
    message: str
    intent: Optional[str] = None
    mode: Optional[str] = "auto"
    styleId: Optional[str] = "feishu-blue"
    datasetIds: Optional[List[str]] = None
    selectedChartId: Optional[str] = None
    selectedEncode: Optional[Dict[str, Any]] = None


def _owner(x_user_id: Optional[str]) -> str:
    return (x_user_id or "demo").strip() or "demo"


@app.get("/health")
def health() -> Dict[str, Any]:
    cfg = llm_settings()
    return {
        "ok": True,
        "role": "opendashboard-harness",
        "bi": bi_health(),
        "biBase": bi_base(),
        "mode": harness_mode(),
        "lead": use_lead(),
        "envFile": str(_loaded_env) if _loaded_env else None,
        "llm": {
            "configured": llm_configured(),
            "baseUrl": cfg["base_url"],
            "model": cfg["model"],
        },
    }


@app.get("/")
def root() -> JSONResponse:
    return JSONResponse({"service": "opendashboard-harness", "docs": "/docs", "version": "0.3.0"})


@app.get("/v1/conversations/feature")
def feature() -> Dict[str, Any]:
    return {"enabled": True}


@app.get("/v1/conversations/styles")
def styles() -> List[Dict[str, Any]]:
    return STYLES


@app.get("/v1/conversations")
def list_conversations(x_user_id: Optional[str] = Header(default=None, alias="X-User-Id")):
    return session_store.list_conversations(_owner(x_user_id))


@app.post("/v1/conversations")
def create_conversation(
    body: Optional[CreateConversationBody] = None,
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
):
    body = body or CreateConversationBody()
    return session_store.create_conversation(
        owner_id=_owner(x_user_id),
        title=body.title,
        dataset_ids=body.datasetIds,
        linked_dashboard_id=body.linkedDashboardId,
    )


@app.get("/v1/conversations/{cid}")
def get_conversation(cid: str):
    doc = session_store.get_conversation(cid)
    if not doc:
        raise HTTPException(status_code=404, detail="conversation not found")
    return doc


@app.patch("/v1/conversations/{cid}")
def patch_conversation(cid: str, body: UpdateConversationBody):
    patch = body.model_dump(exclude_none=True)
    mapped = {
        "title": patch.get("title"),
        "layoutPrefs": patch.get("layoutPrefs"),
        "datasetIds": patch.get("datasetIds"),
        "linkedDashboardId": patch.get("linkedDashboardId"),
    }
    mapped = {k: v for k, v in mapped.items() if v is not None}
    doc = session_store.update_conversation(cid, mapped)
    if not doc:
        raise HTTPException(status_code=404, detail="conversation not found")
    return doc


@app.delete("/v1/conversations/{cid}")
def delete_conversation(cid: str):
    if not session_store.delete_conversation(cid):
        raise HTTPException(status_code=404, detail="conversation not found")
    return Response(status_code=204)


@app.post("/v1/conversations/{cid}/ensure")
def ensure_conversation(
    cid: str,
    body: Optional[CreateConversationBody] = None,
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
):
    """Register a Java conversation id in the harness session store."""
    body = body or CreateConversationBody()
    try:
        return session_store.ensure_conversation(
            cid,
            owner_id=_owner(x_user_id),
            title=body.title,
            dataset_ids=body.datasetIds,
            linked_dashboard_id=body.linkedDashboardId,
        )
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid conversation id")


@app.get("/v1/conversations/{cid}/messages")
def messages(cid: str):
    if not session_store.get_conversation(cid):
        raise HTTPException(status_code=404, detail="conversation not found")
    return session_store.list_messages(cid)


@app.get("/v1/conversations/{cid}/revisions")
def revisions(cid: str):
    if not session_store.get_conversation(cid):
        raise HTTPException(status_code=404, detail="conversation not found")
    return []


@app.post("/v1/conversations/{cid}/runs/{run_id}/cancel")
def cancel_run(cid: str, run_id: str):
    session_store.finish_run(cid, run_id, "cancelled")
    return {"ok": True}


def _build_run_payload(
    cid: str,
    run_id: str,
    body: RunBody,
    conv: Dict[str, Any],
) -> Dict[str, Any]:
    dataset_ids = body.datasetIds if body.datasetIds is not None else (conv.get("datasetIds") or [])
    hist = [
        {"role": m.get("role"), "content": m.get("content")}
        for m in session_store.list_messages(cid)
        if m.get("role") in ("user", "assistant")
    ]
    return {
        "conversationId": cid,
        "runId": run_id,
        "message": body.message,
        "intent": body.intent,
        "mode": body.mode or "auto",
        "styleId": body.styleId or "feishu-blue",
        "datasetIds": dataset_ids,
        "linkedDashboardId": conv.get("linkedDashboardId"),
        "selectedChartId": body.selectedChartId,
        "selectedEncode": body.selectedEncode,
        "history": hist[:-1] if hist and hist[-1].get("role") == "user" else hist,
    }


@app.post("/v1/conversations/{cid}/runs")
async def conversation_runs(
    cid: str,
    body: RunBody,
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
):
    conv = session_store.get_conversation(cid)
    if not conv:
        try:
            conv = session_store.ensure_conversation(
                cid,
                owner_id=_owner(x_user_id),
                title=(body.message or "新对话")[:40],
                dataset_ids=body.datasetIds,
            )
        except ValueError:
            raise HTTPException(status_code=400, detail="invalid conversation id")

    if body.datasetIds is not None:
        session_store.update_conversation(cid, {"datasetIds": body.datasetIds})
        conv = session_store.get_conversation(cid) or conv

    session_store.append_message(cid, "user", body.message, [])
    run = session_store.create_run(cid, mode=body.mode or "auto", style_id=body.styleId or "feishu-blue")
    if not run:
        raise HTTPException(status_code=500, detail="failed to create run")

    payload = _build_run_payload(cid, run["id"], body, conv)

    def gen() -> Iterable[str]:
        yield sse(
            "run",
            {
                "runId": run["id"],
                "conversationId": cid,
                "lead": use_lead(),
            },
        )
        finish_reason = "error"
        finish_detail = None
        try:
            for chunk in run_agent(payload):
                if chunk.startswith("event: finish"):
                    try:
                        data_line = chunk.split("data:", 1)[1].strip().split("\n")[0]
                        data = json.loads(data_line)
                        finish_reason = str(data.get("reason") or "done")
                        finish_detail = data.get("detail")
                        if data.get("dashboardId"):
                            session_store.link_dashboard(cid, str(data["dashboardId"]))
                    except Exception:
                        pass
                if chunk.startswith("event: board_ready"):
                    try:
                        data_line = chunk.split("data:", 1)[1].strip().split("\n")[0]
                        data = json.loads(data_line)
                        if data.get("dashboardId"):
                            session_store.link_dashboard(cid, str(data["dashboardId"]))
                    except Exception:
                        pass
                if chunk.startswith("event: message_delta"):
                    try:
                        data_line = chunk.split("data:", 1)[1].strip().split("\n")[0]
                        data = json.loads(data_line)
                        if data.get("text"):
                            session_store.append_message(cid, "assistant", str(data["text"]), [])
                    except Exception:
                        pass
                yield chunk
        except Exception as e:
            yield sse("error", {"code": "HARNESS", "message": str(e)})
            yield sse("finish", {"reason": "error", "detail": "exception"})
            finish_reason = "error"
            finish_detail = "exception"
        status = finish_reason if finish_reason in ("done", "answered", "awaiting_confirm", "error") else "done"
        session_store.finish_run(cid, run["id"], status, str(finish_detail) if finish_detail else None)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/v1/conversations/{cid}/runs/{run_id}/confirm-plan")
async def confirm_plan(cid: str, run_id: str):
    conv = session_store.get_conversation(cid)
    if not conv:
        raise HTTPException(status_code=404, detail="conversation not found")
    pending = session_store.get_run_pending(cid, run_id)
    if not pending:
        raise HTTPException(status_code=400, detail="no pending plan to confirm")

    def gen() -> Iterable[str]:
        finish_reason = "error"
        finish_detail = None
        try:
            for chunk in run_confirm_plan(pending):
                if chunk.startswith("event: finish"):
                    try:
                        data_line = chunk.split("data:", 1)[1].strip().split("\n")[0]
                        data = json.loads(data_line)
                        finish_reason = str(data.get("reason") or "done")
                        finish_detail = data.get("detail")
                        if data.get("dashboardId"):
                            session_store.link_dashboard(cid, str(data["dashboardId"]))
                    except Exception:
                        pass
                if chunk.startswith("event: board_ready"):
                    try:
                        data_line = chunk.split("data:", 1)[1].strip().split("\n")[0]
                        data = json.loads(data_line)
                        if data.get("dashboardId"):
                            session_store.link_dashboard(cid, str(data["dashboardId"]))
                    except Exception:
                        pass
                if chunk.startswith("event: message_delta"):
                    try:
                        data_line = chunk.split("data:", 1)[1].strip().split("\n")[0]
                        data = json.loads(data_line)
                        if data.get("text"):
                            session_store.append_message(cid, "assistant", str(data["text"]), [])
                    except Exception:
                        pass
                yield chunk
        except Exception as e:
            yield sse("error", {"code": "HARNESS", "message": str(e)})
            yield sse("finish", {"reason": "error", "detail": "exception"})
            finish_reason = "error"
            finish_detail = "exception"
        status = finish_reason if finish_reason in ("done", "answered", "awaiting_confirm", "error") else "done"
        if finish_reason == "done":
            session_store.clear_run_pending(cid, run_id)
        session_store.finish_run(cid, run_id, status, str(finish_detail) if finish_detail else None)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/v1/conversations/{cid}/runs/{run_id}/adopt")
async def adopt(cid: str, run_id: str):
    raise HTTPException(status_code=501, detail="adopt not needed when emit_patch already applied draft")


@app.post("/v1/runs")
async def legacy_runs(
    request: Request,
    x_od_internal_token: Optional[str] = Header(default=None, alias="X-OD-Internal-Token"),
):
    """Deprecated: Java proxy path. Prefer POST /v1/conversations/{id}/runs."""
    token = os.environ.get("OD_INTERNAL_TOKEN") or "od-dev-internal"
    if token and x_od_internal_token != token:
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
                "deprecated": True,
            },
        )
        try:
            yield from run_agent(payload)
        except Exception as e:
            yield sse("error", {"code": "HARNESS", "message": str(e)})
            yield sse("finish", {"reason": "error", "detail": "exception"})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def create_app() -> FastAPI:
    return app
