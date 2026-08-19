"""Run lifecycle helpers for Harness public run endpoints.

The controller keeps run/event/trace bookkeeping out of FastAPI routes while
leaving the existing agent generator behavior intact.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Optional

from agent import session_store
from agent.types import parse_sse_event


ANSWER_EVENTS = {"answer_sql", "answer_table", "answer_chart", "answer_insight"}
TERMINAL_STATUSES = {"done", "answered", "awaiting_confirm", "error", "cancelled"}


@dataclass
class RunController:
    conversation_id: str
    run_id: str
    message: str = ""
    intent: Optional[str] = None
    style_id: Optional[str] = None
    capture_artifact: bool = True
    append_assistant_messages: bool = True
    finish_reason: str = "error"
    finish_detail: Optional[str] = None
    artifact: Dict[str, Any] = field(default_factory=dict)

    def observe_chunk(self, chunk: str) -> None:
        parsed = parse_sse_event(chunk)
        if not parsed:
            return
        event_type, data = parsed
        session_store.append_event(self.conversation_id, event_type, data, run_id=self.run_id)
        if self.capture_artifact and event_type in ANSWER_EVENTS:
            self.artifact[event_type] = data
        if event_type == "finish":
            self.finish_reason = str(data.get("reason") or "done")
            detail = data.get("detail")
            self.finish_detail = str(detail) if detail is not None else None
            self._link_dashboard(data)
        elif event_type == "board_ready":
            self._link_dashboard(data)
        elif event_type == "message_delta" and self.append_assistant_messages:
            text = str(data.get("text") or "")
            if text:
                session_store.append_message(self.conversation_id, "assistant", text, [])

    def fail(self, detail: str = "exception") -> None:
        self.finish_reason = "error"
        self.finish_detail = detail

    def complete(self) -> None:
        status = self.finish_reason if self.finish_reason in TERMINAL_STATUSES else "done"
        if self.capture_artifact and self.artifact:
            self.artifact.setdefault("message", self.message)
            self.artifact.setdefault("intent", self.intent)
            self.artifact.setdefault("styleId", self.style_id)
            session_store.set_run_artifact(self.conversation_id, self.run_id, self.artifact)
        session_store.finish_run(self.conversation_id, self.run_id, status, self.finish_detail)

    def _link_dashboard(self, data: Dict[str, Any]) -> None:
        dashboard_id = data.get("dashboardId")
        if dashboard_id:
            session_store.link_dashboard(self.conversation_id, str(dashboard_id))
