"""Pi-aligned agent types for OD harness."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Generator, List, Literal, Optional


Role = Literal["user", "assistant", "tool", "system", "ui"]


@dataclass
class AgentMessage:
    role: Role
    content: Optional[str] = None
    tool_call_id: Optional[str] = None
    tool_calls: Optional[List[Dict[str, Any]]] = None
    name: Optional[str] = None
    meta: Dict[str, Any] = field(default_factory=dict)

    def to_llm(self) -> Optional[Dict[str, Any]]:
        if self.role == "ui":
            return None
        if self.role == "system":
            return {"role": "system", "content": self.content or ""}
        if self.role == "user":
            return {"role": "user", "content": self.content or ""}
        if self.role == "assistant":
            msg: Dict[str, Any] = {"role": "assistant", "content": self.content}
            if self.tool_calls:
                msg["tool_calls"] = self.tool_calls
            return msg
        if self.role == "tool":
            return {
                "role": "tool",
                "tool_call_id": self.tool_call_id or self.name or "tool",
                "content": self.content or "",
            }
        return None


@dataclass
class AgentTool:
    name: str
    description: str
    parameters: Dict[str, Any]
    execute: Callable[[Dict[str, Any]], Any]
    execution_mode: Literal["parallel", "sequential"] = "parallel"
    # If True after success, prefer ending the agent loop
    terminate_on_success: bool = False

    def openai_spec(self) -> Dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


# OD SSE event emitter type
SseGen = Generator[str, None, None]


def sse(event: str, data: Dict[str, Any]) -> str:
    import json

    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"


def step(name: str, detail: str, **extra: Any) -> str:
    payload: Dict[str, Any] = {"id": name, "label": detail, "name": name, "detail": detail}
    payload.update({k: v for k, v in extra.items() if v is not None})
    return sse("step", payload)
