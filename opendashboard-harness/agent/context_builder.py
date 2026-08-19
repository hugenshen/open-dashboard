"""Runtime context builder for Harness runs."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from agent import session_store


@dataclass
class RuntimeContext:
    conversation_id: str
    run_id: str
    user_id: str
    workspace_id: str = "default"
    dataset_ids: List[str] = field(default_factory=list)
    linked_dashboard_id: Optional[str] = None
    permissions: List[str] = field(default_factory=list)
    knowledge_refs: List[Dict[str, Any]] = field(default_factory=list)
    memory_refs: List[Dict[str, Any]] = field(default_factory=list)

    def to_payload_context(self) -> Dict[str, Any]:
        return {
            "workspaceId": self.workspace_id,
            "userId": self.user_id,
            "permissions": self.permissions,
            "knowledgeRefs": self.knowledge_refs,
            "memoryRefs": self.memory_refs,
        }


def build_run_payload(
    *,
    conversation_id: str,
    run_id: str,
    body: Any,
    conversation: Dict[str, Any],
    user_id: str,
    workspace_id: str = "default",
    permissions: Optional[List[str]] = None,
) -> Dict[str, Any]:
    dataset_ids = body.datasetIds if getattr(body, "datasetIds", None) is not None else (conversation.get("datasetIds") or [])
    hist = [
        {"role": m.get("role"), "content": m.get("content")}
        for m in session_store.list_messages(conversation_id)
        if m.get("role") in ("user", "assistant")
    ]
    ctx = RuntimeContext(
        conversation_id=conversation_id,
        run_id=run_id,
        user_id=user_id,
        workspace_id=workspace_id,
        dataset_ids=list(dataset_ids or []),
        linked_dashboard_id=conversation.get("linkedDashboardId"),
        permissions=permissions or [],
    )
    return {
        "conversationId": conversation_id,
        "runId": run_id,
        "message": body.message,
        "intent": body.intent,
        "mode": body.mode or "auto",
        "styleId": body.styleId or "feishu-blue",
        "datasetIds": ctx.dataset_ids,
        "linkedDashboardId": ctx.linked_dashboard_id,
        "selectedChartId": body.selectedChartId,
        "selectedEncode": body.selectedEncode,
        "history": hist[:-1] if hist and hist[-1].get("role") == "user" else hist,
        "runtimeContext": ctx.to_payload_context(),
    }
