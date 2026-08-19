"""Workspace and dataset scoped ask-data knowledge.

The default workspace keeps the original OD_HARNESS_DATA_DIR/knowledge layout
for compatibility; named workspaces use OD_HARNESS_DATA_DIR/workspaces/{id}.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from agent.session_store import data_dir
from agent.user_context import current_workspace_id


def _safe_id(dataset_id: str) -> str:
    raw = (dataset_id or "").strip()
    if not raw or "/" in raw or "\\" in raw or raw in (".", ".."):
        raise ValueError("invalid dataset id")
    return raw


def _safe_workspace(workspace_id: str) -> str:
    raw = (workspace_id or "").strip() or "default"
    if "/" in raw or "\\" in raw or raw in (".", ".."):
        raise ValueError("invalid workspace id")
    return raw


def _path(dataset_id: str, workspace_id: str = "default") -> Path:
    workspace = _safe_workspace(workspace_id)
    if workspace == "default":
        root = data_dir() / "knowledge"
    else:
        root = data_dir() / "workspaces" / workspace / "knowledge"
    root.mkdir(parents=True, exist_ok=True)
    return root / f"{_safe_id(dataset_id)}.json"


def empty_doc(dataset_id: str, workspace_id: str = "default") -> Dict[str, Any]:
    return {"datasetId": dataset_id, "workspaceId": workspace_id, "glossary": [], "examples": []}


def load(dataset_id: str, *, workspace_id: str | None = None) -> Dict[str, Any]:
    workspace = workspace_id or current_workspace_id()
    path = _path(dataset_id, workspace)
    if not path.is_file():
        return empty_doc(dataset_id, workspace)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return empty_doc(dataset_id, workspace)
    if not isinstance(data, dict):
        return empty_doc(dataset_id, workspace)
    data.setdefault("datasetId", dataset_id)
    data.setdefault("workspaceId", workspace)
    data.setdefault("glossary", [])
    data.setdefault("examples", [])
    return data


def save(dataset_id: str, doc: Dict[str, Any], *, workspace_id: str | None = None) -> Dict[str, Any]:
    workspace = workspace_id or current_workspace_id()
    out = {
        "datasetId": dataset_id,
        "workspaceId": workspace,
        "glossary": list(doc.get("glossary") or []),
        "examples": list(doc.get("examples") or []),
    }
    _path(dataset_id, workspace).write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    return out


def match_glossary(question: str, glossary: List[Any], *, limit: int = 8) -> List[Dict[str, str]]:
    q = (question or "").lower()
    hits: List[Dict[str, str]] = []
    for item in glossary or []:
        if not isinstance(item, dict):
            continue
        term = str(item.get("term") or "").strip()
        field = str(item.get("field") or "").strip()
        aliases = item.get("aliases") or []
        if not isinstance(aliases, list):
            aliases = []
        keys = [term, field, *[str(a) for a in aliases if a]]
        if not any(k and str(k).lower() in q for k in keys):
            continue
        hits.append(
            {
                "term": term,
                "field": field,
                "aliases": ", ".join(str(a) for a in aliases if a),
                "note": str(item.get("note") or ""),
            }
        )
        if len(hits) >= limit:
            break
    return hits


def match_examples(question: str, examples: List[Any], *, limit: int = 3) -> List[Dict[str, str]]:
    q = (question or "").lower()
    scored: List[tuple[int, Dict[str, str]]] = []
    for item in examples or []:
        if not isinstance(item, dict):
            continue
        nl = str(item.get("question") or item.get("nl") or "").strip()
        sql = str(item.get("sql") or "").strip()
        if not nl or not sql:
            continue
        tokens = [t for t in re.split(r"\s+", nl.lower()) if len(t) >= 2]
        score = sum(1 for t in tokens if t in q)
        if score <= 0 and nl.lower() not in q:
            continue
        scored.append((score, {"question": nl, "sql": sql, "note": str(item.get("note") or "")}))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [row for _, row in scored[:limit]]


def prompt_block(question: str, dataset_id: Optional[str], *, workspace_id: str | None = None) -> str:
    if not dataset_id:
        return ""
    try:
        doc = load(dataset_id, workspace_id=workspace_id)
    except ValueError:
        return ""
    terms = match_glossary(question, doc.get("glossary") or [])
    examples = match_examples(question, doc.get("examples") or [])
    if not terms and not examples:
        return ""
    lines = ["<business-knowledge>"]
    if terms:
        lines.append("术语（必须映射到 m-schema 字段，不得编造字段）：")
        for t in terms:
            alias = f"（又名 {t['aliases']}）" if t.get("aliases") else ""
            note = f" — {t['note']}" if t.get("note") else ""
            lines.append(f"- {t['term']}{alias} → {t['field']}{note}")
    if examples:
        lines.append("相似 SQL 示例（只读；表名必须仍是当前数据集物理表）：")
        for ex in examples:
            lines.append(f"- Q: {ex['question']}")
            lines.append(f"  SQL: {ex['sql']}")
    lines.append("</business-knowledge>")
    return "\n".join(lines)
