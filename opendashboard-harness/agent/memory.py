"""Memory helpers: short facts for transformContext."""

from __future__ import annotations

from typing import Any, Dict, List

from agent import session_store


def load_facts(conversation_id: str) -> List[str]:
    doc = session_store.get_raw(conversation_id)
    if not doc:
        return []
    return list(doc.get("memory") or [])


def remember(conversation_id: str, fact: str) -> None:
    session_store.add_memory_fact(conversation_id, fact.strip())


def format_memory_block(facts: List[str]) -> str:
    if not facts:
        return ""
    lines = "\n".join(f"- {f}" for f in facts[-20:])
    return f"## Session memory\n{lines}\n"


def maybe_extract_fact(user_message: str, dataset_ids: List[str]) -> str:
    """Lightweight heuristic facts (no LLM)."""
    if not user_message:
        return ""
    if dataset_ids:
        return f"User bound datasets: {', '.join(dataset_ids[:5])}"
    return ""
