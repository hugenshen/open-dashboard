"""Ask-data prompt extras: gold-question few-shot + confirmed dimension values."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional


def score_example(question: str, nl: str) -> int:
    q = (question or "").lower()
    text = (nl or "").strip().lower()
    if not q or not text:
        return 0
    if text in q or q in text:
        return 100
    tokens = [t for t in re.split(r"[\s，。！？、,./+\-_:;|]+", text) if len(t) >= 2]
    score = sum(1 for t in tokens if t in q)
    if score == 0 and any("\u4e00" <= ch <= "\u9fff" for ch in text):
        grams = {text[i : i + 2] for i in range(len(text) - 1)}
        score = sum(1 for g in grams if g in q)
    return score


def pick_few_shots(question: str, examples: List[Any], *, limit: int = 3) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = [e for e in examples or [] if isinstance(e, dict) and e.get("sql") and e.get("question")]
    if not rows:
        return []
    scored = sorted(((score_example(question, str(e.get("question") or "")), e) for e in rows), key=lambda x: x[0], reverse=True)
    hits = [e for s, e in scored if s > 0][:limit]
    if hits:
        return hits
    return rows[:limit]


def value_hints(question: str, fields: List[Any], *, max_fields: int = 8, max_vals: int = 12) -> str:
    q = (question or "").lower()
    picked: List[tuple[str, str, List[str]]] = []
    small: List[tuple[str, str, List[str]]] = []
    for f in fields or []:
        if not isinstance(f, dict):
            continue
        name = str(f.get("name") or "").strip()
        label = str(f.get("label") or name).strip()
        raw = f.get("values") or []
        if not isinstance(raw, list):
            continue
        vals = [str(v).strip() for v in raw if str(v).strip()]
        if not vals or not name:
            continue
        keys = [name.lower(), label.lower(), *[v.lower() for v in vals if len(v) >= 2][:40]]
        hit = any(k and k in q for k in keys)
        row = (label or name, name, vals[:max_vals])
        if hit:
            picked.append(row)
        elif len(vals) <= 12:
            small.append(row)
    chosen = (picked + small)[:max_fields]
    if not chosen:
        return ""
    lines = [
        "<dimension-values>",
        "已确认公共维度的取值。问到这些值时必须用下列原文字面量写入 SQL，不要翻译或改写。",
    ]
    for label, name, vals in chosen:
        lines.append(f"- {label}({name}): {', '.join(vals)}")
    lines.append("</dimension-values>")
    return "\n".join(lines)


def compose_ask_knowledge(
    *,
    few_shots: Optional[List[Dict[str, Any]]] = None,
    file_block: str = "",
    java_block: str = "",
    value_block: str = "",
) -> str:
    parts: List[str] = []
    if few_shots:
        parts.append("<few-shot-examples>")
        parts.append("以下是本表已验证的问法与 SQL。优先模仿表名、字段和过滤写法，表名必须仍是当前数据集物理表。")
        for ex in few_shots:
            parts.append(f"- Q: {ex.get('question')}")
            parts.append(f"  SQL: {ex.get('sql')}")
        parts.append("</few-shot-examples>")
    for block in (java_block, file_block, value_block):
        text = (block or "").strip()
        if text:
            parts.append(text)
    return "\n".join(parts)
