"""Session store: conversations + messages + runs (JSON files under data dir)."""

from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional


def data_dir() -> Path:
    raw = os.environ.get("OD_HARNESS_DATA_DIR") or ".od-harness"
    p = Path(raw)
    if not p.is_absolute():
        p = Path(__file__).resolve().parent.parent / p
    p.mkdir(parents=True, exist_ok=True)
    (p / "conversations").mkdir(exist_ok=True)
    return p


def _now() -> int:
    return int(time.time() * 1000)


def _conv_path(cid: str) -> Path:
    return data_dir() / "conversations" / f"{cid}.json"


def _load(cid: str) -> Optional[Dict[str, Any]]:
    path = _conv_path(cid)
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _save(doc: Dict[str, Any]) -> Dict[str, Any]:
    doc["updateTime"] = _now()
    _conv_path(doc["id"]).write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    return doc


def list_conversations(owner_id: str = "demo") -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for f in sorted((data_dir() / "conversations").glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            doc = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        if owner_id and doc.get("ownerId") not in (None, owner_id, "demo"):
            # still show all in local/dev
            pass
        out.append(_public_conv(doc))
    return out


def _public_conv(doc: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": doc["id"],
        "title": doc.get("title") or "新对话",
        "ownerId": doc.get("ownerId") or "demo",
        "layoutPrefs": doc.get("layoutPrefs") or {},
        "datasetIds": doc.get("datasetIds") or [],
        "linkedDashboardId": doc.get("linkedDashboardId"),
        "createTime": doc.get("createTime"),
        "updateTime": doc.get("updateTime"),
    }


def create_conversation(
    owner_id: str = "demo",
    title: Optional[str] = None,
    dataset_ids: Optional[List[str]] = None,
    linked_dashboard_id: Optional[str] = None,
) -> Dict[str, Any]:
    cid = str(uuid.uuid4()).replace("-", "")[:12]
    doc = {
        "id": cid,
        "title": title or "新对话",
        "ownerId": owner_id or "demo",
        "layoutPrefs": {},
        "datasetIds": dataset_ids or [],
        "linkedDashboardId": linked_dashboard_id,
        "messages": [],
        "memory": [],
        "runs": [],
        "createTime": _now(),
        "updateTime": _now(),
    }
    _save(doc)
    return _public_conv(doc)


def get_conversation(cid: str) -> Optional[Dict[str, Any]]:
    doc = _load(cid)
    return _public_conv(doc) if doc else None


def get_raw(cid: str) -> Optional[Dict[str, Any]]:
    return _load(cid)


def update_conversation(cid: str, patch: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    doc = _load(cid)
    if not doc:
        return None
    for k in ("title", "layoutPrefs", "datasetIds", "linkedDashboardId"):
        if k in patch and patch[k] is not None:
            doc[k] = patch[k]
    _save(doc)
    return _public_conv(doc)


def delete_conversation(cid: str) -> bool:
    path = _conv_path(cid)
    if not path.is_file():
        return False
    path.unlink()
    return True


def list_messages(cid: str) -> List[Dict[str, Any]]:
    doc = _load(cid)
    if not doc:
        return []
    return list(doc.get("messages") or [])


def append_message(
    cid: str,
    role: str,
    content: str,
    attachments: Optional[List[Dict[str, Any]]] = None,
) -> Optional[Dict[str, Any]]:
    doc = _load(cid)
    if not doc:
        return None
    msg = {
        "id": str(uuid.uuid4()).replace("-", "")[:10],
        "conversationId": cid,
        "role": role,
        "content": content,
        "attachments": attachments or [],
        "createTime": _now(),
    }
    doc.setdefault("messages", []).append(msg)
    if role == "user" and (not doc.get("title") or doc.get("title") == "新对话"):
        doc["title"] = (content or "新对话")[:40]
    _save(doc)
    return msg


def add_memory_fact(cid: str, fact: str) -> None:
    doc = _load(cid)
    if not doc:
        return
    facts = doc.setdefault("memory", [])
    if fact and fact not in facts:
        facts.append(fact)
        if len(facts) > 40:
            doc["memory"] = facts[-40:]
        _save(doc)


def link_dashboard(cid: str, dashboard_id: str) -> None:
    update_conversation(cid, {"linkedDashboardId": dashboard_id})


def create_run(cid: str, mode: str = "auto", style_id: str = "feishu-blue") -> Optional[Dict[str, Any]]:
    doc = _load(cid)
    if not doc:
        return None
    run = {
        "id": str(uuid.uuid4()).replace("-", "")[:10],
        "conversationId": cid,
        "status": "running",
        "mode": mode,
        "styleId": style_id,
        "createTime": _now(),
        "updateTime": _now(),
    }
    doc.setdefault("runs", []).append(run)
    _save(doc)
    return run


def finish_run(cid: str, run_id: str, status: str, detail: Optional[str] = None) -> None:
    doc = _load(cid)
    if not doc:
        return
    for r in doc.get("runs") or []:
        if r.get("id") == run_id:
            r["status"] = status
            r["finishDetail"] = detail
            r["updateTime"] = _now()
            break
    _save(doc)
