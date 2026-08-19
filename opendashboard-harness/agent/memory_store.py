"""User-level memory (阶段4) — deermem-style document + deterministic gates.

照搬 ref/deer-flow deermem 的核心机制，场景词换成 BI：
- 消息过滤：保留用户输入 + 最终 assistant 回复；丢弃工具调用/系统事件
- 信号检测：correction / decision / preference / reinforcement（中英文正则）
- LLM 事实抽取（OD_LLM_API_KEY 存在时）：{facts:[{content,category,confidence}]}
- 三标签确定性写闸：只有 scope=user + durable + descriptive 才入库（防一次性任务细节）
- 文档 shape：{version, revision, lastUpdated, user{...}, history{...}, facts[]}
- 注入：<system-reminder><memory>…</memory></system-reminder>（frozen-snapshot）
- memory_search：大小写不敏感子串召回（design 指定的轻量检索）
- 会话结束 flush：把关键结论沉淀进用户记忆（summarization flush hook）
"""

from __future__ import annotations

import json
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from agent import session_store
from llm_client import chat_completions, llm_configured, llm_settings

# ── 存储 ────────────────────────────────────────────────────────────────

DOCUMENT_VERSION = "1.0"


def memory_dir() -> Path:
    d = session_store.data_dir() / "memory"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _memory_path(user_id: str) -> Path:
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", user_id or "demo")
    return memory_dir() / f"{safe}.json"


def create_empty_memory() -> Dict[str, Any]:
    """照搬 deermem create_empty_memory() document shape。"""
    return {
        "version": DOCUMENT_VERSION,
        "revision": 0,
        "lastUpdated": _now_iso(),
        "user": {
            "workContext": {"summary": "", "updatedAt": ""},
            "personalContext": {"summary": "", "updatedAt": ""},
            "topOfMind": {"summary": "", "updatedAt": ""},
        },
        "history": {
            "recentMonths": {"summary": "", "updatedAt": ""},
            "earlierContext": {"summary": "", "updatedAt": ""},
            "longTermBackground": {"summary": "", "updatedAt": ""},
        },
        "facts": [],
    }


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def load_document(user_id: str) -> Dict[str, Any]:
    path = _memory_path(user_id)
    if not path.is_file():
        return create_empty_memory()
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(doc, dict) or not isinstance(doc.get("facts"), list):
            return create_empty_memory()
        return doc
    except Exception:
        return create_empty_memory()


def save_document(user_id: str, doc: Dict[str, Any]) -> Dict[str, Any]:
    """带 revision 乐观锁的落盘（照搬 deermem storage revision 冲突检测）。"""
    path = _memory_path(user_id)
    current = load_document(user_id)
    if doc.get("revision", 0) < current.get("revision", 0):
        # 陈旧写者：以较新版本为准，丢弃本次写入（简单冲突策略）
        return current
    doc["revision"] = int(current.get("revision", 0)) + 1
    doc["lastUpdated"] = _now_iso()
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)
    return doc


def _new_fact(content: str, category: str = "context", confidence: float = 0.5,
              source_thread: Optional[str] = None) -> Dict[str, Any]:
    now = _now_iso()
    return {
        "id": "f_" + uuid.uuid4().hex[:6],
        "content": content.strip(),
        "category": category,
        "confidence": round(min(1.0, max(0.0, confidence)), 2),
        "source": {"type": "conversation", "threadId": source_thread or ""},
        "confirmationCount": 1,
        "createdAt": now,
        "updatedAt": now,
    }


# ── 消息过滤（照搬 deermem message_filtering） ─────────────────────────

_SYSTEM_EVENT_HINTS = ("intent_map", "plan", "write_todos", "od_", "tool", "patch", "board_ready")


