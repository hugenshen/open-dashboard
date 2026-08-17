"""Suggest concrete ask-data questions from the current dataset schema.

「换一个问数问题」 is a meta instruction, not a query. Ask back with
clickable questions built from dimensions / measures / time fields.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple

SWITCH_RE = re.compile(
    r"^(换一批(问数)?问题|换一个问数问题|换个问数问题|换一个问题|换个问题|"
    r"换个问法|再问一个|换道题|还能问什么|不知道问什么|"
    r"推荐(几个)?问题|建议(几个)?问题|按该表已有字段重新提问)$"
)

ID_RE = re.compile(r"(^id$|_id$|id$|uuid|guid|编号|订单号|payorderid|主键)", re.I)
TIME_RE = re.compile(r"(time|date|dt|日期|时间|创建|更新|支付成功)", re.I)
NUM_TYPES = (
    "int",
    "decimal",
    "float",
    "double",
    "number",
    "numeric",
    "long",
    "bigint",
    "smallint",
    "real",
    "money",
)
MEASURE_PREF = re.compile(r"(收入|金额|额|数量|销量|利润|gmv|amount|income|qty|count)", re.I)
MEASURE_WEAK = re.compile(r"(费率|率$|rate|ratio|percent|比例|折扣)", re.I)
DIM_PREF = re.compile(r"(类型|区域|渠道|状态|分类|城市|省份|商户|品类|类目)", re.I)


def is_suggest_request(message: str) -> bool:
    q = re.sub(r"[\s，。！？.!?、]+", "", message or "")
    return bool(q) and bool(SWITCH_RE.match(q))


def _label(f: Dict[str, Any]) -> str:
    return str(f.get("label") or f.get("name") or "").strip()


def _name(f: Dict[str, Any]) -> str:
    return str(f.get("name") or "").strip()


def _group(f: Dict[str, Any]) -> str:
    return str(f.get("group") or "").lower()


def _dtype(f: Dict[str, Any]) -> str:
    return str(f.get("dataType") or f.get("type") or "").lower()


def _is_time(f: Dict[str, Any]) -> bool:
    if _group(f) in ("time", "t", "date"):
        return True
    dt = _dtype(f)
    if any(x in dt for x in ("date", "time", "timestamp")):
        return True
    return bool(TIME_RE.search(_name(f) + _label(f)))


def _is_measure(f: Dict[str, Any]) -> bool:
    if _is_time(f):
        return False
    g = _group(f)
    if g in ("quota", "measure", "m", "metric", "q"):
        return True
    if g in ("dim", "dimension", "d"):
        return False
    return any(t in _dtype(f) for t in NUM_TYPES)


def _is_id_like(f: Dict[str, Any]) -> bool:
    blob = f"{_name(f)} {_label(f)}"
    return bool(ID_RE.search(blob))


def _is_dim(f: Dict[str, Any]) -> bool:
    if _is_time(f) or _is_measure(f):
        return False
    if _is_id_like(f):
        return False
    g = _group(f)
    if g in ("dim", "dimension", "d"):
        return True
    return True


def _measure_score(f: Dict[str, Any]) -> int:
    lab = _label(f) + _name(f)
    if MEASURE_WEAK.search(lab):
        return 0
    if MEASURE_PREF.search(lab):
        return 2
    return 1


def _dim_score(f: Dict[str, Any]) -> int:
    return 2 if DIM_PREF.search(_label(f) + _name(f)) else 1


def classify_fields(
    schema: Dict[str, Any],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
    fields = [f for f in (schema.get("fields") or []) if isinstance(f, dict) and _name(f)]
    times = [f for f in fields if _is_time(f)]
    measures = sorted([f for f in fields if _is_measure(f)], key=_measure_score, reverse=True)
    dims = sorted([f for f in fields if _is_dim(f)], key=_dim_score, reverse=True)
    if not dims:
        dims = [f for f in fields if not _is_time(f) and not _is_measure(f)]
    return dims, measures, times


def question_candidates(schema: Dict[str, Any]) -> List[str]:
    dims, measures, times = classify_fields(schema)
    out: List[str] = []
    seen = set()

    def add(q: str) -> None:
        q = re.sub(r"\s+", "", q.strip())
        if q and q not in seen and not is_suggest_request(q):
            seen.add(q)
            out.append(q)

    dim0 = dims[0] if dims else None
    dim1 = dims[1] if len(dims) > 1 else None
    m0 = measures[0] if measures else None
    m1 = measures[1] if len(measures) > 1 else None
    t0 = times[0] if times else None

    if dim0 and m0:
        add(f"各{_label(dim0)}的{_label(m0)}合计")
    if t0 and m0:
        add(f"{_label(m0)}按时间趋势")
    if dim0 and m0:
        add(f"{_label(m0)}最高的前10个{_label(dim0)}")
    if dim0:
        add(f"各{_label(dim0)}的记录数")
    if dim1 and m0:
        add(f"各{_label(dim1)}的{_label(m0)}对比")
    if dim0 and m1:
        add(f"各{_label(dim0)}的{_label(m1)}合计")
    if m0:
        add(f"{_label(m0)}合计是多少")
    if t0 and dim0 and m0:
        add(f"按月看各{_label(dim0)}的{_label(m0)}")

    if not out:
        name = str(schema.get("name") or schema.get("tableName") or "当前表")
        add(f"{name}有多少行")
        fields = [f for f in (schema.get("fields") or []) if isinstance(f, dict) and _name(f)]
        if fields:
            add(f"按{_label(fields[0])}看明细")
    return out


def suggest_questions(schema: Dict[str, Any], *, limit: int = 4, seed: str = "") -> List[str]:
    candidates = question_candidates(schema)
    if not candidates:
        return []
    rotate = "换一批" in (seed or "") or "再问" in (seed or "")
    if rotate and len(candidates) > limit:
        offset = (sum(ord(c) for c in seed) + len(candidates)) % len(candidates)
        candidates = candidates[offset:] + candidates[:offset]
    return candidates[:limit]


def suggest_follows(schema: Dict[str, Any], *, seed: str = "", limit: int = 4) -> List[str]:
    """Clickable chips: concrete questions, plus 换一批 when more exist."""
    all_q = question_candidates(schema)
    picked = suggest_questions(schema, limit=limit, seed=seed)
    follows = list(picked)
    if len(all_q) > len(picked):
        follows.append("换一批问题")
    return follows
