#!/usr/bin/env python3
"""Export Cursor agent transcripts for this project into a browsable HTML report."""

from __future__ import annotations

import argparse
import difflib
import html
import json
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

WORKSPACE = Path(__file__).resolve().parents[1]
# 本仓库曾在多个本地路径下用 Cursor 打开过；高保最初在 dataease 工作区生成
DEFAULT_TRANSCRIPT_SOURCES = [
    Path.home() / ".cursor/projects/Users-shen-Desktop-dataease-dev-v2/agent-transcripts",
    Path.home() / ".cursor/projects/Users-shen-work-projects-open-dashboard/agent-transcripts",
    Path.home() / ".cursor/projects/Users-shen-backdashboard-open-dashboard/agent-transcripts",
]
SOURCE_LABELS = {
    "Users-shen-Desktop-dataease-dev-v2": "dataease→高保起源",
    "Users-shen-work-projects-open-dashboard": "work/projects",
    "Users-shen-backdashboard-open-dashboard": "backdashboard",
}
DEFAULT_OUT = WORKSPACE / ".cursor-export" / "index.html"
SHARE_ASSETS_SRC = WORKSPACE / "scripts" / "share-assets"
HIFI_PATH_RE = re.compile(
    r"(hi-fi|hifi|dashboard-commercial\.html|dashboard-feishu\.html|"
    r"dashboard-redesign|/prototypes/hi-fi)",
    re.I,
)
HIFI_TOPIC_RE = re.compile(r"(高保|高保真|交互高保|hi-fi|hifi)", re.I)

# 产品落地故事线（给外人完整看「高保 → 调整 → 代码生产」）
JOURNEY_PHASES: list[dict[str, str]] = [
    {
        "id": "p1",
        "no": "01",
        "title": "高保起源：从借鉴到可交互原型",
        "summary": "在 DataEase 工作区重做仪表盘交互，产出飞书风高保 HTML，明确「先交互后工程」的路径。",
        "when": "2026-07-29 ~ 08-03",
    },
    {
        "id": "p2",
        "no": "02",
        "title": "高保打磨：配置、移动端与取数协议",
        "summary": "围绕 commercial 高保细化维度/指标/样式与移动端；同场长对话后半段转入工程脚手架（完整对话见阶段 03）。",
        "when": "2026-08-03 前半",
    },
    {
        "id": "p3",
        "no": "03",
        "title": "代码落地：脚手架与按高保实现",
        "summary": "核心是一场长对话后半段：定 Vue3 + JDK21/Spring Boot + PostgreSQL，拉起前后端脚手架并按高保对齐实现；随后继续做工作台/数据源/数据集/报告/模版等功能迭代。",
        "when": "2026-08-03 后半 ~ 08-05",
    },
    {
        "id": "p4",
        "no": "04",
        "title": "文档与手册：可演进、可交付",
        "summary": "补齐产品需求/设计文档，并产出带截图的 HTML 用户操作手册。",
        "when": "2026-08-05 ~ 08-06",
    },
    {
        "id": "p5",
        "no": "05",
        "title": "部署运行：隔离环境与本地拉起",
        "summary": "排障 500/服务不可用，完成隔离部署与本地拉起验证，形成可演示闭环。",
        "when": "2026-08-06",
    },
]

# 明确挂到故事线各阶段的主会话（子代理跟随父会话）
# 注意：678d7823 是「高保打磨 + 代码落地」同一场长对话，挂在 p3 作为核心落地会话；
# p2 卡片用里程碑/产物预览还原前半段，并交叉链接到该对话。
PHASE_BY_ID_PREFIX: dict[str, str] = {
    "164f68d6": "p1",
    "678d7823": "p3",  # 核心代码落地（含高保打磨前半段）
    "946442a6": "p3",
    "96c0e285": "p3",
    "1fad7f8d": "p3",
    "e1c72f1f": "p3",
    "2658d2de": "p3",
    "589bf73d": "p3",
    "a82c933d": "p3",
    "8da27932": "p3",
    "b3ed3846": "p3",
    "89cdb222": "p3",
    "0aedac34": "p3",
    "2ac21c25": "p3",
    "cff2876a": "p4",
    "299b6465": "p4",
    "fa5272e1": "p4",
    "204757f1": "p5",
    "4c7b5249": "p5",
    "e20b2354": "p5",
    "e7d2030a": "p5",
}

# 会话展示标题覆盖（避免 URL 截断掩盖「落地代码」含义）
TITLE_OVERRIDES: dict[str, str] = {
    "678d7823": "【核心落地】高保打磨 → Vue3/Spring Boot 脚手架与按高保实现（95 轮长对话）",
    "164f68d6": "高保起源：从 DataEase 重做仪表盘交互（feishu/commercial 原型）",
    "1fad7f8d": "生产级规整：清理重复后端与误放的 TS 切片",
    "2658d2de": "工作台按高保实现",
    "e1c72f1f": "高保编辑器接入后的图表展示修复",
    "589bf73d": "业务领域仪表盘模版落地",
    "89cdb222": "在线报告编辑器与引用图表能力打磨",
}

# 阶段卡片上的关键里程碑（帮助外人一眼看到「落地代码」发生在哪）
PHASE_MILESTONES: dict[str, list[str]] = {
    "p2": [
        "commercial 维度/指标/样式/高级配置打磨",
        "移动端预览与多机型切换",
        "与 DataEase getData 协议对比，决策前后端职责",
        "同场对话随后转入「文档定稿 + Vue/Java 脚手架」（见阶段 03）",
    ],
    "p3": [
        "选型：前端 Vue3，后端 JDK21 + Spring Boot + PostgreSQL",
        "v0.3 文档定稿 + 前后端脚手架拉起",
        "按高保对齐：数据源 / 数据集 / 仪表盘 / 报告",
        "Docker/本地跑通后继续功能迭代（工作台、模版、报告编辑器等）",
    ],
}

# p2 虽无独立主会话，但交叉展示这场长对话（实际 phase=p3）
PHASE_CROSS_LINKS: dict[str, list[str]] = {
    "p2": ["678d7823"],
}

# 不属于「产品落地过程」展示的会话（导出工具自身、仓库可见性等）
EXCLUDE_FROM_JOURNEY_RE = re.compile(
    r"(对话和响应信息.*html|cursor-export|仓库设置为隐藏|不让别人能够fork)",
    re.I,
)

# 用于还原高保过程的 git 快照（优先 work/projects 完整历史）
HIFI_GIT_REPOS = [
    Path.home() / "work/projects/open-dashboard",
    WORKSPACE,
]
# phase_id -> 可预览产出物
HIFI_ARTIFACT_SPECS: list[dict[str, str]] = [
    {
        "phase": "p1",
        "id": "feishu-v1",
        "commit": "45deb91",
        "git_path": "frontend/hi-fi/dashboard-feishu.html",
        "vendor_path": "frontend/hi-fi/vendor/echarts.min.js",
        "title": "飞书风高保初版",
        "desc": "高保起源首个可交互产物：dashboard-feishu.html",
        "hash": "",
    },
    {
        "phase": "p1",
        "id": "commercial-v1",
        "commit": "45deb91",
        "git_path": "frontend/hi-fi/dashboard-commercial.html",
        "vendor_path": "frontend/hi-fi/vendor/echarts.min.js",
        "title": "商业化壳初版",
        "desc": "同期 commercial 壳层，后续打磨的起点",
        "hash": "",
    },
    {
        "phase": "p2",
        "id": "commercial-config",
        "commit": "c461877",
        "git_path": "frontend/hi-fi/dashboard-commercial.html",
        "vendor_path": "frontend/hi-fi/vendor/echarts.min.js",
        "title": "图表配置打磨版",
        "desc": "维度/指标/样式等配置细化后的 commercial",
        "hash": "#/dashboard/editor/dash_6ruhs",
    },
    {
        "phase": "p2",
        "id": "commercial-mobile",
        "commit": "06f3b60",
        "git_path": "frontend/hi-fi/dashboard-commercial.html",
        "vendor_path": "frontend/hi-fi/vendor/echarts.min.js",
        "title": "移动端预览版",
        "desc": "接入移动端布局与机型切换后的状态",
        "hash": "#/dashboard/editor/dash_6ruhs",
    },
    {
        "phase": "p2",
        "id": "commercial-workbench",
        "commit": "2658156",
        "git_path": "prototypes/hi-fi/dashboard-commercial.html",
        "vendor_path": "prototypes/hi-fi/vendor/echarts.min.js",
        "title": "迁入 prototypes · 工作台",
        "desc": "高保迁到 prototypes/hi-fi，并具备工作台路由",
        "hash": "#/workbench",
    },
]

TS_RE = re.compile(r"<timestamp>(.*?)</timestamp>", re.DOTALL)
QUERY_RE = re.compile(r"<user_query>\s*(.*?)\s*</user_query>", re.DOTALL)
EDIT_TOOLS = {"Write", "StrReplace", "Delete", "EditNotebook"}


@dataclass
class CodeChange:
    tool: str
    path: str
    old_text: str = ""
    new_text: str = ""
    note: str = ""


@dataclass
class ToolCall:
    name: str
    summary: str
    detail: str = ""


@dataclass
class Message:
    role: str
    texts: list[str] = field(default_factory=list)
    tools: list[ToolCall] = field(default_factory=list)
    changes: list[CodeChange] = field(default_factory=list)
    timestamp: str | None = None


@dataclass
class TurnEnd:
    status: str
    error: str | None = None


@dataclass
class Conversation:
    id: str
    path: Path
    is_subagent: bool
    parent_id: str | None
    title: str
    started_at: str | None
    source_label: str = ""
    messages: list[Message | TurnEnd] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    phase_id: str = ""

    @property
    def request_count(self) -> int:
        return sum(1 for m in self.messages if isinstance(m, Message) and m.role == "user")

    @property
    def response_count(self) -> int:
        return sum(1 for m in self.messages if isinstance(m, Message) and m.role == "assistant" and m.texts)

    @property
    def change_count(self) -> int:
        return sum(
            len(m.changes)
            for m in self.messages
            if isinstance(m, Message)
        )

    @property
    def changed_files(self) -> list[str]:
        seen: list[str] = []
        for m in self.messages:
            if not isinstance(m, Message):
                continue
            for c in m.changes:
                if c.path not in seen:
                    seen.append(c.path)
        return seen

    @property
    def is_hifi(self) -> bool:
        return "高保" in self.tags


def short_path(path: str) -> str:
    p = path.replace("\\", "/")
    prefixes = [
        str(WORKSPACE).replace("\\", "/"),
        str(Path.home() / "work/projects/open-dashboard").replace("\\", "/"),
        str(Path.home() / "backdashboard/open-dashboard").replace("\\", "/"),
        str(Path.home() / "Desktop/dataease-dev-v2").replace("\\", "/"),
    ]
    for ws in prefixes:
        if p.startswith(ws + "/"):
            return p[len(ws) + 1 :]
        if p == ws:
            return "."
    home = str(Path.home()).replace("\\", "/")
    if p.startswith(home + "/"):
        return "~" + p[len(home) :]
    return p


def improve_title(raw_title: str, conv: "Conversation") -> str:
    """Make URL-heavy / truncated titles easier to scan in the sidebar."""
    override = TITLE_OVERRIDES.get(conv.id[:8])
    if override and not conv.is_subagent:
        return override
    t = (raw_title or "").strip()
    t = re.sub(r"^\[高保\]\s*", "", t)
    t = re.sub(r"^(\[subagent\])\s*\[高保\]\s*", r"\1 ", t)
    # Prefer a short label when title is mostly a localhost URL / 高保原型页
    core = t[len("[subagent]") :].lstrip() if t.startswith("[subagent]") else t
    if re.match(r"https?://(127\.0\.0\.1|localhost)", core) or "dashboard-commercial.html" in core:
        if "workbench" in core:
            label = "工作台按高保实现"
            return f"[subagent] {label}" if t.startswith("[subagent]") else label
        if "/dashboard/editor" in core or "dash_" in core:
            label = "仪表盘配置细化（维度/指标/移动端等）"
            return f"[subagent] {label}" if t.startswith("[subagent]") else label
    if conv.is_hifi and core.startswith("这个服务，我们想要借鉴里面的仪表盘"):
        label = "高保起源：从 DataEase 重做仪表盘交互（feishu/commercial 原型）"
        return f"[subagent] {label}" if t.startswith("[subagent]") else label
    return t[:100]


def extract_user_text(raw: str) -> tuple[str | None, str]:
    ts = None
    m = TS_RE.search(raw)
    if m:
        ts = m.group(1).strip()
    q = QUERY_RE.search(raw)
    if q:
        return ts, q.group(1).strip()
    cleaned = TS_RE.sub("", raw)
    cleaned = re.sub(r"</?user_query>", "", cleaned).strip()
    return ts, cleaned


def summarize_tool(name: str, inp: dict[str, Any]) -> tuple[str, str]:
    if name == "Shell":
        cmd = str(inp.get("command") or "")
        return f"$ {cmd[:120]}{'…' if len(cmd) > 120 else ''}", cmd
    if name in ("Read", "Delete"):
        p = short_path(str(inp.get("path") or ""))
        return p, json.dumps(inp, ensure_ascii=False, indent=2)
    if name == "Write":
        p = short_path(str(inp.get("path") or ""))
        return f"Write {p}", p
    if name == "StrReplace":
        p = short_path(str(inp.get("path") or ""))
        return f"StrReplace {p}", p
    if name in ("Grep", "Glob"):
        pattern = inp.get("pattern") or inp.get("glob_pattern") or ""
        path = inp.get("path") or inp.get("target_directory") or ""
        return f"{pattern}  @ {short_path(str(path)) if path else '.'}", json.dumps(
            inp, ensure_ascii=False, indent=2
        )
    if name == "Task":
        return str(inp.get("description") or inp.get("prompt") or "Task")[:140], json.dumps(
            inp, ensure_ascii=False, indent=2
        )
    try:
        blob = json.dumps(inp, ensure_ascii=False)
    except TypeError:
        blob = str(inp)
    return f"{name}: {blob[:120]}{'…' if len(blob) > 120 else ''}", blob


def parse_code_change(name: str, inp: dict[str, Any]) -> CodeChange | None:
    if name == "StrReplace":
        return CodeChange(
            tool="StrReplace",
            path=short_path(str(inp.get("path") or "")),
            old_text=str(inp.get("old_string") or ""),
            new_text=str(inp.get("new_string") or ""),
        )
    if name == "Write":
        return CodeChange(
            tool="Write",
            path=short_path(str(inp.get("path") or "")),
            old_text="",
            new_text=str(inp.get("contents") or ""),
            note="新建/覆写文件",
        )
    if name == "Delete":
        return CodeChange(
            tool="Delete",
            path=short_path(str(inp.get("path") or "")),
            note="删除文件",
        )
    if name == "EditNotebook":
        return CodeChange(
            tool="EditNotebook",
            path=short_path(str(inp.get("target_notebook") or "")),
            old_text=str(inp.get("old_string") or ""),
            new_text=str(inp.get("new_string") or ""),
            note=f"cell {inp.get('cell_idx')}",
        )
    return None


def parse_message(obj: dict[str, Any]) -> Message | TurnEnd | None:
    if obj.get("type") == "turn_ended":
        return TurnEnd(status=str(obj.get("status") or "unknown"), error=obj.get("error"))

    role = obj.get("role")
    if role not in ("user", "assistant"):
        return None

    msg = Message(role=role)
    content = (obj.get("message") or {}).get("content") or []
    if isinstance(content, str):
        content = [{"type": "text", "text": content}]

    for part in content:
        if not isinstance(part, dict):
            continue
        ptype = part.get("type")
        if ptype == "text":
            text = str(part.get("text") or "")
            if role == "user":
                ts, body = extract_user_text(text)
                msg.timestamp = ts or msg.timestamp
                if body:
                    msg.texts.append(body)
            else:
                if text.strip():
                    msg.texts.append(text.strip())
        elif ptype == "tool_use":
            name = str(part.get("name") or "tool")
            inp = part.get("input") or {}
            if not isinstance(inp, dict):
                inp = {"value": inp}
            if name in EDIT_TOOLS:
                change = parse_code_change(name, inp)
                if change:
                    msg.changes.append(change)
            summary, detail = summarize_tool(name, inp)
            msg.tools.append(ToolCall(name=name, summary=summary, detail=detail))
    return msg


def source_label_for(root: Path) -> str:
    for part in root.parts:
        if part in SOURCE_LABELS:
            return SOURCE_LABELS[part]
    return root.parent.name if root.name == "agent-transcripts" else root.name


def load_conversation(jsonl_path: Path, root: Path) -> Conversation:
    rel = jsonl_path.relative_to(root)
    parts = rel.parts
    is_subagent = "subagents" in parts
    parent_id = parts[0] if is_subagent else None
    conv_id = jsonl_path.stem

    messages: list[Message | TurnEnd] = []
    title = conv_id[:8]
    started_at = None

    for line in jsonl_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        parsed = parse_message(obj)
        if parsed is None:
            continue
        if isinstance(parsed, Message) and parsed.role == "user" and parsed.texts and title == conv_id[:8]:
            title = parsed.texts[0].splitlines()[0][:80]
            started_at = parsed.timestamp
        messages.append(parsed)

    if is_subagent:
        title = f"[subagent] {title}"

    conv = Conversation(
        id=conv_id,
        path=jsonl_path,
        is_subagent=is_subagent,
        parent_id=parent_id,
        title=title,
        started_at=started_at,
        source_label=source_label_for(root),
        messages=messages,
    )
    annotate_conversation(conv)
    return conv