def filter_messages_for_memory(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """保留：用户输入 + 最终 assistant 回复；丢弃：工具调用/工具输出/系统事件。"""
    out: List[Dict[str, Any]] = []
    for m in messages or []:
        if not isinstance(m, dict):
            continue
        role = m.get("role") or ""
        content = m.get("content") or ""
        if not content:
            continue
        if role == "user":
            if any(h in content for h in _SYSTEM_EVENT_HINTS):
                continue  # intent_map/plan 等系统事件不进记忆
            # 运行时 JSON 载荷（intent/plan/mode…）不是用户原话，不进记忆
            if content.lstrip().startswith("{") and ("intent" in content or "plan" in content or "mode" in content):
                continue
            out.append(m)
        elif role == "assistant":
            if m.get("tool_calls"):
                continue  # 工具调用消息不是回复
            if any(h in content for h in _SYSTEM_EVENT_HINTS):
                continue
            out.append(m)
        # tool/system/ui 一律丢弃
    return out


# ── 信号检测（照搬 message_patterns/*.yaml） ───────────────────────────

_PATTERNS: Dict[str, List[str]] = {
    "correction": [
        r"不对", r"你理解错了", r"不是这个", r"我说的是", r"改用", r"错了", r"更正",
        r"wrong", r"not that", r"i mean", r"actually",
    ],
    "decision": [
        r"就用", r"决定用", r"就这么定", r"选(用)?这个", r"以后都", r"确定用",
        r"decided", r"let's (go|use)", r"stick with",
    ],
    "preference": [
        r"以后", r"习惯", r"喜欢", r"偏好", r"希望", r"统一用", r"都(用|按)", r"默认",
        r"prefer", r"usually", r"always use", r"favorite",
    ],
    "reinforcement": [
        r"很好", r"对", r"没错", r"就是这样", r"不错", r"太好了",
        r"great", r"correct", r"yes exactly", r"nice",
    ],
}

_TRIVIAL_RE = re.compile(
    r"^(你好|hi|hello|谢谢|好的|嗯|ok|收到|继续|再来|在吗|感谢|明白了|知道了)[!。．？?~～]*$",
    re.IGNORECASE,
)


def detect_signals(text: str) -> List[str]:
    if not text:
        return []
    if _TRIVIAL_RE.match(text.strip()):
        return ["trivial"]
    hits: List[str] = []
    for kind, pats in _PATTERNS.items():
        if any(re.search(p, text, re.IGNORECASE) for p in pats):
            hits.append(kind)
    return hits


# ── LLM 事实抽取 + 三标签写闸（照搬 fact_extraction + memory_update） ───

_EXTRACTION_PROMPT = """你是用户记忆抽取器。从对话消息中抽取值得长期记住的用户事实。
只抽 preference/knowledge/context/behavior/goal/correction 六类，过滤一次性任务细节。
输出 JSON：{{"facts":[{{"content":"…","category":"preference|knowledge|context|behavior|goal|correction","confidence":0.0-1.0}}]}}
没有值得记的事实就输出 {{"facts":[]}}。"""

_GATE_PROMPT = """对每条候选事实打三个标签，只返回 JSON：{{"items":[{{"id":0,"scope":"user|thread|project","durability":"durable|temporary","authority":"transactional|descriptive"}}]}}
规则：一次性任务细节=thread+temporary+transactional；跨会话的用户偏好/习惯/口径=user+durable+descriptive。"""


def _llm_json(prompt: str, text: str, max_tokens: int = 800) -> Optional[Dict[str, Any]]:
    if not llm_configured():
        return None
    try:
        cfg = llm_settings()
        resp = chat_completions(
            [
                {"role": "system", "content": prompt},
                {"role": "user", "content": text[:4000]},
            ],
            temperature=0.0,
        )
        content = ((resp.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
        content = content.strip()
        if content.startswith("```"):
            content = re.sub(r"^```[a-zA-Z]*\n?", "", content)
            content = re.sub(r"\n?```$", "", content)
        return json.loads(content)
    except Exception:
        return None


def _deterministic_facts(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """无 LLM 时的启发式抽取：对每条用户消息做信号检测，命中偏好/纠正/决策才入库。"""
    facts: List[Dict[str, Any]] = []
    for m in messages or []:
        if not isinstance(m, dict):
            continue
        if m.get("role") != "user":
            continue
        text = str(m.get("content") or "").strip()
        if not text:
            continue
        signals = detect_signals(text)
        if "trivial" in signals or not signals:
            continue
        if "preference" in signals:
            facts.append(_new_fact(text[:120], "preference", 0.6))
        elif "correction" in signals:
            facts.append(_new_fact(text[:120], "correction", 0.7))
        elif "decision" in signals:
            facts.append(_new_fact(text[:120], "decision", 0.6))
    return facts


def _extract_facts(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """LLM 抽取 → 三标签闸 → 只有 user+durable+descriptive 才返回（确定性写闸）。"""
    text = "\n".join(f"{m.get('role')}: {m.get('content')}" for m in messages)
    if not text.strip():
        return []
    if llm_configured():
        extracted = _llm_json(_EXTRACTION_PROMPT, text)
        raw = (extracted or {}).get("facts") or []
        if raw:
            gated = _llm_json(_GATE_PROMPT, json.dumps(raw, ensure_ascii=False))
            tags = {int(x.get("id")): x for x in (gated or {}).get("items") or [] if isinstance(x, dict)}
            kept: List[Dict[str, Any]] = []
            for i, f in enumerate(raw):
                if not isinstance(f, dict):
                    continue
                tag = tags.get(i) or {}
                if tag.get("scope") == "user" and tag.get("durability") == "durable" and tag.get("authority") == "descriptive":
                    try:
                        conf = float(f.get("confidence") or 0.5)
                    except (TypeError, ValueError):
                        conf = 0.5
                    kept.append(_new_fact(str(f.get("content") or ""), str(f.get("category") or "context"), conf))
            return kept
    return _deterministic_facts(messages)


# ── 公开操作 ────────────────────────────────────────────────────────────

def add_fact(user_id: str, content: str, category: str = "context", confidence: float = 0.6,
             source_thread: Optional[str] = None) -> Dict[str, Any]:
    """memory_add 工具写路径：直接入库（幂等合并同 content）。"""
    if not content or not content.strip():
        return load_document(user_id)
    doc = load_document(user_id)
    existing = next((f for f in doc["facts"] if str(f.get("content") or "").strip() == content.strip()), None)
    if existing:
        existing["confirmationCount"] = int(existing.get("confirmationCount") or 0) + 1
        existing["confidence"] = round(min(1.0, float(existing.get("confidence") or 0.5) + 0.1), 2)
        existing["updatedAt"] = _now_iso()
    else:
        doc["facts"].append(_new_fact(content, category, confidence, source_thread))
    _cap_facts(doc)
    return save_document(user_id, doc)


def search(user_id: str, query: str, top_k: int = 5, category: Optional[str] = None) -> List[Dict[str, Any]]:
    """大小写不敏感子串召回（design 指定轻量检索）。"""
    doc = load_document(user_id)
    q = (query or "").strip().lower()
    scored: List[Dict[str, Any]] = []
    for f in doc.get("facts") or []:
        content = str(f.get("content") or "")
        if category and f.get("category") != category:
            continue
        if not q:
            scored.append((0.0, f))
            continue
        cl = content.lower()
        if q in cl:
            # 命中位置越靠前、confidence 越高分越高
            score = 100 - cl.index(q) * 2 + float(f.get("confidence") or 0.5) * 20
            scored.append((score, f))
    scored.sort(key=lambda x: -x[0])
    return [f for _, f in scored[:top_k]]


def get_context(user_id: str, max_injection_chars: int = 1200) -> str:
    """照搬 format_memory_for_injection：按预算逐条拼，保整条不切半。"""
    doc = load_document(user_id)
    lines: List[str] = []
    total = 0
    # preference / correction / decision 优先
    ordered = sorted(
        (f for f in doc.get("facts") or [] if str(f.get("content") or "").strip()),
        key=lambda f: (0 if str(f.get("category")) in ("preference", "correction", "decision") else 1, -float(f.get("confidence") or 0)),
    )
    for f in ordered:
        line = f"- {f.get('content')}"
        if total + len(line) + 1 > max_injection_chars:
            break
        lines.append(line)
        total += len(line) + 1
    summary = str((doc.get("user") or {}).get("personalContext") or {}).strip()
    return "\n".join(lines)


def format_memory_block(user_id: str) -> str:
    ctx = get_context(user_id)
    if not ctx:
        return ""
    return f"<system-reminder>\n<memory>\n{ctx}\n</memory>\n</system-reminder>"


def _cap_facts(doc: Dict[str, Any], limit: int = 60) -> None:
    facts = doc.get("facts") or []
    if len(facts) > limit:
        facts.sort(key=lambda f: (-float(f.get("confidence") or 0), -int(f.get("confirmationCount") or 0)))
        doc["facts"] = facts[:limit]


def _summary_line(doc: Dict[str, Any], key: str, content: str) -> None:
    section = doc.setdefault("user", {}).setdefault(key, {"summary": "", "updatedAt": ""})
    if content:
        section["summary"] = content[:300]
        section["updatedAt"] = _now_iso()


# ── 队列（debounce 异步，不阻塞对话主线程） ─────────────────────────────

class MemoryUpdateQueue:
    """后台线程 debounce 合并写入：add() 入队，worker 合并后批量抽取落盘。"""

    def __init__(self, debounce_s: float = 1.5) -> None:
        self._debounce_s = debounce_s
        self._lock = threading.Lock()
        self._pending: Dict[str, List[Dict[str, Any]]] = {}
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="memory-queue", daemon=True)
        self._thread.start()

    def add(self, user_id: str, messages: List[Dict[str, Any]]) -> None:
        filtered = filter_messages_for_memory(messages)
        if not filtered:
            return
        with self._lock:
            self._pending.setdefault(user_id or "demo", []).extend(filtered)

    def flush_now(self) -> None:
        with self._lock:
            pending = self._pending
            self._pending = {}
        for user_id, messages in pending.items():
            try:
                facts = _extract_facts(messages[-12:])
                doc = load_document(user_id)
                for f in facts:
                    content = str(f.get("content") or "").strip()
                    if not content:
                        continue
                    existing = next((x for x in doc["facts"] if str(x.get("content") or "").strip() == content), None)
                    if existing:
                        existing["confirmationCount"] = int(existing.get("confirmationCount") or 0) + 1
                        existing["confidence"] = round(min(1.0, float(existing.get("confidence") or 0.5) + 0.05), 2)
                        existing["updatedAt"] = _now_iso()
                    else:
                        doc["facts"].append(f)
                _cap_facts(doc)
                save_document(user_id, doc)
            except Exception:
                pass

    def _run(self) -> None:
        while not self._stop.wait(self._debounce_s):
            self.flush_now()

    def shutdown(self) -> None:
        self._stop.set()
        self.flush_now()


_queue = MemoryUpdateQueue()


def queue_conversation(user_id: str, messages: List[Dict[str, Any]]) -> None:
    _queue.add(user_id, messages)


# ── 会话结束 flush（summarization flush hook） ─────────────────────────

def flush_session_to_memory(user_id: str, conversation_id: str, messages: List[Dict[str, Any]]) -> None:
    """会话/run 结束时沉淀关键结论：过滤消息 → 抽取 → 三标签闸 → 入库。

    同时把「绑定数据集/确认口径」类确定性事实直接写入（如用户在本会话确认的指标单位）。
    """
    if not user_id:
        return
    filtered = filter_messages_for_memory(messages[-16:])
    if filtered:
        facts = _extract_facts(filtered)
        doc = load_document(user_id)
        for f in facts:
            content = str(f.get("content") or "").strip()
            if not content:
                continue
            existing = next((x for x in doc["facts"] if str(x.get("content") or "").strip() == content), None)
            if existing:
                existing["confirmationCount"] = int(existing.get("confirmationCount") or 0) + 1
                existing["updatedAt"] = _now_iso()
            else:
                f["source"] = {"type": "conversation", "threadId": conversation_id}
                doc["facts"].append(f)
        _cap_facts(doc)
        save_document(user_id, doc)


def remember_user_choice(user_id: str, content: str, category: str = "preference") -> None:
    """显式记录用户确认的口径/偏好（会话中 memory_add 工具或确认动作触发）。"""
    if not user_id or not content:
        return
    add_fact(user_id, content, category=category, confidence=0.8)


def unit_preference(user_id: str) -> str:
    """从用户记忆事实里识别单位偏好（「金额用万元」「单位用元」…），无则空串。"""
    if not user_id:
        return ""
    try:
        doc = load_document(user_id)
    except Exception:
        return ""
    for f in doc.get("facts") or []:
        content = str(f.get("content") or "")
        if "万" in content or "亿" in content or "千" in content:
            for u in ("万元", "亿元", "千元"):
                if u in content:
                    return u
        if "元" in content and ("用" in content or "单位" in content or "展示" in content):
            return "元"
    return ""
