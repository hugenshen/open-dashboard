"""FastAPI: health + /v1/conversations* + legacy /v1/runs."""

from __future__ import annotations

import json
import os
from typing import Any, Dict, Iterable, List, Optional

from env_loader import load_dotenv

_loaded_env = load_dotenv()

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, model_validator

from agent import session_store
from agent.context_builder import build_run_payload as build_runtime_payload
from agent.event_stream import EventStreamRecorder
from agent.knowledge import load as load_knowledge
from agent.knowledge import save as save_knowledge
from agent.run_controller import RunController
from agent.trace_store import get_run_trace
from agent.runtime import harness_mode, run_adopt, run_agent, run_confirm_plan, use_lead
from agent.types import sse
from agent.user_context import has_permission, set_principal, set_workspace
from agent.memory_runtime import memory_status
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
    userId: Optional[str] = None
    ownerId: Optional[str] = None

    @model_validator(mode="after")
    def reject_client_user_id(self):
        if self.userId or self.ownerId:
            raise ValueError("client metadata cannot declare user_id")
        return self


class UpdateConversationBody(BaseModel):
    title: Optional[str] = None
    layoutPrefs: Optional[Dict[str, Any]] = None
    datasetIds: Optional[List[str]] = None
    linkedDashboardId: Optional[str] = None
    userId: Optional[str] = None
    ownerId: Optional[str] = None

    @model_validator(mode="after")
    def reject_client_user_id(self):
        if self.userId or self.ownerId:
            raise ValueError("client metadata cannot declare user_id")
        return self


class RunBody(BaseModel):
    message: str
    intent: Optional[str] = None
    mode: Optional[str] = "auto"
    styleId: Optional[str] = "feishu-blue"
    datasetIds: Optional[List[str]] = None
    selectedChartId: Optional[str] = None
    selectedEncode: Optional[Dict[str, Any]] = None
    userId: Optional[str] = None
    ownerId: Optional[str] = None

    @model_validator(mode="after")
    def reject_client_user_id(self):
        if self.userId or self.ownerId:
            raise ValueError("client metadata cannot declare user_id")
        return self


class AdoptBody(BaseModel):
    action: Optional[str] = "save"
    styleId: Optional[str] = None


def _bind_principal(x_user_id: Optional[str], x_user_perms: Optional[str] = None) -> str:
    try:
        return set_principal(x_user_id, x_user_perms)
    except PermissionError:
        raise HTTPException(status_code=401, detail="principal required")


def _owner(x_user_id: Optional[str], x_user_perms: Optional[str] = None) -> str:
    return _bind_principal(x_user_id, x_user_perms)


def _workspace(x_workspace_id: Optional[str] = None) -> str:
    try:
        return set_workspace(x_workspace_id)
    except PermissionError:
        raise HTTPException(status_code=400, detail="invalid workspace id")


def _permission_list(raw: Optional[str]) -> List[str]:
    return [part.strip() for part in (raw or "").split(",") if part.strip()]


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
def list_conversations(
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    x_user_perms: Optional[str] = Header(default=None, alias="X-User-Perms"),
    x_workspace_id: Optional[str] = Header(default=None, alias="X-Workspace-Id"),
):
    return session_store.list_conversations(_owner(x_user_id, x_user_perms), workspace_id=_workspace(x_workspace_id))


@app.post("/v1/conversations")
def create_conversation(
    body: Optional[CreateConversationBody] = None,
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    x_user_perms: Optional[str] = Header(default=None, alias="X-User-Perms"),
    x_workspace_id: Optional[str] = Header(default=None, alias="X-Workspace-Id"),
):
    body = body or CreateConversationBody()
    return session_store.create_conversation(
        owner_id=_owner(x_user_id, x_user_perms),
        workspace_id=_workspace(x_workspace_id),
        title=body.title,
        dataset_ids=body.datasetIds,
        linked_dashboard_id=body.linkedDashboardId,
    )


@app.get("/v1/conversations/{cid}")
def get_conversation(
    cid: str,
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    x_user_perms: Optional[str] = Header(default=None, alias="X-User-Perms"),
    x_workspace_id: Optional[str] = Header(default=None, alias="X-Workspace-Id"),
):
    owner = _owner(x_user_id, x_user_perms)
    doc = session_store.get_conversation(cid, owner_id=owner, workspace_id=_workspace(x_workspace_id))
    if not doc:
        raise HTTPException(status_code=404, detail="conversation not found")
    return doc