def annotate_conversation(conv: Conversation) -> None:
    """Tag hi-fi sessions and normalize display titles."""
    hifi_edits = 0
    user_topic = False
    for item in conv.messages:
        if not isinstance(item, Message):
            continue
        if item.role == "user":
            for text in item.texts:
                if HIFI_TOPIC_RE.search(text) or HIFI_PATH_RE.search(text):
                    user_topic = True
        for c in item.changes:
            if HIFI_PATH_RE.search(c.path):
                hifi_edits += 1
    # 仅当用户聊高保，或实际改过 hi-fi / commercial / feishu 原型文件时打标
    # （避免工具偶然扫到 prototypes/hi-fi 就整会话标成高保）
    if hifi_edits or user_topic or (
        conv.source_label.startswith("dataease") and hifi_edits
    ):
        if "高保" not in conv.tags:
            conv.tags.append("高保")
    conv.title = improve_title(conv.title, conv)


# 明显不属于 open-dashboard 产品的话题（即便开在该 workspace 里）
UNRELATED_QUERY_RE = re.compile(
    r"(jenkins|harbor|#\s*docker\s+ps|manage系统|WLPayment|openclaw|"
    r"provider\s+balance|ClawSweeper)",
    re.I,
)
DASHBOARD_SIGNAL_RE = re.compile(
    r"(open-dashboard|backdashboard|dashboard-redesign|/dashboards?/|/datasets?/|/datasources?/|"
    r"/reports?/|/workbench|dashboard-commercial|dashboard-feishu|hi-fi|hifi|仪表盘|数据集|数据源|"
    r"看板|报告编辑|用户手册|chartQuery|datasetQuery|Umo|高保|"
    r"127\.0\.0\.1:5173|127\.0\.0\.1:808[02]|localhost:8765|"
    r"dataease-dev-v2.*仪表盘|重新设计仪表盘)",
    re.I,
)


def conversation_probe_text(conv: Conversation, max_user_msgs: int = 3) -> str:
    """First user queries + early assistant/tool path hints for classification."""
    parts: list[str] = []
    user_n = 0
    for item in conv.messages:
        if not isinstance(item, Message):
            continue
        if item.role == "user":
            user_n += 1
            if user_n <= max_user_msgs:
                parts.extend(item.texts)
            if user_n == 1:
                # always keep first query separately weighted via full join
                pass
        elif item.role == "assistant" and user_n <= 1:
            parts.extend(item.texts[:1])
            for t in item.tools[:12]:
                parts.append(t.summary)
                parts.append(t.detail[:240])
            for c in item.changes[:8]:
                parts.append(c.path)
        if user_n >= max_user_msgs and len(parts) > 20:
            break
    return "\n".join(parts)


def is_dashboard_related(conv: Conversation) -> bool:
    """Keep only open-dashboard / 仪表盘 / 高保原型相关会话。"""
    first_user = ""
    for item in conv.messages:
        if isinstance(item, Message) and item.role == "user" and item.texts:
            first_user = item.texts[0]
            break

    # 首问就是无关运维/别的系统 → 排除（即使工具扫过 hi-fi 路径）
    if first_user and UNRELATED_QUERY_RE.search(first_user):
        if not re.search(
            r"(open-dashboard|backdashboard|仪表盘|/dashboards?|高保真|交互高保)",
            first_user,
            re.I,
        ):
            return False

    # 高保文件改动或明确高保话题：保留（含 dataease 起源会话）
    if conv.is_hifi:
        return True

    probe = conversation_probe_text(conv)
    title = conv.title or ""
    blob = f"{title}\n{first_user}\n{probe}"
    if DASHBOARD_SIGNAL_RE.search(blob):
        return True

    # 子代理若正文很短，看路径是否落在仓库内
    if conv.is_subagent:
        for item in conv.messages:
            if not isinstance(item, Message):
                continue
            for t in item.tools:
                if "open-dashboard" in t.detail or "open-dashboard" in t.summary:
                    return True
                if "backdashboard" in t.detail or "backdashboard" in t.summary:
                    return True
                if "dashboard-redesign" in t.detail or "dashboard-redesign" in t.summary:
                    return True
    return False


def first_user_text(conv: Conversation) -> str:
    for item in conv.messages:
        if isinstance(item, Message) and item.role == "user" and item.texts:
            return item.texts[0]
    return ""


def assign_phase(conv: Conversation, id_to_phase: dict[str, str]) -> str:
    prefix = conv.id[:8]
    if prefix in PHASE_BY_ID_PREFIX:
        return PHASE_BY_ID_PREFIX[prefix]
    if conv.parent_id:
        parent_phase = id_to_phase.get(conv.parent_id) or PHASE_BY_ID_PREFIX.get(conv.parent_id[:8], "")
        if parent_phase:
            return parent_phase
    if conv.source_label.startswith("dataease") or conv.is_hifi and "dashboard-feishu" in " ".join(
        c.path for m in conv.messages if isinstance(m, Message) for c in m.changes
    ):
        return "p1"
    # 时间启发式兜底
    started = conv.started_at or ""
    if "Jul 29" in started or "July 29" in started:
        return "p1"
    if "Aug 3" in started:
        return "p2"
    if "Aug 5" in started:
        blob = first_user_text(conv) + " " + conv.title
        if re.search(r"(手册|需求|设计文档|docs/)", blob):
            return "p4"
        return "p3"
    if "Aug 6" in started:
        blob = first_user_text(conv) + " " + conv.title
        if re.search(r"(手册|help/|需求|设计文档)", blob):
            return "p4"
        if re.search(r"(部署|拉起|500|访问不了|docker|隔离)", blob):
            return "p5"
        return "p3"
    return "p3"


def is_journey_excluded(conv: Conversation) -> bool:
    blob = f"{conv.title}\n{first_user_text(conv)}"
    return bool(EXCLUDE_FROM_JOURNEY_RE.search(blob))


def filter_dashboard_conversations(conversations: list[Conversation]) -> list[Conversation]:
    related = [c for c in conversations if is_dashboard_related(c) and not is_journey_excluded(c)]
    related_ids = {c.id for c in related}
    kept: list[Conversation] = []
    for c in related:
        if c.is_subagent and c.parent_id and c.parent_id not in related_ids:
            parent = next((x for x in conversations if x.id == c.parent_id), None)
            if parent is not None and (
                not is_dashboard_related(parent) or is_journey_excluded(parent)
            ):
                continue
        kept.append(c)

    kept_ids = {c.id for c in kept}
    for c in conversations:
        if c.id in kept_ids:
            continue
        if c.is_subagent and c.parent_id in kept_ids and not is_journey_excluded(c):
            kept.append(c)
            kept_ids.add(c.id)

    # 先按显式映射赋阶段，再处理子代理跟随
    id_to_phase: dict[str, str] = {}
    for c in kept:
        if not c.is_subagent:
            c.phase_id = assign_phase(c, id_to_phase)
            id_to_phase[c.id] = c.phase_id
    for c in kept:
        if c.is_subagent:
            c.phase_id = assign_phase(c, id_to_phase)
            id_to_phase[c.id] = c.phase_id

    phase_order = {p["id"]: i for i, p in enumerate(JOURNEY_PHASES)}

    def sort_key(c: Conversation) -> tuple:
        return (
            phase_order.get(c.phase_id, 99),
            1 if c.is_subagent else 0,
            c.started_at or "",
            c.path.stat().st_mtime,
        )

    return sorted(kept, key=sort_key)


