"""Cross-conversation user facts isolated by workspace and user."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

from agent.session_store import data_dir
from agent.user_context import current_user_id, current_workspace_id, require_user_id


def _safe_user(user_id: str) -> str:
    raw = (user_id or "").strip()
    if not raw or "/" in raw or "\\" in raw or raw in (".", ".."):
        raise ValueError("invalid user id")
    return raw


def _safe_workspace(workspace_id: str) -> str:
    raw = (workspace_id or "").strip() or "default"
    if "/" in raw or "\\" in raw or raw in (".", ".."):
        raise ValueError("invalid workspace id")
    return raw


def _path(user_id: str, workspace_id: str = "default") -> Path:
    workspace = _safe_workspace(workspace_id)
    if workspace == "default":
        root = data_dir() / "users" / _safe_user(user_id)
    else:
        root = data_dir() / "workspaces" / workspace / "users" / _safe_user(user_id)
    root.mkdir(parents=True, exist_ok=True)
    return root / "memory.json"


def load(user_id: str | None = None, *, workspace_id: str | None = None) -> Dict[str, Any]:
    uid = user_id or current_user_id() or "demo"
    workspace = workspace_id or current_workspace_id()
    path = _path(uid, workspace)
    if not path.is_file():
        return {"userId": uid, "workspaceId": workspace, "facts": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"userId": uid, "workspaceId": workspace, "facts": []}
    if not isinstance(data, dict):
        return {"userId": uid, "workspaceId": workspace, "facts": []}
    data.setdefault("userId", uid)
    data.setdefault("workspaceId", workspace)
    data.setdefault("facts", [])
    return data


def add_fact(
    fact: str,
    *,
    user_id: str | None = None,
    workspace_id: str | None = None,
    confidence: float = 1.0,
) -> None:
    text = (fact or "").strip()
    if not text or confidence < 0.7:
        return
    uid = user_id or require_user_id()
    workspace = workspace_id or current_workspace_id()
    doc = load(uid, workspace_id=workspace)
    facts: List[str] = list(doc.get("facts") or [])
    if text not in facts:
        facts.append(text)
    doc["facts"] = facts[-100:]
    _path(uid, workspace).write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")


def format_user_memory_block(
    user_id: str | None = None,
    *,
    workspace_id: str | None = None,
    max_facts: int = 20,
) -> str:
    facts = list((load(user_id, workspace_id=workspace_id).get("facts") or []))[-max_facts:]
    if not facts:
        return ""
    lines = "\n".join(f"- {f}" for f in facts)
    return f"## User memory\n{lines}\n"


def maybe_extract_user_fact(user_message: str, dataset_ids: List[str]) -> str:
    if dataset_ids:
        return f"Preferred datasets: {', '.join(dataset_ids[:5])}"
    q = user_message or ""
    if "折线" in q:
        return "Prefers line charts when talking about trends"
    return ""