@app.patch("/v1/conversations/{cid}")
def patch_conversation(
    cid: str,
    body: UpdateConversationBody,
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    x_user_perms: Optional[str] = Header(default=None, alias="X-User-Perms"),
    x_workspace_id: Optional[str] = Header(default=None, alias="X-Workspace-Id"),
):
    owner = _owner(x_user_id, x_user_perms)
    if not session_store.get_conversation(cid, owner_id=owner, workspace_id=_workspace(x_workspace_id)):
        raise HTTPException(status_code=404, detail="conversation not found")
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
def delete_conversation(
    cid: str,
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    x_user_perms: Optional[str] = Header(default=None, alias="X-User-Perms"),
    x_workspace_id: Optional[str] = Header(default=None, alias="X-Workspace-Id"),
):
    owner = _owner(x_user_id, x_user_perms)
    workspace_id = _workspace(x_workspace_id)
    if not session_store.get_conversation(cid, owner_id=owner, workspace_id=workspace_id):
        raise HTTPException(status_code=404, detail="conversation not found")
    if not session_store.delete_conversation(cid, owner_id=owner):
        raise HTTPException(status_code=404, detail="conversation not found")
    return Response(status_code=204)


@app.post("/v1/conversations/{cid}/ensure")
def ensure_conversation(
    cid: str,
    body: Optional[CreateConversationBody] = None,
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    x_user_perms: Optional[str] = Header(default=None, alias="X-User-Perms"),
    x_workspace_id: Optional[str] = Header(default=None, alias="X-Workspace-Id"),
):
    """Register a Java conversation id in the harness session store."""
    body = body or CreateConversationBody()
    owner = _owner(x_user_id, x_user_perms)
    workspace_id = _workspace(x_workspace_id)
    existing = session_store.get_raw(cid)
    if existing and str(existing.get("ownerId") or "demo") != owner:
        raise HTTPException(status_code=404, detail="conversation not found")
    if existing and str(existing.get("workspaceId") or "default") != workspace_id:
        raise HTTPException(status_code=404, detail="conversation not found")
    try:
        return session_store.ensure_conversation(
            cid,
            owner_id=owner,
            workspace_id=workspace_id,
            title=body.title,
            dataset_ids=body.datasetIds,
            linked_dashboard_id=body.linkedDashboardId,
        )
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid conversation id")


@app.get("/v1/conversations/{cid}/events")
def conversation_events(
    cid: str,
    run_id: Optional[str] = None,
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    x_user_perms: Optional[str] = Header(default=None, alias="X-User-Perms"),
    x_workspace_id: Optional[str] = Header(default=None, alias="X-Workspace-Id"),
):
    owner = _owner(x_user_id, x_user_perms)
    if not session_store.get_conversation(cid, owner_id=owner, workspace_id=_workspace(x_workspace_id)):
        raise HTTPException(status_code=404, detail="conversation not found")
    return session_store.list_events(cid, run_id=run_id)


@app.get("/v1/memory")
def get_memory(
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    x_user_perms: Optional[str] = Header(default=None, alias="X-User-Perms"),
    x_workspace_id: Optional[str] = Header(default=None, alias="X-Workspace-Id"),
):
    uid = _owner(x_user_id, x_user_perms)
    return memory_status(uid, workspace_id=_workspace(x_workspace_id))


class KnowledgeBody(BaseModel):
    glossary: Optional[List[Dict[str, Any]]] = None
    examples: Optional[List[Dict[str, Any]]] = None


