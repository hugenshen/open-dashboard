"""Workspace-scoped ask-data knowledge and frozen-snapshot platform knowledge.

File-based glossary/examples live under OD_HARNESS_DATA_DIR (default workspace
or workspaces/{id}) for SQLBot prompt_block matching.

Platform knowledge (阶段2) injects confirmed metrics + glossary as a frozen
<knowledge> snapshot via Java /api/internal/bi/knowledge, plus skills/od-metrics.
Static system prompt stays knowledge-free (KV prefix cache); the same dataset
set is frozen inside the cache window and not re-fetched.
"""

from __future__ import annotations

import json
import re
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from agent.session_store import data_dir
from agent.user_context import current_workspace_id
from tools.od_bi import bi_call

_CACHE_TTL_S = 120.0
_cache_lock = threading.Lock()
_cache: Dict[str, tuple[float, Dict[str, Any]]] = {}


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
        raw_vals = item.get("values") or []
        val_keys = [str(v) for v in raw_vals if v] if isinstance(raw_vals, list) else []
        keys = [term, field, *[str(a) for a in aliases if a], *val_keys]
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


def fetch_knowledge(dataset_ids: List[str]) -> Dict[str, Any]:
    """拉取知识载荷（confirmed 指标 + 词表），带冻结快照缓存。"""
    ids = sorted(dataset_ids or [])
    key = ",".join(ids)
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < _CACHE_TTL_S:
            return hit[1]
    try:
        payload = bi_call("GET", "/api/internal/bi/knowledge?datasetIds=" + ",".join(ids))
    except Exception:
        payload = {"metrics": [], "terms": []}
    if not isinstance(payload, dict):
        payload = {"metrics": [], "terms": []}
    with _cache_lock:
        _cache[key] = (time.monotonic(), payload)
    return payload


def invalidate_knowledge(dataset_ids: Optional[List[str]] = None) -> None:
    """确认/解释回写后失效缓存，下一次注入拿到最新知识。"""
    with _cache_lock:
        if dataset_ids is None:
            _cache.clear()
        else:
            ids = sorted(dataset_ids)
            _cache.pop(",".join(ids), None)


def format_knowledge_block(metrics: List[Any], terms: List[Any]) -> str:
    """渲染 <system-reminder><knowledge>…</knowledge></system-reminder>（frozen-snapshot）。"""
    lines: List[str] = []
    if metrics:
        lines.append("<metrics>")
        for m in metrics:
            if not isinstance(m, dict):
                continue
            field = m.get("field") or ""
            name = m.get("name") or field
            agg = m.get("agg") or ""
            unit = m.get("unit") or ""
            bits = [str(name), str(field)]
            if agg:
                bits.append(f"{agg}")
            if unit:
                bits.append(f"{unit}")
            formula = m.get("formula")
            line = "->".join(bits)
            if formula:
                line += f" 口径:{formula}"
            lines.append(line)
        lines.append("</metrics>")
    if terms:
        lines.append("<terms>")
        for t in terms:
            if not isinstance(t, dict):
                continue
            term = t.get("term") or ""
            field = t.get("field") or ""
            if term and field:
                line = f"{term}={field}"
                vals = t.get("values") or []
                if isinstance(vals, list) and vals:
                    shown = "/".join(str(v).strip() for v in vals[:12] if str(v).strip())
                    if shown:
                        line += f" 值:{shown}"
                lines.append(line)
        lines.append("</terms>")
    if not lines:
        return ""
    return "<system-reminder>\n<knowledge>\n" + "\n".join(lines) + "\n</knowledge>\n</system-reminder>"


def get_confirmed_metrics(dataset_ids: List[str]) -> List[Dict[str, Any]]:
    """od_plan_charts 选指标用：confirmed 指标（agg/unit 权威）。"""
    payload = fetch_knowledge(dataset_ids)
    return [m for m in (payload.get("metrics") or []) if isinstance(m, dict)]


def ensure_skill_file(metrics: List[Any], terms: List[Any]) -> Optional[str]:
    """Pi skills 模式：把 confirmed 指标 + 词表写成 skills/od-metrics/SKILL.md，
    模型按 <available_skills> 清单按需读取完整口径字典。"""
    root = Path(__file__).resolve().parent.parent / "skills" / "od-metrics"
    root.mkdir(parents=True, exist_ok=True)
    path = root / "SKILL.md"
    body: List[str] = [
        "---",
        "name: od-metrics",
        "description: 指标口径字典（已确认指标 + 业务词表）。生成看板选指标、理解用户业务词时读取。",
        "---",
        "",
        "# OD 指标口径字典",
        "",
        "已确认指标（agg/unit 权威，生成看板 KPI 优先从这里选）：",
        "",
    ]
    if metrics:
        for m in metrics:
            if not isinstance(m, dict):
                continue
            field = m.get("field") or ""
            name = m.get("name") or field
            agg = m.get("agg") or ""
            unit = m.get("unit") or ""
            formula = m.get("formula") or ""
            body.append(f"- {name} → {field}（{agg}" + (f"，{unit}" if unit else "") + "）" + (f"；口径：{formula}" if formula else ""))
    else:
        body.append("（暂无已确认指标）")
    body.append("")
    body.append("业务词表（用户词 → 字段）：")
    body.append("")
    if terms:
        for t in terms:
            if not isinstance(t, dict):
                continue
            term = t.get("term") or ""
            field = t.get("field") or ""
            if term and field:
                line = f"- {term} → {field}"
                vals = t.get("values") or []
                if isinstance(vals, list) and vals:
                    shown = "/".join(str(v).strip() for v in vals[:12] if str(v).strip())
                    if shown:
                        line += f"（值：{shown}）"
                body.append(line)
    else:
        body.append("（暂无词表条目）")
    text = "\n".join(body) + "\n"
    try:
        path.write_text(text, encoding="utf-8")
        return str(path)
    except Exception:
        return None