def discover_conversations(roots: list[Path], dashboard_only: bool = True) -> list[Conversation]:
    """Load from multiple Cursor project dirs; prefer larger file on duplicate id."""
    by_id: dict[str, Conversation] = {}
    for root in roots:
        if not root.is_dir():
            continue
        files = sorted(root.rglob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
        for path in files:
            conv = load_conversation(path, root)
            prev = by_id.get(conv.id)
            if prev is None:
                by_id[conv.id] = conv
                continue
            # Prefer larger file; if tie, prefer the one with correct subagent parent linkage
            if path.stat().st_size > prev.path.stat().st_size:
                by_id[conv.id] = conv
            elif path.stat().st_size == prev.path.stat().st_size and conv.is_subagent and not prev.is_subagent:
                by_id[conv.id] = conv

    conversations = list(by_id.values())
    if dashboard_only:
        before = len(conversations)
        conversations = filter_dashboard_conversations(conversations)
        print(
            f"Filtered dashboard-related: {len(conversations)}/{before} conversations",
            file=sys.stderr,
        )
    else:
        def sort_key(c: Conversation) -> tuple:
            return (c.started_at or "", c.path.stat().st_mtime)

        conversations = sorted(conversations, key=sort_key, reverse=True)
    return conversations


def collapsible_block(summary: str, body_html: str, *, css_class: str = "", open_by_default: bool = False) -> str:
    op = " open" if open_by_default else ""
    cls = f" fold-block {css_class}".strip()
    return (
        f'<details class="{cls}"{op}>'
        f"<summary>{summary}</summary>"
        f'<div class="fold-body">{body_html}</div>'
        f"</details>"
    )


def unified_diff_html(path: str, old: str, new: str, tool: str) -> str:
    if tool == "Delete":
        meta = f"删除 <code>{html.escape(path)}</code>"
        body = '<pre class="diff del-only">（文件已删除）</pre>'
        return collapsible_block(meta, body, css_class="fold-diff", open_by_default=True)

    old_lines = old.splitlines()
    new_lines = new.splitlines()
    if tool == "Write" and not old:
        rows = [f'<span class="add">+ {html.escape(line)}</span>' for line in new_lines]
        body = "\n".join(rows) or '<span class="ctx">（空文件）</span>'
        summary = (
            f'<span class="badge write">Write</span> '
            f"<code>{html.escape(path)}</code> · +{len(new_lines)} 行 · 点击展开代码"
        )
        return collapsible_block(
            summary,
            f'<pre class="diff">{body}</pre>',
            css_class="fold-diff",
            open_by_default=len(new_lines) <= 20,
        )

    diff = list(
        difflib.unified_diff(
            old_lines,
            new_lines,
            fromfile=f"a/{path}",
            tofile=f"b/{path}",
            lineterm="",
            n=3,
        )
    )
    if not diff:
        return (
            f'<div class="diff-meta"><span class="badge">{html.escape(tool)}</span> '
            f"<code>{html.escape(path)}</code> · 无文本差异</div>"
        )

    rendered: list[str] = []
    add_n = del_n = 0
    for line in diff:
        if line.startswith("+++") or line.startswith("---"):
            rendered.append(f'<span class="file">{html.escape(line)}</span>')
        elif line.startswith("@@"):
            rendered.append(f'<span class="hunk">{html.escape(line)}</span>')
        elif line.startswith("+"):
            add_n += 1
            rendered.append(f'<span class="add">{html.escape(line)}</span>')
        elif line.startswith("-"):
            del_n += 1
            rendered.append(f'<span class="del">{html.escape(line)}</span>')
        else:
            rendered.append(f'<span class="ctx">{html.escape(line)}</span>')

    diff_body = "\n".join(rendered)
    summary = (
        f'<span class="badge replace">{html.escape(tool)}</span> '
        f"<code>{html.escape(path)}</code> · "
        f'<span class="add-n">+{add_n}</span> / <span class="del-n">-{del_n}</span>'
        f" · 点击展开 diff"
    )
    return collapsible_block(
        summary,
        f'<pre class="diff">{diff_body}</pre>',
        css_class="fold-diff",
        open_by_default=(add_n + del_n) <= 12,
    )


def mdish_to_html(text: str) -> str:
    """Lightweight formatting: escape, preserve paragraphs, fenced code."""
    parts: list[str] = []
    chunks = re.split(r"(```[\s\S]*?```)", text)
    for chunk in chunks:
        if chunk.startswith("```") and chunk.endswith("```"):
            inner = chunk[3:-3]
            if "\n" in inner:
                lang, _, body = inner.partition("\n")
                lang = lang.strip()
                code = body.rstrip("\n")
            else:
                lang, code = "", inner
            nlines = code.count("\n") + (1 if code else 0)
            code_html = (
                f'<pre class="code"><code class="lang-{html.escape(lang)}">'
                f"{html.escape(code)}</code></pre>"
            )
            if nlines > 12 or len(code) > 800:
                label = f"代码块 {html.escape(lang or 'text')} · {nlines} 行 · 点击展开"
                parts.append(
                    collapsible_block(label, code_html, css_class="fold-code", open_by_default=False)
                )
            else:
                parts.append(code_html)
        else:
            esc = html.escape(chunk)
            esc = re.sub(r"`([^`]+)`", r"<code>\1</code>", esc)
            esc = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", esc)
            paras = [p.strip() for p in re.split(r"\n\s*\n", esc) if p.strip()]
            for p in paras:
                parts.append(f"<p>{p.replace(chr(10), '<br>')}</p>")
    return "\n".join(parts) if parts else "<p></p>"


def git_show(repo: Path, commit: str, rel_path: str) -> bytes | None:
    try:
        proc = subprocess.run(
            ["git", "-C", str(repo), "show", f"{commit}:{rel_path}"],
            capture_output=True,
            check=False,
        )
    except OSError:
        return None
    if proc.returncode != 0:
        return None
    return proc.stdout


def prepare_hifi_artifacts(out_dir: Path) -> list[dict[str, str]]:
    """Materialize hi-fi HTML snapshots next to index.html for iframe preview."""
    repo = next((p for p in HIFI_GIT_REPOS if (p / ".git").exists()), None)
    if repo is None:
        print("未找到含 git 历史的 open-dashboard 仓库，跳过高保快照", file=sys.stderr)
        return []

    ready: list[dict[str, str]] = []
    for spec in HIFI_ARTIFACT_SPECS:
        dest_dir = out_dir / "artifacts" / spec["phase"] / spec["id"]
        dest_dir.mkdir(parents=True, exist_ok=True)
        html_bytes = git_show(repo, spec["commit"], spec["git_path"])
        vendor_bytes = git_show(repo, spec["commit"], spec["vendor_path"])
        if html_bytes is None:
            # fallback: current workspace file by basename
            local = WORKSPACE / "prototypes/hi-fi" / Path(spec["git_path"]).name
            if local.exists():
                html_bytes = local.read_bytes()
                vlocal = WORKSPACE / "prototypes/hi-fi/vendor/echarts.min.js"
                vendor_bytes = vlocal.read_bytes() if vlocal.exists() else None
            else:
                print(f"跳过快照 {spec['id']}: 无法读取 {spec['commit']}:{spec['git_path']}", file=sys.stderr)
                continue

        dest_html = dest_dir / "index.html"
        dest_html.write_bytes(html_bytes)
        if vendor_bytes is not None:
            vendor_dir = dest_dir / "vendor"
            vendor_dir.mkdir(exist_ok=True)
            dest_vendor = vendor_dir / "echarts.min.js"
            dest_vendor.write_bytes(vendor_bytes)
            # rewrite relative vendor path if HTML expects vendor/echarts.min.js
        rel = f"artifacts/{spec['phase']}/{spec['id']}/index.html{spec.get('hash') or ''}"
        item = dict(spec)
        item["href"] = rel
        ready.append(item)
        print(f"Artifact {spec['id']} <- {repo.name}@{spec['commit'][:7]}", file=sys.stderr)
    return ready


def render_message(msg: Message, idx: int) -> str:
    if msg.role == "user":
        body = "\n\n".join(msg.texts)
        meta = html.escape(msg.timestamp or "")
        return f"""
<article class="card request" id="msg-{idx}">
  <header>
    <span class="pill req">请求</span>
    <span class="meta">{meta}</span>
  </header>
  <div class="body">{mdish_to_html(body)}</div>
</article>"""

    texts_html = "".join(f'<div class="assistant-text">{mdish_to_html(t)}</div>' for t in msg.texts)
    if not texts_html and not msg.changes and msg.tools:
        texts_html = '<div class="assistant-text muted"><p>（本步仅工具调用，无正文回复）</p></div>'

    tools_html = ""
    if msg.tools:
        items = []
        for t in msg.tools:
            edit_cls = " edit" if t.name in EDIT_TOOLS else ""
            items.append(
                f'<details class="tool{edit_cls}"><summary>'
                f'<span class="tool-name">{html.escape(t.name)}</span> '
                f'<span class="tool-sum">{html.escape(t.summary)}</span>'
                f"</summary><pre>{html.escape(t.detail)}</pre></details>"
            )
        tools_html = f'<div class="tools"><h4>工具调用 · {len(msg.tools)}</h4>{"".join(items)}</div>'

    changes_html = ""
    if msg.changes:
        blocks = [unified_diff_html(c.path, c.old_text, c.new_text, c.tool) for c in msg.changes]
        inner = "".join(f'<div class="change-block">{b}</div>' for b in blocks)
        if len(msg.changes) > 3:
            changes_html = (
                f'<div class="changes">'
                + collapsible_block(
                    f"代码变更 · {len(msg.changes)} 处（默认折叠，点击展开）",
                    inner,
                    css_class="fold-changes",
                    open_by_default=False,
                )
                + "</div>"
            )
        else:
            changes_html = f'<div class="changes"><h4>代码变更 · {len(msg.changes)}</h4>{inner}</div>'

    label = "响应" if msg.texts else "助手步骤"
    return f"""
<article class="card response" id="msg-{idx}">
  <header>
    <span class="pill res">{label}</span>
    <span class="meta">tools {len(msg.tools)} · edits {len(msg.changes)}</span>
  </header>
  {texts_html}
  {changes_html}
  {tools_html}
</article>"""


def render_turn_end(te: TurnEnd, idx: int) -> str:
    cls = "ok" if te.status == "success" else "err"
    err = f" — {html.escape(te.error)}" if te.error else ""
    return (
        f'<div class="turn-end {cls}" id="msg-{idx}">'
        f"turn_ended: {html.escape(te.status)}{err}</div>"
    )


def render_user_questions(conv: Conversation) -> str:
    """List all user questions under the conversation header for quick scanning."""
    items: list[str] = []
    qn = 0
    for i, item in enumerate(conv.messages):
        if not isinstance(item, Message) or item.role != "user" or not item.texts:
            continue
        qn += 1
        body = "\n\n".join(item.texts).strip()
        # skip noisy system-ish followups
        if body.startswith("Briefly inform the user about the task result"):
            continue
        preview = body
        if len(preview) > 280:
            preview = preview[:280].rstrip() + "…"
        when = html.escape(item.timestamp or "")
        time_html = f'<span class="q-time">{when}</span>' if when else ""
        items.append(
            f'<li class="q-item">'
            f'<a class="q-link" href="#msg-{i}">'
            f'<span class="q-no">Q{qn}</span>'
            f'<span class="q-text">{html.escape(preview)}</span>'
            f"{time_html}"
            f"</a></li>"
        )
    if not items:
        return "<p class='muted'>本会话没有解析到用户提问</p>"
    return f"<ol class='question-list'>{''.join(items)}</ol>"


def render_conversation(conv: Conversation) -> str:
    parts = []
    for i, item in enumerate(conv.messages):
        if isinstance(item, TurnEnd):
            parts.append(render_turn_end(item, i))
        else:
            parts.append(render_message(item, i))
    files = conv.changed_files
    files_html = (
        "<ul class='file-list'>"
        + "".join(f"<li><code>{html.escape(f)}</code></li>" for f in files)
        + "</ul>"
        if files
        else "<p class='muted'>本会话无 Write / StrReplace / Delete</p>"
    )
    questions_html = render_user_questions(conv)
    q_count = sum(
        1
        for item in conv.messages
        if isinstance(item, Message)
        and item.role == "user"
        and item.texts
        and not "\n".join(item.texts).startswith("Briefly inform the user about the task result")
    )
    return f"""
<section class="conversation" data-id="{html.escape(conv.id)}" data-phase="{html.escape(conv.phase_id)}" hidden>
  <div class="conv-head">
    <h2>{html.escape(conv.title)}</h2>
    <div class="stats">
      <span>来源 <code>{html.escape(conv.source_label)}</code></span>
      <span>ID <code>{html.escape(conv.id)}</code></span>
      <span>请求 {conv.request_count}</span>
      <span>有正文响应 {conv.response_count}</span>
      <span>代码变更 {conv.change_count}</span>
      {f"<span class='tag phase'>阶段 {html.escape(conv.phase_id)}</span>" if conv.phase_id else ""}
      {"<span class='tag hifi'>高保</span>" if conv.is_hifi else ""}
      {"<span class='tag sub'>subagent</span>" if conv.is_subagent else ""}
      {f"<span>父会话 <code>{html.escape(conv.parent_id)}</code></span>" if conv.parent_id else ""}
    </div>
    <p class="conv-tip muted">以下为该场对话的完整细节：用户请求、助手响应、工具调用与代码变更 diff。</p>
    <div class="files-box">
      <h3>变更文件</h3>
      {files_html}
    </div>
    <div class="files-box questions-box">
      <h3>我问过的问题 · {q_count}</h3>
      <p class="muted tiny">按时间顺序列出本场全部用户提问，点击可跳到对应对话位置。</p>
      {questions_html}
    </div>
  </div>
  <div class="timeline">
    {"".join(parts)}
  </div>
</section>"""


def render_nav(conversations: list[Conversation]) -> str:
    by_phase: dict[str, list[Conversation]] = {p["id"]: [] for p in JOURNEY_PHASES}
    by_id = {c.id: c for c in conversations}
    for conv in conversations:
        by_phase.setdefault(conv.phase_id or "p3", []).append(conv)

    blocks: list[str] = []
    for phase in JOURNEY_PHASES:
        items_html: list[str] = []
        mains = [c for c in by_phase.get(phase["id"], []) if not c.is_subagent]
        mains.sort(key=lambda c: (0 if c.id.startswith("678d7823") else 1, c.started_at or ""))
        # p2 交叉展示核心长对话入口
        extra: list[Conversation] = []
        for prefix in PHASE_CROSS_LINKS.get(phase["id"], []):
            c = next((x for x in by_id.values() if x.id.startswith(prefix) and not x.is_subagent), None)
            if c and c not in mains:
                extra.append(c)
        for conv in mains + extra:
            mark = " ✎" if conv.change_count else ""
            hifi = " hifi" if conv.is_hifi else ""
            when = html.escape(conv.started_at or "")
            src = html.escape(conv.source_label or "")
            tag = '<span class="tag-hifi">高保</span> ' if conv.is_hifi else ""
            children = [
                c
                for c in by_phase.get(phase["id"], [])
                if c.is_subagent and c.parent_id == conv.id
            ]
            child_btns = []
            for ch in children:
                child_btns.append(
                    f'<button type="button" class="nav-item sub" data-id="{html.escape(ch.id)}" '
                    f'data-phase="{html.escape(phase["id"])}" data-hifi="{"1" if ch.is_hifi else "0"}">'
                    f'<span class="nav-title">{html.escape(ch.title)}</span>'
                    f'<span class="nav-meta">req {ch.request_count} · edit {ch.change_count}</span>'
                    f"</button>"
                )
            kids = ""
            if child_btns:
                kids = (
                    f'<button type="button" class="nav-toggle" data-toggle-kids>'
                    f"▸ 子代理 {len(child_btns)}</button>"
                    f'<div class="nav-children">{"".join(child_btns)}</div>'
                )
            items_html.append(
                f'<div class="nav-group">'
                f'<button type="button" class="nav-item{hifi}" data-id="{html.escape(conv.id)}" '
                f'data-phase="{html.escape(phase["id"])}" data-hifi="{"1" if conv.is_hifi else "0"}">'
                f'<span class="nav-title">{tag}{html.escape(conv.title)}{mark}</span>'
                f'<span class="nav-meta">'
                f'<span class="src">{src}</span> · req {conv.request_count} · edit {conv.change_count}'
                f"{(' · ' + when) if when else ''}</span>"
                f"</button>{kids}</div>"
            )
        items_block = "".join(items_html) if items_html else '<p class="muted tiny">暂无</p>'
        blocks.append(
            f'<section class="phase-nav" data-phase="{html.escape(phase["id"])}">'
            f'<button type="button" class="phase-head" data-phase-jump="{html.escape(phase["id"])}">'
            f'<span class="phase-no">{html.escape(phase["no"])}</span>'
            f'<span class="phase-title">{html.escape(phase["title"])}</span>'
            f'<span class="phase-count">{len(mains)} 场主对话</span>'
            f"</button>"
            f'<div class="phase-items">{items_block}</div>'
            f"</section>"
        )
    return "\n".join(blocks)


def render_artifact_preview(phase_id: str, artifacts: list[dict[str, str]]) -> str:
    items = [a for a in artifacts if a.get("phase") == phase_id]
    if not items:
        return ""
    tabs = []
    panes = []
    for i, a in enumerate(items):
        active = " active" if i == 0 else ""
        hidden = "" if i == 0 else " hidden"
        tabs.append(
            f'<button type="button" class="art-tab{active}" data-art="{html.escape(a["id"])}">'
            f'{html.escape(a["title"])}</button>'
        )
        panes.append(
            f'<div class="art-pane{active}" data-art-pane="{html.escape(a["id"])}"{hidden}>'
            f'<div class="art-meta"><div><strong>{html.escape(a["title"])}</strong>'
            f'<p>{html.escape(a["desc"])}</p>'
            f'<p class="muted tiny">git {html.escape(a["commit"])} · {html.escape(a["git_path"])}</p></div>'
            f'<div class="art-actions">'
            f'<a class="art-link" href="{html.escape(a["href"])}" target="_blank" rel="noopener">新窗口打开</a>'
            f"</div></div>"
            f'<div class="art-frame-wrap">'
            f'<iframe class="art-frame" title="{html.escape(a["title"])}" '
            f'src="{html.escape(a["href"])}" loading="lazy"></iframe>'
            f"</div></div>"
        )
    return (
        f'<div class="artifacts" data-phase-artifacts="{html.escape(phase_id)}">'
        f"<h4>本阶段产出物预览</h4>"
        f'<p class="muted tiny">从 git 历史取出当时高保 HTML，尽量还原该阶段可交互效果（需本地打开本导出目录）。</p>'
        f'<div class="art-tabs">{"".join(tabs)}</div>'
        f'{"".join(panes)}</div>'
    )


def render_story_overview(
    conversations: list[Conversation], artifacts: list[dict[str, str]] | None = None
) -> str:
    artifacts = artifacts or []
    mains = [c for c in conversations if not c.is_subagent]
    by_id = {c.id: c for c in conversations}
    total_req = sum(c.request_count for c in conversations)
    total_chg = sum(c.change_count for c in conversations)
    cards = []
    for phase in JOURNEY_PHASES:
        pmains = [c for c in mains if c.phase_id == phase["id"]]
        # 核心落地会话置顶
        pmains.sort(key=lambda c: (0 if c.id.startswith("678d7823") else 1, c.started_at or ""))
        req = sum(c.request_count for c in conversations if c.phase_id == phase["id"])
        chg = sum(c.change_count for c in conversations if c.phase_id == phase["id"])

        milestones = PHASE_MILESTONES.get(phase["id"], [])
        miles_html = ""
        if milestones:
            miles_html = (
                "<div class='milestones'><h4>关键里程碑</h4><ol>"
                + "".join(f"<li>{html.escape(m)}</li>" for m in milestones)
                + "</ol></div>"
            )

        # 交叉链接：p2 展示实际挂在 p3 的长对话
        cross_ids = PHASE_CROSS_LINKS.get(phase["id"], [])
        cross_html = ""
        if cross_ids:
            links = []
            for cid_prefix in cross_ids:
                conv = next((c for c in mains if c.id.startswith(cid_prefix)), None)
                if not conv:
                    # try full id match / any conversation
                    conv = next((c for c in by_id.values() if c.id.startswith(cid_prefix) and not c.is_subagent), None)
                if not conv:
                    continue
                links.append(
                    f'<li><button type="button" class="story-link core" data-id="{html.escape(conv.id)}">'
                    f"{html.escape(conv.title[:90])}"
                    f"<span>同场长对话 · 完整记录在阶段 03 · req {conv.request_count} · edit {conv.change_count}</span>"
                    f"</button></li>"
                )
            if links:
                cross_html = (
                    "<div class='cross-links'><h4>关联长对话（高保打磨 + 代码落地为同一场）</h4>"
                    f"<ol class='phase-sessions'>{''.join(links)}</ol></div>"
                )

        sess = "".join(
            f'<li><button type="button" class="story-link{" core" if c.id.startswith("678d7823") else ""}" '
            f'data-id="{html.escape(c.id)}">'
            f"{html.escape(c.title[:90])}"
            f'<span>req {c.request_count} · edit {c.change_count}</span></button></li>'
            for c in pmains
        )
        sessions_block = ""
        if sess:
            sessions_block = f"<h4 class='sess-h'>本阶段对话</h4><ol class='phase-sessions'>{sess}</ol>"
        elif not cross_html:
            sessions_block = "<p class='muted'>本阶段主要通过产物预览与里程碑还原；对话细节见相邻阶段。</p>"

        preview = render_artifact_preview(phase["id"], artifacts)
        cards.append(
            f'<article class="phase-card" id="phase-{html.escape(phase["id"])}">'
            f'<header><span class="phase-no">{html.escape(phase["no"])}</span>'
            f"<div><h3>{html.escape(phase['title'])}</h3>"
            f'<p class="when">{html.escape(phase["when"])}</p></div></header>'
            f'<p class="summary">{html.escape(phase["summary"])}</p>'
            f'<div class="phase-stats"><span>{len(pmains)} 场主对话</span>'
            f"<span>{req} 次请求</span><span>{chg} 处代码变更</span></div>"
            f"{miles_html}"
            f"{preview}"
            f"{cross_html}"
            f"{sessions_block}"
            f'<button type="button" class="phase-open" data-phase-jump="{html.escape(phase["id"])}">'
            f"查看本阶段对话细节</button></article>"
        )
    tip = (
        "<p class=\"lede-note\">提示：长代码 / diff 默认折叠；阶段 01–02 可直接预览当时高保产出。"
        "若 iframe 空白，请在 <code>.cursor-export</code> 目录执行 "
        "<code>python3 -m http.server 8765</code> 后访问。</p>"
    )
    return f"""
<div id="story" class="story">
  <header class="story-hero">
    <p class="eyebrow">Open Dashboard · 产品落地实录</p>
    <h2>从高保交互，到可运行的代码产品</h2>
    <p class="lede">
      这份页面按真实 Cursor 对话还原落地过程：先做可交互高保，再打磨配置与协议，
      然后接入 Vue3 / Spring Boot 工程并完成功能开发，最后补齐文档手册与部署验证。
      每一场对话都保留完整请求、响应、工具调用与代码 diff，便于对外完整展示。
    </p>
    <p class="lede-note">
      对外分享请先看
      <button type="button" class="text-link" data-show-share>可分享方法论</button>
      ：把本实录与「原型驱动 / Skills」对齐说明写在一起；下面阶段卡片是证据与案例库。
    </p>
    {tip}
    <div class="hero-stats">
      <div><strong>{len(JOURNEY_PHASES)}</strong><span>个阶段</span></div>
      <div><strong>{len(mains)}</strong><span>场主对话</span></div>
      <div><strong>{total_req}</strong><span>次请求</span></div>
      <div><strong>{total_chg}</strong><span>处代码变更</span></div>
    </div>
  </header>
  <div class="phase-grid">{"".join(cards)}</div>
</div>
"""


def _share_fig(src: str, caption: str, *, wide: bool = False) -> str:
    cls = "fig wide" if wide else "fig"
    return (
        f'<figure class="{cls}">'
        f'<img src="{html.escape(src)}" alt="{html.escape(caption)}" loading="eager">'
        f"<figcaption>{caption}</figcaption>"
        f"</figure>"
    )


def _flow_node(title: str, sub: str = "", *, kind: str = "") -> str:
    k = f" {kind}" if kind else ""
    sub_html = f'<span class="fn-sub">{html.escape(sub)}</span>' if sub else ""
    return (
        f'<div class="flow-node{k}">'
        f'<span class="fn-title">{html.escape(title)}</span>{sub_html}'
        f"</div>"
    )


def _flow_arrow(label: str = "") -> str:
    lab = f'<span class="fa-label">{html.escape(label)}</span>' if label else ""
    return f'<div class="flow-arrow" aria-hidden="true">{lab}<span class="fa-line"></span></div>'


def _diagram_caption(text: str) -> str:
    return f'<p class="diagram-cap">{text}</p>'


def diagram_fidelity_spectrum() -> str:
    # Matt's five nouns, low → high (Don't waste time on specs)
    steps = [
        ("Discussion", "讨论 / grilling", "口头对齐：做不做、范围", "low"),
        ("Breadboards", "面包板 / 逻辑接线", "先插通模块与状态，不修样子", "mid"),
        ("Wireframes", "线框 / 草图", "分区、信息架构、流程先后", ""),
        ("Prototypes", "可运行原型", "能打开、能点，回答设计问题", "high"),
        ("Production", "Production-Ready", "可上线的真代码", "prod"),
    ]
    items = []
    for i, (title, cn, sub, kind) in enumerate(steps):
        items.append(
            f'<li class="fid-step {kind}">'
            f'<span class="fid-no">{i + 1}</span>'
            f'<strong>{html.escape(title)}</strong>'
            f'<em class="fid-cn">{html.escape(cn)}</em>'
            f'<span>{html.escape(sub)}</span></li>'
        )
    return f"""
<figure class="diagram fid-spectrum">
  <p class="fid-scale-label"><span>Low Fidelity</span><span class="fid-scale-line"></span><span>High Fidelity</span></p>
  <div class="fid-rail" role="list">{''.join(items)}</div>
  <figcaption>
    Fidelity Spectrum（五档）：Discussion → Breadboards → Wireframes → Prototypes → Production-Ready Code。
    量的是<strong>载体</strong>有多接近最终体验，不是字数。按问题选档，不是越高越好。
  </figcaption>
</figure>
"""


def diagram_jump_compare() -> str:
    return """
<figure class="diagram">
  <div class="jump-grid">
    <div class="jump-card bad">
      <h4>Spec-driven</h4>
      <p class="jump-path">文字 Spec <span class="jump-gap">巨大跳跃</span> 生产代码</p>
      <p>每轮改 Spec = 信息损耗叠加</p>
    </div>
    <div class="jump-card good">
      <h4>Prototype-driven</h4>
      <p class="jump-path">可运行原型 <span class="jump-ok">小跳跃</span> 生产代码</p>
      <p>实施 Agent 直接对照原型</p>
    </div>
  </div>
  <figcaption>左边靠文字硬跳到生产；右边先做出能点的，再对照写——跳跃小很多</figcaption>
</figure>
"""


def diagram_spec_chain() -> str:
    nodes = [
        _flow_node("idea", "想法"),
        _flow_arrow(),
        _flow_node("grill", "对齐"),
        _flow_arrow(),
        _flow_node("to-spec", "文字 Spec", kind="hot"),
        _flow_arrow(),
        _flow_node("to-tickets", "拆工单", kind="hot"),
        _flow_arrow(),
        _flow_node("implement", "写代码"),
        _flow_arrow(),
        _flow_node("tdd / review", "质量闸"),
        _flow_arrow(),
        _flow_node("commit", "提交"),
    ]
    return f"""
<figure class="diagram">
  <div class="flow-row">{''.join(nodes)}</div>
  {_diagram_caption('Spec 链：红节点靠<strong>文字文档</strong>传意图，损耗大')}
</figure>
"""


def diagram_prototype_chain() -> str:
    nodes = [
        _flow_node("idea", "想法"),
        _flow_arrow(),
        _flow_node("grill-with-docs", "对齐"),
        _flow_arrow(),
        _flow_node("prototype", "2–3 变体", kind="ok"),
        _flow_arrow("眼睛评审"),
        _flow_node("eye review", "口述反馈", kind="ok"),
        _flow_arrow("满意"),
        _flow_node("handoff", "交接包"),
        _flow_arrow(),
        _flow_node("implement", "对照原型"),
    ]
    return f"""
<figure class="diagram">
  <div class="flow-row">{''.join(nodes)}</div>
  <p class="flow-loop">↺ 原型和眼睛评审可以多轮，直到决策清楚</p>
  {_diagram_caption('原型链：绿节点产出<strong>能跑的东西</strong>；我们实际走的是这条')}
</figure>
"""


def diagram_wayfinder() -> str:
    return """
<figure class="diagram">
  <div class="wayfinder">
    <div class="wf-start">开始规划一段工作</div>
    <div class="wf-arrow-down"></div>
    <div class="wf-node grill">先讨论（grilling）<span>聊清范围、命名、边界</span></div>
    <div class="wf-branch">
      <div class="wf-arm">
        <span class="wf-label">聊清楚了</span>
        <div class="wf-node muted">进入下一段规划</div>
      </div>
      <div class="wf-arm">
        <span class="wf-label signal">信号：长什么样？怎么表现？</span>
        <div class="wf-node proto">做原型<span>能跑起来，讨论拉高保真</span></div>
        <div class="wf-arrow-down"></div>
        <div class="wf-node proto">用眼睛看<span>收集设计决策，可多轮</span></div>
        <div class="wf-arrow-down"></div>
        <div class="wf-node">交接 → 写生产代码<span>原型当参照</span></div>
      </div>
    </div>
  </div>
  <figcaption>Wayfinder：平时默认先聊；只有「想看一眼」时才去做原型</figcaption>
</figure>
"""


def diagram_when_to_prototype() -> str:
    """Four decision rules — when discussion should escalate to a prototype."""
    rules = [
        ("RULE 1", "说不清长什么样", "视觉 · 布局 · 动效", "描述不如看一眼", "ui"),
        ("RULE 2", "不确定行为逻辑", "状态机 · 交互流", "跑一遍才知道对不对", "logic"),
        ("RULE 3", "需要对比方案", "A / B / C 取舍", "生成变体，逐个评审", "either"),
        ("RULE 4", "复杂度超出讨论", "纸上推演不够", "写个能点的小程序验证", "logic"),
    ]
    cards = []
    for no, title, focus, tip, kind in rules:
        cards.append(
            f"""<div class="when-card {html.escape(kind)}">
  <span class="when-no">{html.escape(no)}</span>
  <strong>{html.escape(title)}</strong>
  <span class="when-focus">{html.escape(focus)}</span>
  <em>{html.escape(tip)}</em>
</div>"""
        )
    return f"""
<figure class="diagram">
  <div class="when-grid">{''.join(cards)}</div>
  {_diagram_caption('决策框架：默认先聊；下面任一信号出现，就去做原型')}
</figure>
"""


def diagram_ui_vs_logic() -> str:
    return """
<figure class="diagram">
  <div class="branch-compare">
    <div class="branch-card ui">
      <p class="branch-kicker">分支 A · UI.md</p>
      <h4>UI Prototype</h4>
      <p class="branch-q">问题形态：「这东西<strong>长什么样</strong>？」</p>
      <ul>
        <li>同一路由上做<strong>好几版结构不同</strong>的界面（不是换个配色）</li>
        <li>底部浮条 / <code>?variant=</code> 一键切换</li>
        <li>尽量贴着真页面、真数据密度来比</li>
      </ul>
      <p class="branch-out">产出：能点的视觉变体 → 用眼睛选方向</p>
    </div>
    <div class="branch-card logic">
      <p class="branch-kicker">分支 B · LOGIC.md</p>
      <h4>Logic Prototype</h4>
      <p class="branch-q">问题形态：「这套<strong>状态 / 逻辑</strong>感觉对吗？」</p>
      <ul>
        <li>单个可分享 HTML（或轻量 TUI），非研发也能点</li>
        <li>自由试玩 + 分场景引导；每步露出完整状态</li>
        <li>核心逻辑做成纯模块，验证完再抬进生产代码</li>
      </ul>
      <p class="branch-out">产出：能推演的状态机 → 确认行为再写实现</p>
    </div>
  </div>
  <figcaption>
    两条分支参考：
    <a href="https://github.com/mattpocock/skills/blob/main/skills/engineering/prototype/UI.md" target="_blank" rel="noopener">UI.md</a>
    ·
    <a href="https://github.com/mattpocock/skills/blob/main/skills/engineering/prototype/LOGIC.md" target="_blank" rel="noopener">LOGIC.md</a>
    ；选错分支，整段原型基本白做
  </figcaption>
</figure>
"""


def copy_share_assets(export_dir: Path) -> None:
    """Copy article + journey images next to index.html for the share playbook."""
    if not SHARE_ASSETS_SRC.is_dir():
        print(f"WARN: share assets missing: {SHARE_ASSETS_SRC}", file=sys.stderr)
        return
    dest = export_dir / "share-assets"
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(SHARE_ASSETS_SRC, dest)


def diagram_main_skill_flow() -> str:
    """Matt's standard idea→ship chain (from ask-matt / video)."""
    steps = [
        ("1", "grill-with-docs", "或 wayfinder", "green"),
        ("2", "to-spec", "", "yellow"),
        ("3", "to-tickets", "", "red"),
        ("4", "implement", "内嵌 tdd", "ink"),
        ("5", "code-review", "implement 收尾", "blue"),
    ]
    nodes = []
    for i, (no, title, note, kind) in enumerate(steps):
        note_html = f'<span class="flow-note">{html.escape(note)}</span>' if note else ""
        nodes.append(
            f'<div class="main-flow-node {html.escape(kind)}">'
            f'<span class="main-flow-no">{html.escape(no)}</span>'
            f'<strong>{html.escape(title)}</strong>{note_html}</div>'
        )
        if i < len(steps) - 1:
            nodes.append('<div class="main-flow-arrow" aria-hidden="true">↓</div>')
    return f"""
<figure class="diagram">
  <div class="main-flow">{''.join(nodes)}</div>
  {_diagram_caption('标准主流程（idea → ship）：对齐 → 合成 Spec → 拆票 → 实现 → 双轴评审')}
</figure>
"""


def _skill_card(name: str, kind: str, one_liner: str, how: str) -> str:
    return f"""
<article class="skill-card">
  <header>
    <code>{html.escape(name)}</code>
    <span class="skill-kind">{html.escape(kind)}</span>
  </header>
  <p class="skill-one">{html.escape(one_liner)}</p>
  <p class="skill-how"><strong>原理</strong>：{how}</p>
</article>
"""


def render_skills_guide() -> str:
    """Sidebar Layer-0: mattpocock/skills core ideas, catalog, design, usage."""
    eng_user = "".join(
        [
            _skill_card(
                "ask-matt",
                "User · 路由",
                "不知道走哪条路时先问它。",
                "本身几乎不干活，是一张<strong>流程地图</strong>：主流程、入口匝道、standalone 技能怎么拼；"
                "按你的处境推荐下一步该调哪个 skill。",
            ),
            _skill_card(
                "setup-matt-pocock-skills",
                "User · 配置",
                "每个仓库先跑一次。",
                "问清 issue 追踪器（GitHub / Linear / 本地 md）、triage 标签映射、文档落盘位置，"
                "写出 agent 可读的配置；后面 to-spec / triage / wayfinder 都靠这份配置。",
            ),
            _skill_card(
                "grill-with-docs",
                "User · 编排（短）",
                "仓库内对齐的默认入口。",
                "SKILL 本体往往只有一两句：<em>跑 grilling + domain-modeling</em>。"
                "真正干活的是底层原语；它负责把结果写进 <code>CONTEXT.md</code> / ADR，留下纸面痕迹。",
            ),
            _skill_card(
                "grill-me",
                "User · 编排（短）",
                "没有工作目录时的拷问入口。",
                "同样只是一句「跑 grilling」——<strong>不写本地文档</strong>。"
                "在仓库里应优先用 grill-with-docs。",
            ),
            _skill_card(
                "wayfinder",
                "User · 编排",
                "超大、发雾的活：先找路，再动手。",
                "在 tracker 上建一张 <code>wayfinder:map</code>，子票是<strong>决策题</strong>（不是功能切片）。"
                "票类型：research / prototype / grilling / task；默认产出决策、不交付代码；"
                "雾散了再交接进主流程的 to-spec，不要直接 implement。",
            ),
            _skill_card(
                "to-spec",
                "User · 编排",
                "把已聊清的对话合成 Spec，不再拷问你。",
                "扫仓库 → 用领域词写稿 → <strong>先跟你确认测试缝（seams）</strong> → "
                "按模板写出 Problem / Solution / User Stories / Implementation &amp; Testing Decisions → "
                "发到 tracker 并打 <code>ready-for-agent</code>。禁止再开一轮 interview。",
            ),
            _skill_card(
                "to-tickets",
                "User · 编排",
                "把 Spec/计划拆成可 demo 的竖切票。",
                "每张票是 tracer bullet（贯穿各层、单窗口可做完），声明 <strong>Blocked by</strong>；"
                "跟你核对粒度后发布。本地 tracker 一票一文件；真 tracker 用原生阻塞边。"
                "宽重构例外：走 expand–contract，不硬塞竖切。",
            ),
            _skill_card(
                "implement",
                "User · 编排（短）",
                "按 Spec/票把活做完。",
                "短编排：在约定缝上驱动 <code>tdd</code> → 常跑类型检查与单测 → 结束前跑 "
                "<code>code-review</code> → commit。多票时每票新开上下文。",
            ),
            _skill_card(
                "triage",
                "User · 编排",
                "收拾别人丢进来的 issue/PR，不是自己 to-tickets 出的票。",
                "按状态机贴标签（needs-triage → needs-info / ready-for-agent / …）；"
                "必要时内嵌 grilling，写出 agent-ready brief。AI 评论必须带免责声明。",
            ),
            _skill_card(
                "improve-codebase-architecture",
                "User · 编排",
                "闲时扫「加深模块」的机会。",
                "普查 → 出可视化 HTML 报告 → 你点一个候选 → 再 grilling 想清楚；"
                "选中的点子可并进主流程的 grill-with-docs。是调查，不是救火清淤。",
            ),
        ]
    )
    eng_model = "".join(
        [
            _skill_card(
                "grilling",
                "Model · 原语",
                "拷问原语：设计树 + 轮次 frontier。",
                "把决策建成树；每轮只问<strong>当前可答的 frontier</strong>（编号题 + 推荐答案）；"
                "事实派子代理查，决策等你拍板；frontier 空且你确认对齐才结束。"
                "grill-* / triage / wayfinder / improve-architecture 都调用它。",
            ),
            _skill_card(
                "domain-modeling",
                "Model · 词汇层",
                "打磨领域语言与 ADR。",
                "挑战模糊词、拆一语多义、难逆决策写 ADR、更新 CONTEXT。"
                "grill-with-docs 的「docs」大半靠它。",
            ),
            _skill_card(
                "prototype",
                "Model · 纪律",
                "用可丢代码回答一个设计问题。",
                "先问清问题再选分支：样子 → UI.md（多变体切换）；逻辑/状态 → LOGIC.md（单页状态机）。"
                "可跑、内存态、露出状态；答案抬进生产，原型本身迁到 throwaway 分支当一手来源。",
            ),
            _skill_card(
                "tdd",
                "Model · 纪律",
                "红 → 绿竖切；好测试的参照。",
                "先和你锁定测试缝，再写失败测试，只写刚好够绿的代码；"
                "测外部行为不测实现；禁止横向「先堆满测试再实现」。重构留给 code-review 阶段。",
            ),
            _skill_card(
                "code-review",
                "Model · 纪律",
                "相对固定点做双轴评审。",
                "锁定 <code>git diff fixed...HEAD</code>；"
                "<strong>Standards</strong> 与 <strong>Spec</strong> 两个子代理并行、互不污染上下文，"
                "最后并排汇报，不跨轴重排优先级。Standards 含仓库规范 + Fowler smell 基线。",
            ),
            _skill_card(
                "codebase-design",
                "Model · 词汇层",
                "深模块共同语言。",
                "提供 module / interface / depth / seam / adapter 等词表；"
                "tdd、improve-architecture 都引用它。是参考，不是一次「跑完的会话」。",
            ),
            _skill_card(
                "diagnosing-bugs",
                "Model · 纪律",
                "难 bug / 性能的诊断环。",
                "先有<strong>一条已红的反馈命令</strong>才允许立论 → 最小化 → 假设 → 埋点 → 修 → 回归测试。"
                "若根因是没有好缝，事后交接 improve-architecture。",
            ),
            _skill_card(
                "research",
                "Model · 纪律",
                "高可信源调研，落成带引用的 md。",
                "常作 background / wayfinder 的 research 子票；只信一手来源，结论写进仓库文件。",
            ),
            _skill_card(
                "resolving-merge-conflicts",
                "Model · 纪律",
                "按意图解冲突，不 abort。",
                "逐 hunk 追溯两边一手来源的意图再合并；standalone，不挂在主流程上。",
            ),
            _skill_card(
                "wizard",
                "Model · 纪律",
                "生成只适合人手点的 bash 向导。",
                "把「必须人去控制台点」的步骤做成交互脚本（开账号、填密钥、一次性割接等）。",
            ),
        ]
    )
    prod = "".join(
        [
            _skill_card(
                "handoff",
                "User · 编排（短）",
                "压缩成交接文档给下一 agent。",
                "写到系统临时目录（不污染仓库）；引用已有产物、不复制；含 suggested skills；"
                "脱敏。用于换目录、换 harness、交接同事、或原型迂回。",
            ),
            _skill_card(
                "wait-what",
                "User · 编排",
                "没听懂立刻重讲。",
                "用 CONTEXT 词汇、白话把上一条消息重新 pitched，补你缺的上下文。",
            ),
            _skill_card(
                "teach",
                "User · 编排",
                "多会话教学。",
                "以当前目录为有状态的教学工作区，跨会话教一个概念/技能。",
            ),
            _skill_card(
                "to-questionnaire",
                "User · 编排",
                "做给「唯一能答的人」的问卷。",
                "grilling 的是<strong>怎么发出去</strong>（给谁、要什么回执），不是问卷主题本身。",
            ),
            _skill_card(
                "writing-for-agents",
                "Model · 纪律",
                "写给 agent 读的文档。",
                "约束 skills、AGENTS.md/CLAUDE.md 等「靠指针打开的文档」怎么写才可执行。",
            ),
        ]
    )

    return f"""
<div id="skills" class="skills">
  <header class="story-hero">
    <p class="eyebrow">Skills · 梳理</p>
    <h2>mattpocock/skills：给真人工程师用的 Agent 技能包</h2>
    <p class="lede">
      仓库：
      <a href="https://github.com/mattpocock/skills" target="_blank" rel="noopener">github.com/mattpocock/skills</a>。
      下面按「主张 → 标准主流程 → 每个 skill 怎么实现 → 怎么装」过一遍。
      路由全图见仓库里的 <code>ask-matt</code>。
    </p>
    <div class="share-actions">
      <button type="button" class="phase-open" data-show-share>看完去方法论</button>
      <button type="button" class="phase-open ghost" data-show-story>跳到故事线</button>
    </div>
  </header>

  <section class="share-block">
    <h3>1. 核心主张：小、可改、可组合</h3>
    <p>
      Matt 自己每天用的 agent skills，目标是<strong>真工程</strong>，不是 vibe coding。
      GSD / BMAD / Spec-Kit 一类方案想「替你管整条流程」，代价是你失去掌控，流程里出了 bug 也难拆。
      这套 skill 反过来：<strong>刻意做小、好改、能拼</strong>；跟哪个模型都能用；鼓励你 fork 成自己的。
    </p>
  </section>

  <section class="share-block">
    <h3>2. 四个失败模式 → 对应 skill</h3>
    <p>整包其实是在修 agent 协作里最常见的四种翻车：</p>
    <ul class="fail-list">
      <li>
        <strong>#1 做出来不是我想要的（对齐失败）</strong>
        <span>先 grilling：用 <code>/grill-me</code>（非代码）或 <code>/grill-with-docs</code>（顺带建领域语言）把问题问透，再动手。</span>
      </li>
      <li>
        <strong>#2 Agent 又臭又长（没有共享语言）</strong>
        <span>维护 <code>CONTEXT.md</code> + ADR；<code>/grill-with-docs</code> / <code>domain-modeling</code> 把黑话收敛成项目词汇。</span>
      </li>
      <li>
        <strong>#3 代码跑不通（反馈环太弱）</strong>
        <span><code>/tdd</code> 红绿重构；难 bug 用 <code>/diagnosing-bugs</code> 分阶段诊断。</span>
      </li>
      <li>
        <strong>#4 堆成泥球（设计被速度拖垮）</strong>
        <span><code>/to-spec</code> 动手前先问模块边界；定期跑 <code>/improve-codebase-architecture</code> 找「加深模块」的机会。</span>
      </li>
    </ul>
  </section>

  <section class="share-block">
    <h3>3. 怎么设计的：谁能调用 · SKILL 长什么样</h3>
    <p>技能按<strong>谁能触发</strong>分成两轴：</p>
    <ul>
      <li><strong>User-invoked</strong>（常带 <code>disable-model-invocation: true</code>）：你必须打斜杠；负责<strong>编排</strong>。</li>
      <li><strong>Model-invoked</strong>：你能叫，任务匹配时 agent 也会自己拿；装的是<strong>可复用纪律 / 原语 / 词表</strong>。</li>
    </ul>
    <p class="callout soft">
      规则：user-invoked 可以调用 model-invoked；user-invoked <strong>不会</strong>再嵌套另一个 user-invoked。
    </p>
    <h4>一个 skill 文件通常什么样</h4>
    <ul>
      <li><strong>YAML frontmatter</strong>：<code>name</code>、<code>description</code>（触发说明）、是否禁止模型自调。</li>
      <li><strong>短编排型</strong>：正文只有几句，例如 <code>grill-me</code> =「跑 grilling」；
        <code>grill-with-docs</code> =「grilling + domain-modeling」；
        <code>implement</code> =「tdd → code-review → commit」。真正算法在被调用的底层 skill。</li>
      <li><strong>标准流程型</strong>：带 Process、模板、反模式，例如 <code>to-spec</code>、<code>to-tickets</code>、<code>tdd</code>、<code>code-review</code>、<code>wayfinder</code>。</li>
      <li><strong>地图型</strong>：<code>ask-matt</code> 几乎不执行步骤，专门讲「主流程 / 匝道 / standalone 怎么拼」。</li>
    </ul>
  </section>

  <section class="share-block">
    <h3>4. 标准用法：主流程 idea → ship</h3>
    <p>
      视频和 <code>ask-matt</code> 里同一条「有想法要做成」的默认路径（第 1 步二选一）：
    </p>
    {diagram_main_skill_flow()}
    <ol>
      <li>
        <strong>对齐</strong>：能在一个会话里想清 → <code>/grill-with-docs</code>；
        大到发雾、跨多会话 → <code>/wayfinder</code>（先产出决策地图，雾散后再进 to-spec）。
      </li>
      <li>
        <strong>聊不清样子/行为时绕路</strong>：<code>/handoff</code> 出去 → <code>/prototype</code> → 再 handoff 回来，答案写回原线程。
      </li>
      <li>
        <strong>多会话建造</strong>：<code>/to-spec</code> → <code>/to-tickets</code> → 每票新开窗口 <code>/implement</code>
        （内嵌 tdd，收尾 code-review）。小改动可跳过拆票，对齐后直接 implement。
      </li>
      <li>
        <strong>上下文卫生</strong>：grilling → to-spec → to-tickets 尽量留在同一窗口；
        每张 implement 票再清上下文。逼近模型「聪明区」上限就在阶段边界 compact，别硬撑。
      </li>
    </ol>
    <p class="muted tiny">
      匝道：外来 bug/需求堆 → <code>/triage</code>；难 bug → <code>/diagnosing-bugs</code>；
      闲时养仓库 → <code>/improve-codebase-architecture</code>。不确定时先 <code>/ask-matt</code>。
    </p>
  </section>

  <section class="share-block">
    <h3>5. 各 skill 实现原理速查</h3>
    <p>下面按「它内部大致怎么跑」写；短编排型会标明它调用了谁。</p>
    <h4>Engineering · User-invoked</h4>
    <div class="skill-cards">{eng_user}</div>
    <h4>Engineering · Model-invoked</h4>
    <div class="skill-cards">{eng_model}</div>
    <h4>Productivity</h4>
    <div class="skill-cards">{prod}</div>
  </section>

  <section class="share-block">
    <h3>6. 怎么安装</h3>
    <h4>装法二选一（别两套同时装，否则每个 skill 会翻倍）</h4>
    <ol>
      <li>
        <strong>Claude Code 插件</strong>（托管只读包，作者更新你跟着更新）：
        <code>claude plugins install mattpocock-skills</code>
        或会话里 <code>/plugin install mattpocock-skills</code>
      </li>
      <li>
        <strong>skills.sh / npx</strong>（拷进仓库、可改）：
        <code>npx skills@latest add mattpocock/skills</code>
        —— 安装时务必勾上 <code>setup-matt-pocock-skills</code>。
      </li>
    </ol>
    <p>
      装完在每个仓库跑一次 <code>/setup-matt-pocock-skills</code>，再按第 4 节主流程开干。
      迷路就 <code>/ask-matt</code>。
    </p>
    <p class="callout soft">
      和本页「可分享方法论」的关系：方法论讲我们怎么用「原型驱动」落地 Open Dashboard；
      这里是 Matt 技能包本身的说明书。两边词对齐后，再看故事线证据会顺很多。
    </p>
  </section>
</div>
"""


def render_share_playbook() -> str:
    """Layer-1 shareable narrative: journey × prototype-driven skills (not the BA ops pack yet)."""
    j = "share-assets/journey"

    return f"""
<div id="share" class="share" hidden>
  <header class="story-hero">
    <p class="eyebrow">分享稿 · 第一层</p>
    <h2>别先写长 Spec：先做出能点的原型，再写上线代码</h2>
    <p class="lede">
      用我们 Open Dashboard 的真实落地过程，讲清楚「原型驱动」怎么用在产品 / BA / 研发协作里。
      想先弄清 Matt 那套技能本身，请点侧栏
      <button type="button" class="text-link" data-show-skills>mattpocock/skills 梳理</button>。
    </p>
    <div class="share-actions">
      <button type="button" class="phase-open" data-show-story>去看故事线</button>
      <button type="button" class="phase-open ghost" data-phase-jump="p1">从高保起源看起</button>
    </div>
  </header>

  <section class="share-block">
    <h3>1. 为什么「先写详细需求」容易翻车</h3>
    <p>
      用 AI 写代码时，很多人第一反应是：先写一份特别细的 Spec，指望一次做对。
      结果常常是 Spec 改了好几轮，代码也生成了好几版，还是不像心里想的那样——
      交互细节在「文字 → 想象 → 代码」之间损耗太大（information loss）。
    </p>
    <p>
      Matt 的办法很简单：<strong>别把精力耗在长 Spec 上，去做能回答问题的原型。</strong>
      原型不是新词，敏捷里的 Spike 就是亲戚；变贵的是成本——现在做出一个能跑的东西便宜多了。
    </p>
    <p class="callout soft">
      原型是什么：A prototype is throwaway code that answers a question.
      （用来回答一个问题的、可以丢掉的代码。）
    </p>
  </section>

  <section class="share-block">
    <h3>2. Fidelity Spectrum（保真度频谱）：什么时候聊，什么时候写</h3>
    <p>
      Matt 用一条频谱回答「现在该聊，还是该写」。
      <strong>Fidelity</strong> 不是「文档写得多细」，而是：做决定时，手里拿的东西有多接近最终体验。
      <strong>Spectrum</strong> 上有五个名词——从低到高，按问题选档，不是越高越好。
    </p>
    {diagram_fidelity_spectrum()}
    <table class="map-table">
      <thead>
        <tr><th>档位</th><th>是什么</th><th>手里拿什么</th><th>适合回答</th><th>该往上升的信号</th></tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>1 Discussion</strong></td>
          <td>讨论、grilling</td>
          <td>口头 / 短笔记</td>
          <td>做不做、范围、给谁用、非目标</td>
          <td>开始纠结「接得通吗 / 长什么样」</td>
        </tr>
        <tr>
          <td><strong>2 Breadboards</strong></td>
          <td>面包板（借电子工程的词）</td>
          <td>临时把模块 / 状态「插」在一起</td>
          <td>逻辑通不通、状态怎么转、边界怎么卡</td>
          <td>接线清楚了，但还需要看见布局；或行为仍只能在纸上吵</td>
        </tr>
        <tr>
          <td><strong>3 Wireframes</strong></td>
          <td>线框 / 草图</td>
          <td>框线、灰模、信息架构</td>
          <td>页面分区、流程先后、导航骨架</td>
          <td>光看图仍想象不出手感 / 动效 / 真实密度</td>
        </tr>
        <tr>
          <td><strong>4 Prototypes</strong></td>
          <td>可运行原型（可丢）</td>
          <td>能打开、能点的页面或状态机 demo</td>
          <td>样子、交互、表现；或复杂逻辑跑一遍</td>
          <td>满意了 → 对照它写 Production</td>
        </tr>
        <tr>
          <td><strong>5 Production</strong></td>
          <td>Production-Ready Code</td>
          <td>真前后端、可上线</td>
          <td>真数据、真接口、交付</td>
          <td>这是终点，不是用来「继续讨论」的档</td>
        </tr>
      </tbody>
    </table>
    <p>
      容易漏的一档是 <strong>Breadboards</strong>：它不是线框，也还不是漂亮原型——
      像在面包板上试电路，先验证「零件插上能不能通」。
      软件里常见形态：临时接线的状态机、纯逻辑小程序、不修 UI 的可跑草稿。
      后面第 6 节里的 Logic prototype，多半就停在这一带或再升到 Prototypes。
    </p>

    <h4>什么时候该升到原型？（四条信号）</h4>
    <p>
      默认停在 Discussion 继续聊。出现下面任一信号，再往 Breadboards / Wireframes / Prototypes 爬——
      尤其是升到能跑的 Prototypes：
    </p>
    {diagram_when_to_prototype()}
    <ul>
      <li><strong>Rule 1 说不清长什么样</strong> → 视觉 / 布局 / 动效：描述不如看一眼（偏 UI 原型）。</li>
      <li><strong>Rule 2 不确定行为逻辑</strong> → 状态机 / 交互流：跑一遍才知道对不对（偏 Logic / Breadboard）。</li>
      <li><strong>Rule 3 需要对比方案</strong> → A/B/C：生成变体逐个评审（UI 变体或逻辑变体都算）。</li>
      <li><strong>Rule 4 复杂度超出讨论</strong> → 纸上推演不够：写个能点的小程序验证（偏 Logic）。</li>
    </ul>

    <div class="fid-example">
      <h4>一个例子：同一件事，停在哪一档</h4>
      <div class="fid-ex-row">
        <div class="fid-ex bad">
          <span class="fid-ex-label">停在 Discussion 就行</span>
          <p>「仪表盘<strong>要不要</strong>做移动端预览？」→ 要 / 不要 / 以后再做。两句话能定。</p>
        </div>
        <div class="fid-ex arrow" aria-hidden="true">→</div>
        <div class="fid-ex good">
          <span class="fid-ex-label">Rule 1 → 升到 Prototypes</span>
          <p>「移动端预览<strong>空荡荡、很丑</strong>」→ 再写三页说明也没用，打开页面用眼睛改。</p>
        </div>
      </div>
      <p class="fid-ex-foot">
        切换信号：问题变成「长什么样 / 怎么表现 / 逻辑跑得通吗」→ 升档。
        还在「做不做」就上高保或生产代码，反而浪费。
        UI 还是 Logic、怎么落地，见第 6 节。
      </p>
    </div>

    <p class="callout soft">
      容易混：Spec 写 800 字，形态仍是文字，对交互来说还是低保真（多半停在 Discussion）；
      一段能点的 HTML，哪怕糙，对「长什么样」反而更准（Prototypes）。
      别用低保真的载体，去扛高保真的问题。
    </p>
    <p class="muted tiny">
      我们自己：Discussion 聊清「先做交互」→ 高保 HTML（Prototypes）→ 对着页面改 → Production 按高保对齐。
      Breadboards 那档，取数协议 / 状态边界当时多半混在高保点击里验了——第 6 节会说清以后怎么拆开。
    </p>
  </section>

  <section class="share-block">
    <h3>3. 两条路：靠 Spec，还是靠原型</h3>
    <p>
      常见走法：写 Spec → AI 生成 → 不对 → 改 Spec → 再生成……文字到代码跳太大。
      另一条路：先做出能跑的原型，再照着它写生产代码——跳跃小很多。
    </p>
    {diagram_jump_compare()}
    <div class="example-grid">
      <article class="ex-card bad">
        <h4>例子 A · 靠 Spec 怎么翻车</h4>
        <ol>
          <li>写 Spec → 竖时间线、标签全蓝</li>
          <li>改 Spec → 手机屏溢出、时区没管</li>
          <li>再补 → 状态不全、缺占位图</li>
          <li>40 分钟、800 字、4 版都不能用</li>
        </ol>
      </article>
      <article class="ex-card good">
        <h4>例子 B · 靠原型怎么走</h4>
        <ol>
          <li>先聊清：几个区域、几种状态、什么最重要</li>
          <li>一次做出 A/B/C 三个能点的版本</li>
          <li>看着改、口述反馈，融合出 D</li>
          <li>大约 15 分钟到可验收，交给实施对照写</li>
        </ol>
      </article>
    </div>
    <p>
      同一句话：用文字描写交互，损耗大到不可控；
      <strong>能跑起来的代码，才是最准的「需求文档」。</strong>
    </p>
  </section>

  <section class="share-block">
    <h3>4. 两条 Skill 链（对照）</h3>
    <p>Matt 的技能可以串成两条链。红的是文字路径，绿的是我们实际走的原型路径。</p>
    {diagram_spec_chain()}
    {diagram_prototype_chain()}
    <h4>handoff 和 implement 分别干什么</h4>
    <table class="map-table">
      <thead><tr><th>原型链里</th><th>大概对应 Spec 链里的</th><th>实际在干什么</th></tr></thead>
      <tbody>
        <tr>
          <td><strong>handoff</strong></td>
          <td>拆好的可开工工单</td>
          <td>把「高保路径 + 选型 + 本轮范围」交给实施，而不是再写交互长文</td>
        </tr>
        <tr>
          <td><strong>implement</strong></td>
          <td>按工单写代码</td>
          <td>对照高保 URL / 路由 / 交互写生产代码</td>
        </tr>
        <tr>
          <td>眼睛评审</td>
          <td>测试 / 代码评审（一部分）</td>
          <td>打开浏览器，看像不像高保</td>
        </tr>
      </tbody>
    </table>
    <p class="muted tiny">
      技能形态见 <a href="https://github.com/mattpocock/skills" target="_blank" rel="noopener">mattpocock/skills</a>：
      短、可组合；不是一套抢走控制权的大流程。
    </p>
  </section>

  <section class="share-block">
    <h3>5. Wayfinder：默认先聊，需要时再做原型</h3>
    <p>
      原型不该是孤立动作。Wayfinder 的意思是：大任务拆成一段段规划时，
      <strong>默认先 grilling（讨论）</strong>；只有聊不清「长什么样 / 怎么表现」时，才升到 prototype。
    </p>
    {diagram_wayfinder()}
    <p class="callout">
      你不用每次纠结「现在该写 Spec 还是写代码」。
      默认聊天；想看一眼的时候，就去做能点的原型。
    </p>
  </section>

  <section class="share-block">
    <h3>6. 什么时候该做原型：UI 还是 Logic？</h3>
    <p>
      Wayfinder 只回答「要不要升保真」。真动手时，Matt 的
      <a href="https://github.com/mattpocock/skills/blob/main/skills/engineering/prototype/SKILL.md" target="_blank" rel="noopener"><code>prototype</code> skill</a>
      里还有两条分支——各有一篇参考文档：
      <a href="https://github.com/mattpocock/skills/blob/main/skills/engineering/prototype/UI.md" target="_blank" rel="noopener">UI prototype</a>
      和
      <a href="https://github.com/mattpocock/skills/blob/main/skills/engineering/prototype/LOGIC.md" target="_blank" rel="noopener">Logic prototype</a>。
      <strong>选哪条，看你的问题是什么类型</strong>；选错分支，整段原型基本白做。
    </p>

    <h4>先问：现在该不该做原型？</h4>
    <p>默认继续聊。出现下面任一信号，再升到原型：</p>
    {diagram_when_to_prototype()}

    <h4>再问：UI 还是 Logic？</h4>
    <p>
      问题决定形状。想看布局 / 视觉 / 动效 → UI；想验证状态机、业务规则、难在纸上推的行为 → Logic；
      要比 A/B/C 时，比的是「长什么样」走 UI，比的是「怎么转状态」走 Logic。
    </p>
    {diagram_ui_vs_logic()}

    <h4>怎么落地（两条分支的最小做法）</h4>
    <ol>
      <li><strong>先用一句话写出问题</strong>——写不出来就先回去 grilling，别急着开 HTML。</li>
      <li><strong>按问题选分支</strong>，并在原型页顶上写清假设（「我们按 UI 分支做，因为……」）。</li>
      <li>
        <strong>UI</strong>：同一入口挂 2–3 个<strong>结构不同</strong>的变体，底部切换；贴真导航 / 真密度。
        <strong>Logic</strong>：一页可分享 HTML，按钮推状态，每步打印完整状态；逻辑模块保持纯函数，方便抬进生产。
      </li>
      <li><strong>用眼睛 / 手感收决策</strong>，把答案写进交接（ADR、issue、NOTES）——保留答案，丢掉或迁走可弃代码。</li>
    </ol>

    <h4>案例：Open Dashboard 高保，走的是 UI 分支</h4>
    <p>
      当时真正卡人的问题是：「仪表盘编辑器 / 工作台<strong>长什么样</strong>？维度指标区怎么摆、移动端空不空？」
      ——这是 Rule 1（说不清长什么样），不是「取数协议状态机推得通不通」。
      所以我们做的是<strong>可交互高保 HTML</strong>（飞书风 → commercial），相当于 Matt 说的 UI prototype：能点、能看、能口述改，而不是先写交互长文。
    </p>
    <div class="fig-grid">
      {_share_fig(f"{j}/hifi-feishu.png", "UI 原型：飞书风高保（先看见）")}
      {_share_fig(f"{j}/hifi-editor.png", "同一问题继续打磨：编辑器变体方向")}
    </div>
    <div class="tl-box">
      <strong>对照 Matt 的落地清单，我们实际做了什么</strong>
      <ul>
        <li>问题类型：长什么样 → <strong>UI 分支</strong>（不是 Logic）</li>
        <li>形态：单页可点的高保，贴着真实工作台密度迭代</li>
        <li>评审：对着页面说「多选」「移动端空荡荡」——眼睛评审，不补长 Spec</li>
        <li>收尾：高保当参照交接生产（Vue3 / Spring Boot），答案留下，实现对照原型</li>
      </ul>
    </div>
    <p class="callout soft">
      顺带一提 Logic：若问题换成「维度 / 指标多选与取数协议在边界情况下状态对不对」，
      更适合单独做 Logic prototype（一页状态面板推案例）。我们当时把一部分行为验在高保点击里——能用，但和 Matt 的分工比，UI / Logic 混在同一件产物里，后面要对齐行为时更容易扯皮。
      新项目里：样子走 UI，行为走 Logic，两份原型各答一个问题。
    </p>
    <p class="muted tiny">
      下一节用时间线把这场 UI 原型 → 交接 → 生产对照完整走一遍。
    </p>
  </section>

  <section class="share-block">
    <h3>7. 我们真实是怎么走过来的</h3>
    <p style="margin:0 0 14px">
      下面按时间顺序说五步。每一步我放了<strong>当时原话</strong>和<strong>产出截图</strong>。
      当时并没有按名字去喊 Matt 的技能，但走的是同一条原型链。
      最长的一场对话在这里：
      <button type="button" class="story-link inline" data-id="678d7823-7ade-43ab-99f7-e90f85299ba9">打开那场 95 轮对话</button>。
    </p>

    <div class="journey-tl">
      <article class="tl-step">
        <header>
          <span class="tl-no">①</span>
          <div>
            <h4>先聊清，再做出高保（阶段 01）</h4>
            <p class="tl-meta">
              <button type="button" class="story-link inline" data-id="164f68d6-8670-4cfe-90b3-fe060c256266">起源对话</button>
              · 在 DataEase 工作区
            </p>
          </div>
        </header>
        <blockquote class="tl-quote">「需要重新设计仪表盘交互……怎么着手」→「最终前端高保长什么样，参考飞书输出下」</blockquote>
        <p>没有先写交互长文，直接做出能点的高保（飞书风 → commercial）。</p>
        {_share_fig(f"{j}/hifi-feishu.png", "当时做出的：飞书风高保（可交互 HTML）", wide=True)}
      </article>

      <article class="tl-step">
        <header>
          <span class="tl-no">②</span>
          <div>
            <h4>对着高保用眼睛改（阶段 02）</h4>
            <p class="tl-meta">同一场长对话的前半段</p>
          </div>
        </header>
        <blockquote class="tl-quote">对着 commercial 页面说：「维度指标要多选」「移动端很丑空荡荡」「要支持主流机型」……</blockquote>
        <p>全程口述反馈，没有靠补交互 Spec 来推进。</p>
        <div class="fig-grid">
          {_share_fig(f"{j}/hifi-editor.png", "打磨中的编辑器高保")}
          {_share_fig(f"{j}/hifi-workbench.png", "打磨中的工作台高保")}
        </div>
      </article>

      <article class="tl-step">
        <header>
          <span class="tl-no">③</span>
          <div>
            <h4>交接：可以开始写生产代码了</h4>
            <p class="tl-meta">长对话里定选型、拉脚手架的那几轮</p>
          </div>
        </header>
        <blockquote class="tl-quote">「先文档定稿，再脚手架，高保迁走作视觉/交互参照」→「前端 Vue3，后端 JDK21 + Spring Boot + PostgreSQL」</blockquote>
        <p>这里的交接不是再写一篇交互 Spec，而是把这三样说清楚：高保当参照、技术选型、本轮只做哪些。</p>
        <div class="tl-box">
          <strong>当时交接包里有什么</strong>
          <ul>
            <li>参照：<code>prototypes/hi-fi/dashboard-commercial.html</code></li>
            <li>选型：Vue3 / JDK21 / Spring Boot / PostgreSQL</li>
            <li>范围：编辑器 + 取数协议 + 移动端（这轮已聊清的）</li>
          </ul>
        </div>
      </article>

      <article class="tl-step">
        <header>
          <span class="tl-no">④</span>
          <div>
            <h4>对照高保写生产代码</h4>
            <p class="tl-meta">脚手架起来之后，按模块对齐</p>
          </div>
        </header>
        <blockquote class="tl-quote">「按最新高保实现」→「和高保差很多，按高保来」→「要完全一致，不要砍功能」</blockquote>
        <p>左边是参照（高保），右边是产品——验收标准就是：右边像不像左边。</p>
        <div class="compare-grid">
          <figure class="fig">
            <img src="{j}/hifi-editor.png" alt="高保编辑器" loading="eager">
            <figcaption>参照：高保编辑器</figcaption>
          </figure>
          <figure class="fig">
            <img src="{j}/prod-dashboard-edit.png" alt="产品编辑器" loading="eager">
            <figcaption>产出：线上仪表盘编辑</figcaption>
          </figure>
        </div>
        <div class="compare-grid">
          <figure class="fig">
            <img src="{j}/hifi-workbench.png" alt="高保工作台" loading="eager">
            <figcaption>参照：高保工作台</figcaption>
          </figure>
          <figure class="fig">
            <img src="{j}/prod-workbench.png" alt="产品工作台" loading="eager">
            <figcaption>产出：产品工作台</figcaption>
          </figure>
        </div>
        <div class="fig-grid">
          {_share_fig(f"{j}/prod-datasources.png", "后来还有：数据源")}
          {_share_fig(f"{j}/prod-datasets.png", "数据集")}
          {_share_fig(f"{j}/prod-dashboard-preview.png", "仪表盘预览")}
          {_share_fig(f"{j}/prod-report-edit.png", "在线报告")}
        </div>
      </article>

      <article class="tl-step lesson-step">
        <header>
          <span class="tl-no">⑤</span>
          <div>
            <h4>踩过的坑：像产品，但不像高保</h4>
            <p class="tl-meta">实现已经「能用」，但眼睛一看不对</p>
          </div>
        </header>
        <div class="callout lesson">
          <p class="lesson-label">当时原话</p>
          <ul class="quote-list">
            <li>「前后端实现和高保差很多，按照高保的交互来实现吧」</li>
            <li>「效果和高保差别很大」→「要完全保持一致，不要砍功能」</li>
            <li>「我发现高保设计质量更高……参考高保再优化下吧」</li>
          </ul>
          <p style="margin:10px 0 0">
            对的做法：打开高保，按模块对齐，用眼睛验收。<br>
            错的做法：差距大 → 再写更长交互 Spec → 继续损耗。
          </p>
        </div>
      </article>
    </div>

    <p class="muted tiny" style="margin-top:14px">
      整段故事缩成一句：高保定交互 → 交接选型与范围 → 按高保实现 → 不像就继续对齐高保（别改去写长 Spec）。
      后面还有文档手册、部署可演示，细节在故事线里。
    </p>
    <div class="share-actions">
      <button type="button" class="phase-open story-link" data-id="678d7823-7ade-43ab-99f7-e90f85299ba9">打开那场核心对话</button>
      <button type="button" class="phase-open ghost" data-phase-jump="p3">看代码落地阶段</button>
      <button type="button" class="phase-open ghost" data-phase-jump="p2">看高保打磨阶段</button>
    </div>
  </section>

  <section class="share-block">
    <h3>8. 我愿意复述给团队的几条原则</h3>
    <p>Matt 那句话我认：原型变便宜了，就把讨论尽量拉到更能「看见」的保真度上。</p>
    <ol class="principles">
      <li><strong>默认先聊清</strong>：范围、非目标、主路径；基础结构不必上代码。</li>
      <li><strong>样子 / 表现说不清 → 做原型</strong>：别继续堆文字。</li>
      <li><strong>一次做两三个能点的版本</strong>：用眼睛选、口述取舍；目的是收集决策，不是评冠军。</li>
      <li><strong>满意了再交接实施</strong>：把原型当参照，不要从文字反推交互。</li>
      <li><strong>像产品但不像高保时</strong>：按高保对齐，不要写更长交互 Spec。</li>
      <li><strong>文档分层</strong>：交互真相在原型；领域 / 权限 / 演进用短文档；对外用手册。</li>
      <li><strong>技能保持短小</strong>：触发条件、必问、禁止、完成定义；本页实录只当案例库。</li>
    </ol>
    <p class="callout soft">
      下一步（第二层）：把这些原则做成 BA + 产品 + 研发能共用的协作包（短技能 + 检查清单）。
    </p>
    <div class="share-actions">
      <button type="button" class="phase-open" data-show-story>去看完整故事线</button>
    </div>
  </section>
</div>
"""


CSS = """
:root {
  --bg: #f3f1ec;
  --panel: #fffdf8;
  --ink: #1c1a16;
  --muted: #6d675c;
  --line: #ddd6c8;
  --req: #0b6e4f;
  --req-bg: #e7f5ef;
  --res: #1f4b99;
  --res-bg: #eef3fb;
  --add: #0a7a3e;
  --add-bg: #e3f6ea;
  --del: #b42318;
  --del-bg: #fde8e6;
  --accent: #c45c26;
  --shadow: 0 1px 0 rgba(28,26,22,.04), 0 8px 24px rgba(28,26,22,.06);
  font-family: "Iowan Old Style", "Palatino Linotype", Palatino, "Songti SC", serif;
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: var(--bg); color: var(--ink); }
body {
  display: grid;
  grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
  background:
    radial-gradient(900px 420px at 10% -10%, #efe6d6 0%, transparent 60%),
    radial-gradient(700px 380px at 100% 0%, #e4ebe4 0%, transparent 55%),
    var(--bg);
  overflow-x: hidden;
}
.sidebar {
  border-right: 1px solid var(--line);
  background: rgba(255,253,248,.9);
  backdrop-filter: blur(8px);
  display: flex; flex-direction: column; min-height: 100vh; max-height: 100vh;
  position: sticky; top: 0; min-width: 0; overflow: hidden;
}
.brand { padding: 20px 18px 12px; border-bottom: 1px solid var(--line); flex: 0 0 auto; }
.brand h1 { margin: 0; font-size: 1.15rem; letter-spacing: .02em; }
.brand p { margin: 6px 0 0; color: var(--muted); font-size: .85rem; line-height: 1.4; }
.brand .phase-open { display: inline-block; width: auto; max-width: 100%; }
.filters {
  display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 12px;
  border-bottom: 1px solid var(--line); flex: 0 0 auto; min-width: 0;
}
.filters button {
  border: 1px solid var(--line); background: #fff; border-radius: 999px;
  padding: 5px 9px; font: inherit; font-size: .72rem; cursor: pointer; color: var(--muted);
  flex: 0 0 auto; white-space: nowrap; line-height: 1.2;
}
.filters button.active { background: var(--ink); color: #fff; border-color: var(--ink); }
.nav { overflow: auto; padding: 8px; flex: 1 1 auto; min-height: 0; min-width: 0; }
.nav-item {
  display: block; width: 100%; text-align: left; border: 0; background: transparent;
  padding: 12px 12px; border-radius: 12px; cursor: pointer; margin-bottom: 4px; font: inherit;
}
.nav-item:hover { background: #f0ebe1; }
.nav-item.active { background: #1c1a16; color: #fff; }
.nav-item.active .nav-meta { color: #cfc8bb; }
.nav-item.sub { opacity: .85; padding-left: 22px; }
.nav-title { display: block; font-size: .92rem; line-height: 1.35; }
.nav-meta { display: block; margin-top: 4px; font-size: .75rem; color: var(--muted); }
.nav-meta .src {
  display: inline-block; font-size: .68rem; padding: 1px 6px; border-radius: 999px;
  background: #efe4d4; color: #6a3b12; margin-right: 2px;
}
.nav-item.active .nav-meta .src { background: #3a342c; color: #f0e6d6; }
.tag-hifi, .tag.hifi {
  display: inline-block; font-size: .68rem; font-weight: 700; padding: 1px 6px;
  border-radius: 999px; background: #c45c26; color: #fff; margin-right: 4px;
  vertical-align: middle;
}
.nav-item.hifi { border-left: 3px solid #c45c26; }
.phase-nav { border-bottom: 1px solid var(--line); }
.phase-head {
  width: 100%; border: 0; background: #f7f2e8; text-align: left; padding: 12px 14px;
  cursor: pointer; font: inherit; display: grid; grid-template-columns: auto 1fr; gap: 2px 10px;
}
.phase-head:hover { background: #efe6d6; }
.phase-head .phase-no {
  grid-row: span 2; align-self: center; font-weight: 700; color: var(--accent);
}
.phase-head .phase-title { font-size: .9rem; font-weight: 650; }
.phase-head .phase-count { font-size: .72rem; color: var(--muted); }
.phase-items { padding: 6px 8px 10px; }
.nav-children {
  display: none; margin: 2px 0 8px 12px; border-left: 1px dashed var(--line); padding-left: 6px;
}
.nav-group.open .nav-children { display: block; }
.nav-toggle {
  display: inline-block; margin: 0 0 6px 14px; border: 0; background: transparent;
  color: var(--muted); font: inherit; font-size: .72rem; cursor: pointer; padding: 0;
}
.nav-toggle:hover { color: var(--accent); }
.tiny { font-size: .78rem; padding: 0 8px; }
.main { overflow: auto; padding: 24px 28px 56px; min-width: 0; width: 100%; }
.conversation[hidden], .story[hidden], .share[hidden], .skills[hidden] { display: none !important; }
.text-link {
  border: 0; background: none; padding: 0; font: inherit; color: var(--accent);
  text-decoration: underline; cursor: pointer;
}
.phase-open.ghost { background: #fff; color: var(--ink); }
.share, .skills { width: 100%; }
.skill-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 12px 0;
}
@media (max-width: 900px) { .skill-grid { grid-template-columns: 1fr; } }
.skill-col {
  background: var(--panel); border: 1px solid var(--line); border-radius: 14px;
  padding: 14px 16px;
}
.skill-col h4 { margin: 0 0 10px; font-size: .95rem; }
.skill-col .tag {
  display: inline-block; font-size: .7rem; font-weight: 700; letter-spacing: .04em;
  text-transform: uppercase; color: var(--accent); margin: 10px 0 6px;
}
.skill-col ul { margin: 0; padding-left: 1.1rem; font-size: .88rem; line-height: 1.55; }
.skill-col li { margin: 0 0 6px; }
.skill-col code { font-size: .82rem; }
.main-flow {
  display: flex; flex-direction: column; align-items: stretch; gap: 6px;
  max-width: 28rem; margin: 8px auto 4px;
}
.main-flow-node {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  background: #1c1a16; color: #f3efe6; border-radius: 12px;
  padding: 12px 14px; border: 1px solid #1c1a16;
}
.main-flow-node strong { font-size: 1rem; letter-spacing: .01em; }
.main-flow-no {
  display: inline-flex; align-items: center; justify-content: center;
  width: 1.6rem; height: 1.6rem; border-radius: 999px;
  font-size: .78rem; font-weight: 700; background: #fff; color: #1c1a16;
}
.main-flow-node.green .main-flow-no { background: #3d9a6a; color: #fff; }
.main-flow-node.yellow .main-flow-no { background: #d4a017; color: #1c1a16; }
.main-flow-node.red .main-flow-no { background: #c44b3a; color: #fff; }
.main-flow-node.ink .main-flow-no { background: #f3efe6; color: #1c1a16; }
.main-flow-node.blue .main-flow-no { background: #5b8def; color: #fff; }
.main-flow-node .flow-note {
  width: 100%; margin: 2px 0 0 2.7rem; font-size: .78rem; color: #cfc8bb;
}
.main-flow-arrow {
  text-align: center; color: var(--muted); font-size: .9rem; line-height: 1;
}
.skill-cards {
  display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 10px 0 18px;
}
.skill-card {
  background: #fff; border: 1px solid var(--line); border-radius: 12px;
  padding: 12px 14px;
}
.skill-card header {
  display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
  margin-bottom: 6px;
}
.skill-card code { font-size: .88rem; font-weight: 700; }
.skill-kind {
  font-size: .68rem; font-weight: 700; letter-spacing: .04em;
  text-transform: uppercase; color: var(--accent); white-space: nowrap;
}
.skill-one { margin: 0 0 8px; font-size: .88rem; color: var(--muted); line-height: 1.45; }
.skill-how { margin: 0; font-size: .86rem; line-height: 1.5; color: var(--ink); }
.skill-how strong { font-weight: 650; }
.skill-how code { font-size: .8rem; }
@media (max-width: 900px) {
  .skill-cards { grid-template-columns: 1fr; }
}
.fail-list { margin: 0; padding: 0; list-style: none; }
.fail-list li {
  margin: 0 0 12px; padding: 12px 14px; border-radius: 12px;
  border: 1px solid var(--line); background: #fff;
}
.fail-list strong { display: block; margin-bottom: 4px; }
.fail-list span { color: var(--muted); font-size: .88rem; line-height: 1.5; }
.share-block {
  background: var(--panel); border: 1px solid var(--line); border-radius: 18px;
  padding: 20px 22px; margin: 0 0 16px; box-shadow: var(--shadow); width: 100%;
}
.share-block h3 { margin: 0 0 12px; font-size: 1.15rem; }
.share-block h4 { margin: 0 0 8px; font-size: 1rem; }
.share-block p { margin: 0 0 10px; line-height: 1.6; }
.share-block ol { margin: 0 0 10px; padding-left: 1.2rem; line-height: 1.55; }
.share-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
.fidelity { list-style: none; padding: 0; display: grid; gap: 8px; }
.fidelity li {
  padding: 10px 12px; border-radius: 12px; border: 1px solid var(--line); background: #fff;
}
.callout {
  margin: 12px 0 0; padding: 12px 14px; border-radius: 12px;
  background: #fff7f0; border: 1px solid #f0d2bc; line-height: 1.55;
}
.callout.soft { background: #f3f1ec; border-color: var(--line); }
.chain-grid {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 12px 0;
}
@media (max-width: 900px) { .chain-grid { grid-template-columns: 1fr; } }
.chain {
  border-radius: 14px; padding: 14px; border: 1px solid var(--line); background: #fff;
}
.chain.bad { border-color: #e8b4ae; background: #fff8f7; }
.chain.good { border-color: #b9dcc4; background: #f3faf5; }
.chain-flow { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .82rem; line-height: 1.5; }
.chain .hot { color: var(--del); font-weight: 700; }
.chain .ok { color: var(--add); font-weight: 700; }
.map-table { width: 100%; border-collapse: collapse; font-size: .9rem; margin: 10px 0 12px; }
.map-table th, .map-table td {
  border: 1px solid var(--line); padding: 10px 12px; text-align: left; vertical-align: top;
}
.map-table th { background: #f7f2e8; }
.principles li { margin: 0 0 8px; }
.story-link.inline {
  display: inline !important; flex-direction: unset; padding: 0; margin: 0; border: 0;
  background: none; color: var(--accent); text-decoration: underline; cursor: pointer; font: inherit;
}
.phase-open.story-link {
  display: inline-flex; flex-direction: row; align-items: center;
  color: #fff; text-decoration: none;
}
.detail-list { margin: 0 0 12px; padding-left: 1.2rem; line-height: 1.55; }
.detail-list li { margin: 0 0 10px; }
.callout.lesson { background: #fff7f0; border-color: #f0d2bc; }
.lesson-label {
  margin: 0 0 8px; font-size: .78rem; font-weight: 700; letter-spacing: .06em;
  text-transform: uppercase; color: var(--accent);
}
.quote-list { margin: 8px 0 0; padding-left: 1.1rem; line-height: 1.55; }
.quote-list li { margin: 0 0 6px; }
.chain-beat {
  margin: 10px 0 12px; padding: 12px 14px; border-radius: 12px;
  background: #1c1a16; color: #f3efe6; font-size: .78rem; line-height: 1.55;
  overflow-x: auto; white-space: pre-wrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.share-block code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: .85em; background: #f0ebe1; padding: 0.1em 0.35em; border-radius: 4px;
}
.fig {
  margin: 12px 0 14px; padding: 0; border: 1px solid var(--line); border-radius: 14px;
  background: #fff; overflow: hidden; box-shadow: var(--shadow);
}
.fig img { display: block; width: 100%; height: auto; vertical-align: top; }
.fig figcaption {
  margin: 0; padding: 8px 12px; font-size: .78rem; color: var(--muted);
  border-top: 1px solid var(--line); background: #faf7f1; line-height: 1.4;
}
.fig.wide { max-width: none; }
.fig-grid {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 12px 0;
}
.fig-grid .fig { margin: 0; }
.compare-grid {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 12px 0;
}
.compare-grid .fig { margin: 0; border-color: #e0d5c4; }
@media (max-width: 900px) {
  .fig-grid, .compare-grid { grid-template-columns: 1fr; }
}
.journey-tl { display: flex; flex-direction: column; gap: 14px; margin-top: 8px; }
.tl-step {
  border: 1px solid var(--line); border-radius: 16px; padding: 14px 16px 10px;
  background: #fff; box-shadow: var(--shadow); position: relative;
}
.tl-step header { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 8px; }
.tl-step h4 { margin: 0 0 4px; font-size: 1.02rem; }
.tl-no {
  flex: 0 0 auto; width: 2rem; height: 2rem; border-radius: 999px;
  background: var(--accent); color: #fff; display: grid; place-items: center;
  font-weight: 700; font-size: .95rem;
}
.tl-meta { margin: 0; color: var(--muted); font-size: .8rem; }
.tl-quote {
  margin: 0 0 10px; padding: 10px 12px; border-left: 3px solid var(--accent);
  background: #fff7f0; color: #3a342c; font-size: .9rem; line-height: 1.55;
}
.tl-box {
  margin: 10px 0 12px; padding: 12px 14px; border-radius: 12px;
  background: #f3faf5; border: 1px solid #b9dcc4; font-size: .9rem;
}
.tl-box ul { margin: 6px 0 0; padding-left: 1.2rem; }
.tl-step.lesson-step { border-color: #f0d2bc; background: #fffaf5; }
.diagram {
  margin: 12px 0 14px; padding: 16px; border: 1px solid var(--line); border-radius: 16px;
  background: #fff; box-shadow: var(--shadow);
}
.diagram figcaption, .diagram-cap {
  margin: 12px 0 0; font-size: .8rem; color: var(--muted); line-height: 1.45;
}
.flow-row {
  display: flex; flex-wrap: wrap; align-items: stretch; gap: 6px 0; justify-content: flex-start;
}
.flow-node {
  flex: 1 1 7.5rem; min-width: 6.5rem; max-width: 9.5rem;
  border: 1px solid var(--line); border-radius: 12px; background: #f7f2e8;
  padding: 10px 10px; text-align: center;
}
.flow-node.hot { background: #fde8e6; border-color: #e8b4ae; }
.flow-node.ok { background: #e3f6ea; border-color: #b9dcc4; }
.fn-title {
  display: block; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: .78rem; font-weight: 700; color: var(--ink);
}
.fn-sub { display: block; margin-top: 4px; font-size: .72rem; color: var(--muted); line-height: 1.3; }
.flow-arrow {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  min-width: 1.6rem; padding: 0 2px; color: var(--muted); font-size: .65rem;
}
.fa-line {
  display: block; width: 1.1rem; height: 2px; background: #b7aea0; position: relative;
}
.fa-line::after {
  content: ""; position: absolute; right: -1px; top: -3px;
  border: 4px solid transparent; border-left-color: #b7aea0;
}
.fa-label { margin-bottom: 2px; white-space: nowrap; }
.flow-loop { margin: 10px 0 0; font-size: .8rem; color: var(--add); }
.fid-spectrum { position: relative; }
.fid-scale-label {
  display: flex; align-items: center; gap: 10px; margin: 0 0 10px;
  font-size: .75rem; font-weight: 700; letter-spacing: .04em;
  text-transform: uppercase; color: var(--muted);
}
.fid-scale-line {
  flex: 1; height: 2px; border-radius: 999px;
  background: linear-gradient(90deg, #d9d2c5, #3d9a6a 55%, #1c1a16);
}
.fid-rail {
  list-style: none; margin: 0; padding: 0; display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px;
}
.fid-step {
  border: 1px solid var(--line); border-radius: 14px; padding: 12px; background: #f7f2e8;
  display: flex; flex-direction: column; gap: 4px; min-height: 7.2rem;
}
.fid-step.mid { background: #eef2fb; border-color: #c5d0ea; }
.fid-step.high { background: #e3f6ea; border-color: #b9dcc4; }
.fid-step.prod { background: #1c1a16; color: #f3efe6; border-color: #1c1a16; }
.fid-step.prod span { color: #cfc8bb; }
.fid-no {
  width: 1.4rem; height: 1.4rem; border-radius: 999px; background: var(--accent); color: #fff;
  display: grid; place-items: center; font-size: .72rem; font-weight: 700;
}
.fid-step strong { font-size: .86rem; line-height: 1.25; }
.fid-cn {
  display: block; font-style: normal; font-size: .72rem; font-weight: 650;
  color: var(--accent); margin-top: 2px; line-height: 1.35;
}
.fid-step.prod .fid-cn { color: #e8c4a8; }
.fid-step span { font-size: .72rem; color: var(--muted); line-height: 1.35; }
@media (max-width: 1100px) {
  .fid-rail { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 700px) {
  .fid-rail { grid-template-columns: 1fr; }
}
.jump-grid, .example-grid, .abc-grid {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 0;
}
.abc-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.jump-card, .ex-card, .abc-card {
  border: 1px solid var(--line); border-radius: 14px; padding: 14px; background: #faf7f1;
}
.jump-card.bad, .ex-card.bad { background: #fff8f7; border-color: #e8b4ae; }
.jump-card.good, .ex-card.good { background: #f3faf5; border-color: #b9dcc4; }
.jump-card h4, .ex-card h4 { margin: 0 0 8px; font-size: .95rem; }
.jump-card p, .ex-card p, .abc-card p { margin: 0 0 6px; font-size: .85rem; line-height: 1.45; color: var(--muted); }
.jump-path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .8rem !important; color: var(--ink) !important; }
.jump-gap { color: var(--del); font-weight: 700; }
.jump-ok { color: var(--add); font-weight: 700; }
.ex-card ol { margin: 0; padding-left: 1.1rem; font-size: .85rem; line-height: 1.5; color: var(--muted); }
.abc-card { text-align: center; }
.abc-tag {
  display: inline-grid; place-items: center; width: 1.6rem; height: 1.6rem; border-radius: 999px;
  background: var(--ink); color: #fff; font-size: .75rem; font-weight: 700; margin-bottom: 6px;
}
.abc-card strong { display: block; margin-bottom: 4px; }
.abc-note { margin: 12px 0 0; text-align: center; font-size: .85rem; color: var(--ink); }
.wayfinder { max-width: 52rem; margin: 0 auto; }
.wf-start, .wf-node {
  border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px; background: #f7f2e8;
  text-align: center; font-weight: 650;
}
.wf-node span { display: block; margin-top: 4px; font-weight: 400; font-size: .78rem; color: var(--muted); }
.wf-node.grill { background: #ebe4f7; border-color: #c4b5e0; }
.wf-node.proto { background: #e3f6ea; border-color: #b9dcc4; }
.wf-node.muted { background: #fff; font-weight: 500; font-size: .88rem; }
.wf-arrow-down {
  width: 2px; height: 18px; background: #b7aea0; margin: 6px auto;
  position: relative;
}
.wf-arrow-down::after {
  content: ""; position: absolute; left: -4px; bottom: -1px;
  border: 5px solid transparent; border-top-color: #b7aea0;
}
.wf-branch {
  display: grid; grid-template-columns: 1fr 1.4fr; gap: 14px; margin-top: 8px;
}
.wf-arm {
  border: 1px dashed var(--line); border-radius: 14px; padding: 12px; background: #fffcf7;
}
.wf-label { display: block; font-size: .75rem; color: var(--muted); margin-bottom: 8px; text-align: center; }
.wf-label.signal { color: var(--add); font-weight: 650; }
.when-grid {
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 8px 0 4px;
}
.when-card {
  background: #fff; border: 1px solid var(--line); border-radius: 14px;
  padding: 12px 12px 14px; display: flex; flex-direction: column; gap: 6px;
  border-top: 3px solid #c4b5e0;
}
.when-card.ui { border-top-color: #5b8def; }
.when-card.logic { border-top-color: #3d9a6a; }
.when-card.either { border-top-color: #c47a3a; }
.when-no {
  font-size: .68rem; font-weight: 700; letter-spacing: .06em; color: var(--muted);
}
.when-card strong { font-size: .92rem; line-height: 1.35; }
.when-focus { font-size: .78rem; color: var(--muted); line-height: 1.4; }
.when-card em {
  font-style: normal; font-size: .8rem; color: var(--ink);
  margin-top: auto; padding-top: 8px; border-top: 1px dashed var(--line);
}
.branch-compare {
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 8px 0 4px;
}
.branch-card {
  background: #fff; border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px;
}
.branch-card.ui { border-color: #b7c9ef; background: #f5f8ff; }
.branch-card.logic { border-color: #b9dcc4; background: #f3faf5; }
.branch-kicker {
  margin: 0 0 4px; font-size: .7rem; font-weight: 700; letter-spacing: .05em;
  text-transform: uppercase; color: var(--accent);
}
.branch-card h4 { margin: 0 0 8px; font-size: 1.05rem; }
.branch-q { margin: 0 0 10px; font-size: .9rem; line-height: 1.5; }
.branch-card ul { margin: 0 0 10px; padding-left: 1.1rem; font-size: .85rem; line-height: 1.5; }
.branch-card li { margin: 0 0 4px; }
.branch-out {
  margin: 0; padding-top: 8px; border-top: 1px dashed var(--line);
  font-size: .82rem; color: var(--muted); line-height: 1.45;
}
@media (max-width: 900px) {
  .when-grid, .branch-compare { grid-template-columns: 1fr; }
}
.fid-example {
  margin: 14px 0 12px; padding: 14px 16px; border-radius: 14px;
  border: 1px solid var(--line); background: #fffcf7;
}
.fid-example h4 { margin: 0 0 12px; font-size: .95rem; }
.fid-ex-row {
  display: grid; grid-template-columns: 1fr auto 1fr; gap: 10px; align-items: stretch;
}
.fid-ex {
  border-radius: 12px; padding: 12px; border: 1px solid var(--line); background: #fff;
}
.fid-ex.bad { background: #fff8f7; border-color: #e8b4ae; }
.fid-ex.good { background: #f3faf5; border-color: #b9dcc4; }
.fid-ex.arrow {
  border: 0; background: transparent; display: grid; place-items: center;
  font-size: 1.4rem; color: var(--muted); padding: 0;
}
.fid-ex-label {
  display: inline-block; font-size: .72rem; font-weight: 700; letter-spacing: .04em;
  text-transform: uppercase; color: var(--accent); margin-bottom: 6px;
}
.fid-ex p { margin: 0; font-size: .88rem; line-height: 1.5; color: var(--ink); }
.fid-ex-foot {
  margin: 12px 0 0; padding-top: 10px; border-top: 1px dashed var(--line);
  font-size: .85rem; color: var(--muted); line-height: 1.5;
}
@media (max-width: 900px) {
  .fid-ex-row { grid-template-columns: 1fr; }
  .fid-ex.arrow { transform: rotate(90deg); padding: 4px 0; }
}
@media (max-width: 900px) {
  .fid-rail, .jump-grid, .example-grid, .abc-grid, .wf-branch, .when-grid, .branch-compare { grid-template-columns: 1fr; }
  .flow-node { max-width: none; flex: 1 1 42%; }
}
.story, .conversation { width: 100%; max-width: none; }
.story-hero {
  width: 100%; margin-bottom: 22px; padding: 8px 0 8px;
}
.story-hero .eyebrow {
  margin: 0 0 8px; color: var(--accent); letter-spacing: .08em; font-size: .78rem; font-weight: 700;
  text-transform: uppercase;
}
.story-hero h2 { margin: 0 0 12px; font-size: clamp(1.7rem, 2.4vw, 2.35rem); line-height: 1.2; max-width: none; }
.story-hero .lede { margin: 0; color: var(--muted); font-size: 1.02rem; line-height: 1.65; max-width: 72ch; }
.hero-stats {
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px;
  margin-top: 20px; width: 100%; max-width: none;
}
@media (max-width: 1100px) {
  .hero-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
.hero-stats div {
  background: var(--panel); border: 1px solid var(--line); border-radius: 14px;
  padding: 14px 16px; box-shadow: var(--shadow);
}
.hero-stats strong { display: block; font-size: 1.45rem; }
.hero-stats span { color: var(--muted); font-size: .78rem; }
.phase-grid { display: flex; flex-direction: column; gap: 18px; width: 100%; max-width: none; }
.phase-card {
  background: var(--panel); border: 1px solid var(--line); border-radius: 18px;
  padding: 18px 18px 16px; box-shadow: var(--shadow);
}
.phase-card header { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 8px; }
.phase-card .phase-no {
  font-size: 1.4rem; font-weight: 700; color: var(--accent); min-width: 2rem;
}
.phase-card h3 { margin: 0; font-size: 1.15rem; }
.phase-card .when { margin: 4px 0 0; color: var(--muted); font-size: .8rem; }
.phase-card .summary { margin: 0 0 12px; line-height: 1.55; }
.phase-stats { display: flex; gap: 14px; flex-wrap: wrap; color: var(--muted); font-size: .82rem; margin-bottom: 10px; }
.phase-sessions { margin: 0 0 12px; padding-left: 1.15rem; }
.phase-sessions li { margin: 0 0 6px; }
.sess-h, .milestones h4, .cross-links h4 {
  margin: 14px 0 8px; font-size: .9rem; color: var(--ink);
}
.milestones ol { margin: 0 0 8px; padding-left: 1.15rem; color: var(--muted); font-size: .9rem; line-height: 1.5; }
.milestones li { margin: 0 0 4px; }
.cross-links {
  margin: 12px 0; padding: 12px; border-radius: 12px; border: 1px dashed var(--accent);
  background: #fff7f0;
}
.story-link {
  border: 0; background: transparent; padding: 0; font: inherit; color: var(--ink);
  cursor: pointer; text-align: left; display: flex; flex-direction: column; gap: 2px;
}
.story-link:hover { color: var(--accent); }
.story-link span { color: var(--muted); font-size: .75rem; }
.story-link.core {
  padding: 8px 10px; border-radius: 10px; background: #fff; border: 1px solid #f0d2bc; width: 100%;
}
.phase-open, .back-story {
  border: 1px solid var(--line); background: #1c1a16; color: #fff; border-radius: 999px;
  padding: 8px 14px; font: inherit; font-size: .85rem; cursor: pointer;
}
.back-story { background: #fff; color: var(--ink); margin-bottom: 14px; }
.phase-open:hover { background: #3a342c; }
.conv-head h2 { margin: 0 0 10px; font-size: 1.55rem; line-height: 1.25; max-width: none; }
.stats { display: flex; flex-wrap: wrap; gap: 10px 16px; color: var(--muted); font-size: .88rem; margin-bottom: 16px; }
.stats code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .8rem; }
.tag.sub { background: #efe4d4; color: #6a3b12; padding: 2px 8px; border-radius: 999px; }
.tag.phase { background: #1c1a16; color: #fff; padding: 2px 8px; border-radius: 999px; }
.conv-tip { margin: 0 0 14px; font-size: .86rem; }
.files-box {
  background: var(--panel); border: 1px solid var(--line); border-radius: 16px;
  padding: 14px 16px; margin-bottom: 22px; box-shadow: var(--shadow); width: 100%; max-width: none;
}
.files-box h3 { margin: 0 0 8px; font-size: .95rem; }
.file-list { margin: 0; padding-left: 1.1rem; }
.file-list code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .82rem; }
.questions-box { margin-top: 12px; }
.question-list { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.q-item { margin: 0; }
.q-link {
  display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; align-items: start;
  text-decoration: none; color: inherit; padding: 10px 12px; border-radius: 12px;
  border: 1px solid var(--line); background: #fff;
}
.q-link:hover { border-color: var(--req); background: var(--req-bg); }
.q-no {
  grid-row: span 2; align-self: start; font-size: .72rem; font-weight: 700;
  color: #fff; background: var(--req); border-radius: 999px; padding: 3px 8px; margin-top: 2px;
}
.q-text { font-size: .92rem; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
.q-time { grid-column: 2; color: var(--muted); font-size: .75rem; }
.timeline { display: flex; flex-direction: column; gap: 14px; width: 100%; max-width: none; }
.card {
  background: var(--panel); border: 1px solid var(--line); border-radius: 16px;
  padding: 14px 16px 16px; box-shadow: var(--shadow);
}
.card.request { border-left: 4px solid var(--req); background: linear-gradient(180deg, var(--req-bg), var(--panel) 42%); }
.card.response { border-left: 4px solid var(--res); background: linear-gradient(180deg, var(--res-bg), var(--panel) 36%); }
.card header { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 10px; align-items: center; }
.pill {
  display: inline-block; font-size: .72rem; font-weight: 700; letter-spacing: .04em;
  text-transform: uppercase; padding: 3px 8px; border-radius: 999px;
}
.pill.req { background: var(--req); color: #fff; }
.pill.res { background: var(--res); color: #fff; }
.meta { color: var(--muted); font-size: .78rem; }
.body p, .assistant-text p { margin: 0 0 .7rem; line-height: 1.55; }
.body p:last-child, .assistant-text p:last-child { margin-bottom: 0; }
.muted { color: var(--muted); }
pre.code, .tool pre, pre.diff {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: .78rem; line-height: 1.45; overflow: auto;
  background: #1e1c18; color: #f4efe6; border-radius: 12px; padding: 12px 14px;
}
.tools, .changes { margin-top: 14px; }
.tools h4, .changes h4 { margin: 0 0 8px; font-size: .86rem; color: var(--muted); font-weight: 600; }
.tool { border: 1px solid var(--line); border-radius: 10px; margin-bottom: 6px; background: #fff; }
.tool summary {
  cursor: pointer; padding: 8px 10px; list-style: none; display: flex; gap: 8px; align-items: baseline;
}
.tool summary::-webkit-details-marker { display: none; }
.tool-name {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .75rem;
  background: #efe9dc; padding: 2px 6px; border-radius: 6px; color: #3d3426; flex: 0 0 auto;
}
.tool.edit .tool-name { background: #f3d9c6; color: #6a2f0d; }
.tool-sum { color: var(--muted); font-size: .8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tool pre { margin: 0; border-radius: 0 0 10px 10px; max-height: 280px; }
.change-block { margin-bottom: 12px; }
.fold-block {
  border: 1px solid var(--line); border-radius: 12px; background: #fff; margin-bottom: 8px; overflow: hidden;
}
.fold-block > summary {
  cursor: pointer; padding: 10px 12px; list-style: none; font-size: .82rem; color: var(--muted);
  display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
}
.fold-block > summary::-webkit-details-marker { display: none; }
.fold-block > summary::before {
  content: "▸"; color: var(--accent); font-weight: 700; margin-right: 4px;
}
.fold-block[open] > summary::before { content: "▾"; }
.fold-block > summary:hover { background: #f7f2e8; }
.fold-body { border-top: 1px solid var(--line); }
.fold-body pre.diff, .fold-body pre.code { border-radius: 0; margin: 0; max-height: 420px; }
.fold-changes > summary { font-weight: 650; color: var(--ink); }
.artifacts {
  margin: 14px 0 16px; padding: 14px; border: 1px solid var(--line); border-radius: 14px; background: #fbf8f2;
}
.artifacts h4 { margin: 0 0 4px; font-size: .95rem; }
.art-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0; }
.art-tab {
  border: 1px solid var(--line); background: #fff; border-radius: 999px; padding: 6px 10px;
  font: inherit; font-size: .75rem; cursor: pointer; color: var(--muted);
}
.art-tab.active { background: var(--accent); border-color: var(--accent); color: #fff; }
.art-pane[hidden] { display: none !important; }
.art-meta { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; margin-bottom: 8px; }
.art-meta p { margin: 4px 0 0; font-size: .82rem; line-height: 1.45; }
.art-link {
  display: inline-block; padding: 6px 10px; border-radius: 999px; border: 1px solid var(--line);
  text-decoration: none; color: var(--ink); font-size: .78rem; background: #fff;
}
.art-frame-wrap {
  border: 1px solid var(--line); border-radius: 12px; overflow: hidden; background: #fff;
  height: min(72vh, 720px); width: 100%;
}
.art-frame { width: 100%; height: 100%; border: 0; background: #fff; }
.lede-note { margin: 12px 0 0; color: var(--muted); font-size: .88rem; line-height: 1.5; max-width: 72ch; }
.phase-card { width: 100%; }
.artifacts { width: 100%; }
.diff-meta { margin: 0 0 6px; font-size: .82rem; color: var(--muted); }
.diff-meta code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--ink); }
.badge {
  display: inline-block; font-size: .68rem; font-weight: 700; padding: 2px 6px; border-radius: 6px;
  background: #e8e2d6; margin-right: 6px; vertical-align: middle;
}
.badge.write { background: #d8f0e2; color: var(--add); }
.badge.replace { background: #f3d9c6; color: #8a3b10; }
pre.diff { background: #16140f; }
pre.diff .add { color: #7dcea0; display: block; background: rgba(10,122,62,.15); }
pre.diff .del { color: #f5a39a; display: block; background: rgba(180,35,24,.18); }
pre.diff .ctx { color: #c9c2b4; display: block; }
pre.diff .hunk { color: #8ab4f8; display: block; margin-top: 6px; }
pre.diff .file { color: #e0c38c; display: block; }
.add-n { color: var(--add); font-weight: 700; }
.del-n { color: var(--del); font-weight: 700; }
.turn-end {
  text-align: center; color: var(--muted); font-size: .78rem; padding: 4px 0;
  border-top: 1px dashed var(--line); border-bottom: 1px dashed var(--line);
}
.turn-end.err { color: var(--del); }
.empty {
  max-width: 36rem; margin-top: 20vh; color: var(--muted);
}
@media (max-width: 900px) {
  body { grid-template-columns: 1fr; }
  .sidebar { position: relative; min-height: auto; max-height: 48vh; width: 100%; }
  .hero-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
"""

JS = """
(function () {
  const buttons = [...document.querySelectorAll('.nav-item')];
  const sections = [...document.querySelectorAll('.conversation')];
  const story = document.getElementById('story');
  const share = document.getElementById('share');
  const skills = document.getElementById('skills');
  const filterBtns = [...document.querySelectorAll('[data-filter]')];
  const brandBtns = {
    skills: document.getElementById('btn-skills'),
    share: document.getElementById('btn-share'),
    story: document.getElementById('btn-story'),
  };
  let filter = 'skills';
  let current = null;

  function setBrandActive(which) {
    Object.entries(brandBtns).forEach(([key, btn]) => {
      if (!btn) return;
      btn.classList.toggle('ghost', key !== which);
    });
  }

  function hideMainPanels() {
    if (story) story.hidden = true;
    if (share) share.hidden = true;
    if (skills) skills.hidden = true;
    sections.forEach((s) => { s.hidden = true; });
  }

  function showStory() {
    current = null;
    hideMainPanels();
    if (story) story.hidden = false;
    setBrandActive('story');
    buttons.forEach((b) => b.classList.remove('active'));
    document.querySelector('.main')?.scrollTo({ top: 0 });
  }

  function showShare() {
    current = null;
    hideMainPanels();
    if (share) share.hidden = false;
    setBrandActive('share');
    buttons.forEach((b) => b.classList.remove('active'));
    document.querySelector('.main')?.scrollTo({ top: 0 });
  }

  function showSkills() {
    current = null;
    hideMainPanels();
    if (skills) skills.hidden = false;
    setBrandActive('skills');
    buttons.forEach((b) => b.classList.remove('active'));
    document.querySelector('.main')?.scrollTo({ top: 0 });
  }

  function select(id) {
    if (!id) { showStory(); return; }
    current = id;
    hideMainPanels();
    setBrandActive('story');
    buttons.forEach((b) => b.classList.toggle('active', b.dataset.id === id));
    sections.forEach((s) => { s.hidden = s.dataset.id !== id; });
    const sec = sections.find((s) => s.dataset.id === id);
    if (sec) {
      sec.querySelector('.back-story') || insertBack(sec);
      sec.querySelector('.conv-head')?.scrollIntoView({ block: 'start' });
    }
  }

  function insertBack(sec) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'back-story';
    btn.textContent = '← 返回产品落地故事线';
    btn.addEventListener('click', () => {
      filter = 'story';
      applyFilter();
      showStory();
    });
    sec.insertBefore(btn, sec.firstChild);
  }

  function applyFilter() {
    filterBtns.forEach((b) => b.classList.toggle('active', b.dataset.filter === filter));
    document.querySelectorAll('.phase-nav').forEach((p) => {
      const phase = p.dataset.phase;
      const items = [...p.querySelectorAll('.nav-item')];
      items.forEach((b) => {
        let show = true;
        if (filter === 'hifi') show = b.dataset.hifi === '1';
        if (filter === 'main') show = !b.classList.contains('sub');
        if (filter === 'edits') show = Number(b.dataset.edits || '0') > 0;
        if (filter.startsWith('p')) show = phase === filter;
        if (filter === 'share' || filter === 'skills') show = true;
        b.hidden = !show;
      });
      const any = items.some((b) => !b.hidden);
      const keepOpen = filter === 'story' || filter === 'all' || filter === 'share' || filter === 'skills';
      p.hidden = filter.startsWith('p') ? phase !== filter : (!keepOpen && !any);
      if (keepOpen) p.hidden = false;
    });
    if (filter === 'skills') showSkills();
    else if (filter === 'share') showShare();
    else if (filter === 'story') showStory();
  }

  buttons.forEach((b) => {
    const section = sections.find((s) => s.dataset.id === b.dataset.id);
    const edits = section ? section.querySelectorAll('.change-block').length : 0;
    b.dataset.edits = String(edits);
    b.addEventListener('click', () => select(b.dataset.id));
  });
  document.querySelectorAll('[data-phase-jump]').forEach((b) => {
    b.addEventListener('click', () => {
      const phase = b.dataset.phaseJump;
      filter = phase;
      applyFilter();
      const first = document.querySelector(`.nav-item[data-phase="${phase}"]:not(.sub)`);
      if (first) select(first.dataset.id);
      else showStory();
      document.getElementById('phase-' + phase)?.scrollIntoView({ block: 'start' });
    });
  });
  document.querySelectorAll('.story-link').forEach((b) => {
    b.addEventListener('click', () => select(b.dataset.id));
  });
  filterBtns.forEach((b) => b.addEventListener('click', () => {
    filter = b.dataset.filter;
    applyFilter();
    if (filter === 'story' || filter === 'all') showStory();
  }));
  document.getElementById('btn-story')?.addEventListener('click', () => {
    filter = 'story';
    applyFilter();
    showStory();
  });
  document.getElementById('btn-share')?.addEventListener('click', () => {
    filter = 'share';
    applyFilter();
    showShare();
  });
  document.getElementById('btn-skills')?.addEventListener('click', () => {
    filter = 'skills';
    applyFilter();
    showSkills();
  });
  document.querySelectorAll('[data-show-share]').forEach((b) => {
    b.addEventListener('click', () => { filter = 'share'; applyFilter(); showShare(); });
  });
  document.querySelectorAll('[data-show-story]').forEach((b) => {
    b.addEventListener('click', () => { filter = 'story'; applyFilter(); showStory(); });
  });
  document.querySelectorAll('[data-show-skills]').forEach((b) => {
    b.addEventListener('click', () => { filter = 'skills'; applyFilter(); showSkills(); });
  });
  document.querySelectorAll('[data-toggle-kids]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const group = btn.closest('.nav-group');
      if (!group) return;
      group.classList.toggle('open');
      const n = group.querySelectorAll('.nav-children .nav-item').length;
      btn.textContent = (group.classList.contains('open') ? '▾' : '▸') + ' 子代理 ' + n;
    });
  });
  document.querySelectorAll('.artifacts').forEach((box) => {
    const tabs = [...box.querySelectorAll('.art-tab')];
    const panes = [...box.querySelectorAll('.art-pane')];
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const id = tab.dataset.art;
        tabs.forEach((t) => t.classList.toggle('active', t === tab));
        panes.forEach((p) => {
          const on = p.dataset.artPane === id;
          p.classList.toggle('active', on);
          p.hidden = !on;
        });
      });
    });
  });
  showSkills();
})();
"""


def build_html(
    conversations: list[Conversation],
    sources: list[Path],
    artifacts: list[dict[str, str]] | None = None,
) -> str:
    generated = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    nav = render_nav(conversations)
    skills = render_skills_guide()
    share = render_share_playbook()
    story = render_story_overview(conversations, artifacts or [])
    body = "\n".join(render_conversation(c) for c in conversations)
    total_req = sum(c.request_count for c in conversations)
    total_chg = sum(c.change_count for c in conversations)
    main_n = sum(1 for c in conversations if not c.is_subagent)
    phase_filters = "".join(
        f'<button type="button" data-filter="{html.escape(p["id"])}">{html.escape(p["no"])}</button>'
        for p in JOURNEY_PHASES
    )
    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Open Dashboard 产品落地实录 · 可分享方法论</title>
  <style>{CSS}</style>
</head>
<body>
  <aside class="sidebar">
    <div class="brand">
      <h1>产品落地实录</h1>
      <p>Skills 梳理 · 可分享方法论 · 故事线证据<br>
      {main_n} 场主对话 · {total_req} 次请求 · {total_chg} 处代码变更<br>
      生成于 {html.escape(generated)}</p>
      <button type="button" id="btn-skills" class="phase-open" style="margin-top:10px">mattpocock/skills 梳理</button>
      <button type="button" id="btn-share" class="phase-open ghost" style="margin-top:8px">可分享方法论</button>
      <button type="button" id="btn-story" class="phase-open ghost" style="margin-top:8px">故事线总览</button>
    </div>
    <div class="filters">
      <button type="button" data-filter="skills" class="active">Skills</button>
      <button type="button" data-filter="share">分享稿</button>
      <button type="button" data-filter="story">故事线</button>
      <button type="button" data-filter="all">全部对话</button>
      <button type="button" data-filter="hifi">高保</button>
      {phase_filters}
    </div>
    <nav class="nav" id="phase-nav">{nav}</nav>
  </aside>
  <main class="main">
    {skills}
    {share}
    {story}
    {body}
  </main>
  <script>{JS}</script>
</body>
</html>
"""


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        action="append",
        dest="sources",
        help="agent-transcripts 目录，可重复指定；默认合并本仓库两个历史路径",
    )
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument(
        "--all",
        action="store_true",
        help="不过滤，导出目录内全部会话（默认仅 open-dashboard / 仪表盘相关）",
    )
    args = parser.parse_args(argv)

    sources = [p.expanduser().resolve() for p in (args.sources or DEFAULT_TRANSCRIPT_SOURCES)]
    out: Path = args.out.expanduser().resolve()

    existing = [s for s in sources if s.is_dir()]
    missing = [s for s in sources if not s.is_dir()]
    for s in missing:
        print(f"跳过不存在的目录: {s}", file=sys.stderr)
    if not existing:
        print("没有任何可用的 transcript 目录", file=sys.stderr)
        return 1

    conversations = discover_conversations(existing, dashboard_only=not args.all)
    if not conversations:
        print("未找到 jsonl", file=sys.stderr)
        return 1

    out.parent.mkdir(parents=True, exist_ok=True)
    # clean previous artifact snapshots for deterministic export
    art_root = out.parent / "artifacts"
    if art_root.exists():
        shutil.rmtree(art_root)
    artifacts = prepare_hifi_artifacts(out.parent)
    copy_share_assets(out.parent)
    html_doc = build_html(conversations, existing, artifacts)
    out.write_text(html_doc, encoding="utf-8")
    print(f"Wrote {out}")
    print(f"Sources: {len(existing)}")
    for s in existing:
        print(f"  - {s}")
    print(f"Artifacts: {len(artifacts)}")
    print(f"Conversations: {len(conversations)} (main={sum(1 for c in conversations if not c.is_subagent)})")
    print(f"Requests: {sum(c.request_count for c in conversations)}")
    print(f"Code changes: {sum(c.change_count for c in conversations)}")
    print(f"Open: file://{out}")
    print(f"Preview server: cd {out.parent} && python3 -m http.server 8765")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
