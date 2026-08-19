"""Memory helpers: short facts for transformContext."""

from __future__ import annotations

from typing import List

from agent import session_store
from agent.user_context import current_workspace_id
from agent.user_memory import add_fact as remember_user_fact
from agent.user_memory import format_user_memory_block, maybe_extract_user_fact


def load_facts(conversation_id: str) -> List[str]:
    doc = session_store.get_raw(conversation_id)
    if not doc:
        return []
    return list(doc.get("memory") or [])


def remember(conversation_id: str, fact: str) -> None:
    session_store.add_memory_fact(conversation_id, fact.strip())


def format_memory_block(facts: List[str]) -> str:
    session = ""
    if facts:
        lines = "\n".join(f"- {f}" for f in facts[-20:])
        session = f"## Session memory\n{lines}\n"
    user = format_user_memory_block(workspace_id=current_workspace_id())
    return (user + session).strip() + ("\n" if user or session else "")


def maybe_extract_fact(user_message: str, dataset_ids: List[str]) -> str:
    """Lightweight heuristic facts (no LLM). Session + user-scoped."""
    if not user_message:
        return ""
    user_fact = maybe_extract_user_fact(user_message, dataset_ids)
    if user_fact:
        try:
            remember_user_fact(user_fact, workspace_id=current_workspace_id())
        except Exception:
            pass
    if dataset_ids:
        return f"User bound datasets: {', '.join(dataset_ids[:5])}"
    return user_fact
