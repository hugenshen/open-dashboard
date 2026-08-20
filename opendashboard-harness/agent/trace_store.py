"""Read model for Harness run traces."""

from __future__ import annotations

from typing import Any, Dict, List

from agent import session_store


def get_run_trace(conversation_id: str, run_id: str) -> Dict[str, Any]:
    run = session_store.get_run(conversation_id, run_id) or {}
    events = session_store.list_events(conversation_id, run_id=run_id)
    artifact = run.get("artifact") if isinstance(run.get("artifact"), dict) else {}
    pending = run.get("pending") if isinstance(run.get("pending"), dict) else None
    return {
        "conversationId": conversation_id,
        "runId": run_id,
        "status": run.get("status"),
        "finishDetail": run.get("finishDetail"),
        "mode": run.get("mode"),
        "styleId": run.get("styleId"),
        "createTime": run.get("createTime"),
        "updateTime": run.get("updateTime"),
        "eventCount": len(events),
        "events": events,
        "artifact": artifact,
        "pending": pending,
        "knowledgeRefs": run.get("knowledgeRefs") or [],
        "memoryRefs": run.get("memoryRefs") or [],
    }


def get_conversation_replay(conversation_id: str) -> Dict[str, Any]:
    """History hydrate payload: per-run events + ask artifacts, no live SSE needed."""
    doc = session_store.get_raw(conversation_id) or {}
    runs: List[Dict[str, Any]] = []
    for run in doc.get("runs") or []:
        rid = str(run.get("id") or "")
        if not rid:
            continue
        events = session_store.list_events(conversation_id, run_id=rid)
        artifact = run.get("artifact") if isinstance(run.get("artifact"), dict) else {}
        runs.append(
            {
                "id": rid,
                "status": run.get("status"),
                "finishDetail": run.get("finishDetail"),
                "mode": run.get("mode"),
                "createTime": run.get("createTime"),
                "eventCount": len(events),
                "events": events,
                "artifact": artifact,
            }
        )
    return {
        "conversationId": conversation_id,
        "linkedDashboardId": doc.get("linkedDashboardId"),
        "runs": runs,
    }