@app.get("/v1/knowledge/{dataset_id}")
def get_knowledge(
    dataset_id: str,
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    x_user_perms: Optional[str] = Header(default=None, alias="X-User-Perms"),
    x_workspace_id: Optional[str] = Header(default=None, alias="X-Workspace-Id"),
):
    _owner(x_user_id, x_user_perms)
    workspace_id = _workspace(x_workspace_id)
    if not has_permission("conversation:use") and not has_permission("dataset:use"):
        raise HTTPException(status_code=403, detail="missing conversation:use")
    try:
        return load_knowledge(dataset_id, workspace_id=workspace_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid dataset id")


@app.put("/v1/knowledge/{dataset_id}")
def put_knowledge(
    dataset_id: str,
    body: KnowledgeBody,
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    x_user_perms: Optional[str] = Header(default=None, alias="X-User-Perms"),
    x_workspace_id: Optional[str] = Header(default=None, alias="X-Workspace-Id"),
):
    _owner(x_user_id, x_user_perms)
    workspace_id = _workspace(x_workspace_id)
    if not has_permission("dataset:manage") and not has_permission("conversation:use"):
        raise HTTPException(status_code=403, detail="missing permission")
    try:
        return save_knowledge(
            dataset_id,
            {"glossary": body.glossary or [], "examples": body.examples or []},
            workspace_id=workspace_id,
        )
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid dataset id")


@app.get("/v1/conversations/{cid}/messages")
def messages(
    cid: str,
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    x_user_perms: Optional[str] = Header(default=None, alias="X-User-Perms"),
    x_workspace_id: Optional[str] = Header(default=None, alias="X-Workspace-Id"),
):
    owner = _owner(x_user_id, x_user_perms)
    if not session_store.get_conversation(cid, owner_id=owner, workspace_id=_workspace(x_workspace_id)):
        raise HTTPException(status_code=404, detail="conversation not found")
    return session_store.list_messages(cid)


@app.get("/v1/conversations/{cid}/revisions")
def revisions(
    cid: str,
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    x_user_perms: Optional[str] = Header(default=None, alias="X-User-Perms"),
    x_workspace_id: Optional[str] = Header(default=None, alias="X-Workspace-Id"),
):
    owner = _owner(x_user_id, x_user_perms)
    if not session_store.get_conversation(cid, owner_id=owner, workspace_id=_workspace(x_workspace_id)):
        raise HTTPException(status_code=404, detail="conversation not found")
    return []


@app.post("/v1/conversations/{cid}/runs/{run_id}/cancel")
def cancel_run(
    cid: str,
    run_id: str,
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    x_user_perms: Optional[str] = Header(default=None, alias="X-User-Perms"),
    x_workspace_id: Optional[str] = Header(default=None, alias="X-Workspace-Id"),
):
    owner = _owner(x_user_id, x_user_perms)
    if not session_store.get_conversation(cid, owner_id=owner, workspace_id=_workspace(x_workspace_id)):
        raise HTTPException(status_code=404, detail="conversation not found")
    session_store.finish_run(cid, run_id, "cancelled")
    return {"ok": True}


@app.get("/v1/conversations/{cid}/runs/{run_id}/trace")
def run_trace(
    cid: str,
    run_id: str,
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    x_user_perms: Optional[str] = Header(default=None, alias="X-User-Perms"),
    x_workspace_id: Optional[str] = Header(default=None, alias="X-Workspace-Id"),
):
    owner = _owner(x_user_id, x_user_perms)
    if not session_store.get_conversation(cid, owner_id=owner, workspace_id=_workspace(x_workspace_id)):
        raise HTTPException(status_code=404, detail="conversation not found")
    if not session_store.get_run(cid, run_id):
        raise HTTPException(status_code=404, detail="run not found")
    return get_run_trace(cid, run_id)


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


def _parse_sse_data(chunk: str, event: str) -> Optional[Dict[str, Any]]:
    if not chunk.startswith(f"event: {event}"):
        return None
    try:
        data_line = chunk.split("data:", 1)[1].strip().split("\n")[0]
        data = json.loads(data_line)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _ingest_artifact(artifact: Dict[str, Any], event: str, data: Dict[str, Any]) -> None:
    if event not in ("answer_sql", "answer_table", "answer_chart", "answer_insight"):
        return
    artifact[event] = data


@app.post("/v1/conversations/{cid}/runs")
async def conversation_runs(
    cid: str,
    body: RunBody,
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    x_user_perms: Optional[str] = Header(default=None, alias="X-User-Perms"),
    x_workspace_id: Optional[str] = Header(default=None, alias="X-Workspace-Id"),
):
    owner = _owner(x_user_id, x_user_perms)
    workspace_id = _workspace(x_workspace_id)
    conv = session_store.get_conversation(cid, owner_id=owner, workspace_id=workspace_id)
    if not conv:
        raw = session_store.get_raw(cid)
        if raw and str(raw.get("ownerId") or "demo") != owner:
            raise HTTPException(status_code=404, detail="conversation not found")
        try:
            conv = session_store.ensure_conversation(
                cid,
                owner_id=owner,
                workspace_id=workspace_id,
                title=(body.message or "新对话")[:40],
                dataset_ids=body.datasetIds,
            )
        except ValueError:
            raise HTTPException(status_code=400, detail="invalid conversation id")

    if body.datasetIds is not None:
        session_store.update_conversation(cid, {"datasetIds": body.datasetIds})
        conv = session_store.get_conversation(cid, workspace_id=workspace_id) or conv

    session_store.append_message(cid, "user", body.message, [])
    run = session_store.create_run(cid, mode=body.mode or "auto", style_id=body.styleId or "feishu-blue")
    if not run:
        raise HTTPException(status_code=500, detail="failed to create run")

    payload = build_runtime_payload(
        conversation_id=cid,
        run_id=run["id"],
        body=body,
        conversation=conv,
        user_id=owner,
        workspace_id=workspace_id,
        permissions=_permission_list(x_user_perms),
    )

    def gen() -> Iterable[str]:
        controller = RunController(
            cid,
            run["id"],
            message=body.message,
            intent=body.intent,
            style_id=body.styleId,
        )
        recorder = EventStreamRecorder(controller)
        run_chunk = sse(
            "run",
            {
                "runId": run["id"],
                "conversationId": cid,
                "lead": use_lead(),
            },
        )
        controller.observe_chunk(run_chunk)
        yield run_chunk
        try:
            for chunk in recorder.wrap(run_agent(payload)):
                yield chunk
        except Exception as e:
            error_chunk = sse("error", {"code": "HARNESS", "message": str(e)})
            controller.observe_chunk(error_chunk)
            yield error_chunk
            finish_chunk = sse("finish", {"reason": "error", "detail": "exception"})
            controller.observe_chunk(finish_chunk)
            yield finish_chunk
            controller.fail("exception")
        controller.complete()

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
async def confirm_plan(
    cid: str,
    run_id: str,
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    x_user_perms: Optional[str] = Header(default=None, alias="X-User-Perms"),
    x_workspace_id: Optional[str] = Header(default=None, alias="X-Workspace-Id"),
):
    owner = _owner(x_user_id, x_user_perms)
    conv = session_store.get_conversation(cid, owner_id=owner, workspace_id=_workspace(x_workspace_id))
    if not conv:
        raise HTTPException(status_code=404, detail="conversation not found")
    pending = session_store.get_run_pending(cid, run_id)
    if not pending:
        raise HTTPException(status_code=400, detail="no pending plan to confirm")

    def gen() -> Iterable[str]:
        controller = RunController(cid, run_id, capture_artifact=False)
        recorder = EventStreamRecorder(controller)
        try:
            for chunk in recorder.wrap(run_confirm_plan(pending)):
                yield chunk
        except Exception as e:
            error_chunk = sse("error", {"code": "HARNESS", "message": str(e)})
            controller.observe_chunk(error_chunk)
            yield error_chunk
            finish_chunk = sse("finish", {"reason": "error", "detail": "exception"})
            controller.observe_chunk(finish_chunk)
            yield finish_chunk
            controller.fail("exception")
        if controller.finish_reason == "done":
            session_store.clear_run_pending(cid, run_id)
        controller.complete()

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
async def adopt(
    cid: str,
    run_id: str,
    body: Optional[AdoptBody] = None,
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    x_user_perms: Optional[str] = Header(default=None, alias="X-User-Perms"),
    x_workspace_id: Optional[str] = Header(default=None, alias="X-Workspace-Id"),
):
    owner = _owner(x_user_id, x_user_perms)
    conv = session_store.get_conversation(cid, owner_id=owner, workspace_id=_workspace(x_workspace_id))
    if not conv:
        raise HTTPException(status_code=404, detail="conversation not found")
    run = session_store.get_run(cid, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="run not found")
    artifact = session_store.get_run_artifact(cid, run_id)
    if not artifact:
        raise HTTPException(status_code=409, detail="run has no adoptable artifact")
    body = body or AdoptBody()

    def gen() -> Iterable[str]:
        controller = RunController(cid, run_id, capture_artifact=False)
        recorder = EventStreamRecorder(controller)
        try:
            chunks = run_adopt(
                conv,
                run,
                artifact,
                (body.action or "save").strip().lower(),
                body.styleId or str(run.get("styleId") or artifact.get("styleId") or "feishu-blue"),
            )
            for chunk in recorder.wrap(chunks):
                yield chunk
        except Exception as e:
            error_chunk = sse("error", {"code": "HARNESS", "message": str(e)})
            controller.observe_chunk(error_chunk)
            yield error_chunk
            finish_chunk = sse("finish", {"reason": "error", "detail": "exception"})
            controller.observe_chunk(finish_chunk)
            yield finish_chunk
            controller.fail("exception")
        controller.complete()

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


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
