"""Tool Gateway facade for registry, permission filtering, and guarded execution."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from agent.types import AgentTool
from tools.guard import execute_guarded
from tools.registry import create_registry
from tools.od_bi import ToolState


@dataclass
class ToolGateway:
    tools: List[AgentTool]
    state: ToolState
    by_name: Dict[str, AgentTool]

    @classmethod
    def create(cls, linked_dashboard_id: Optional[str] = None, *, defer_apply: bool = False) -> "ToolGateway":
        tools, state, by_name = create_registry(linked_dashboard_id, defer_apply=defer_apply)
        return cls(tools=tools, state=state, by_name=by_name)

    def openai_specs(self) -> List[Dict[str, Any]]:
        return [tool.openai_spec() for tool in self.tools]

    def execute(self, name: str, args: Dict[str, Any]) -> Any:
        tool = self.by_name.get(name)
        if not tool:
            return {"ok": False, "error": f"unknown tool: {name}"}
        return execute_guarded(tool, args)
