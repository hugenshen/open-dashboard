"""Harness-owned memory runtime facade."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from agent.user_memory import add_fact, load


def recall_user_memory(user_id: str, *, workspace_id: str = "default", limit: int = 20) -> List[Dict[str, Any]]:
    facts = list((load(user_id, workspace_id=workspace_id).get("facts") or []))[-limit:]
    return [
        {"scope": "user", "workspaceId": workspace_id, "userId": user_id, "content": str(fact), "status": "active"}
        for fact in facts
        if str(fact).strip()
    ]


def remember_user_fact(user_id: str, fact: str, *, workspace_id: str = "default", confidence: float = 1.0) -> None:
    add_fact(fact, user_id=user_id, workspace_id=workspace_id, confidence=confidence)


def memory_status(user_id: Optional[str] = None, *, workspace_id: str = "default") -> Dict[str, Any]:
    doc = load(user_id, workspace_id=workspace_id)
    return {"userId": doc.get("userId"), "workspaceId": doc.get("workspaceId"), "facts": doc.get("facts") or [], "scope": "user"}
