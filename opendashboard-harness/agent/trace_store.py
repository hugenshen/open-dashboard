"""Read model for Harness run traces."""

from __future__ import annotations

from typing import Any, Dict

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
