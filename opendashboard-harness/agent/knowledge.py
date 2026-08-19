"""Knowledge injection (阶段2) — frozen-snapshot <knowledge> 块 + skills/od-metrics.

照搬 deer-flow dynamic_context_middleware 的 frozen-snapshot 模式：
静态 system prompt 不掺知识（保持 KV 前缀缓存复用），confirmed 指标 + 词表作为
独立 <knowledge> 块按会话注入；同数据集集合在缓存窗口内冻结，不重复拉取。

数据源：Java /api/internal/bi/knowledge（de_indicator confirmed + de_glossary）。
"""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from tools.od_bi import bi_call

_CACHE_TTL_S = 120.0
_cache_lock = threading.Lock()
_cache: Dict[str, tuple[float, Dict[str, Any]]] = {}


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
                lines.append(f"{term}={field}")
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
                body.append(f"- {term} → {field}")
    else:
        body.append("（暂无词表条目）")
    text = "\n".join(body) + "\n"
    try:
        path.write_text(text, encoding="utf-8")
        return str(path)
    except Exception:
        return None
