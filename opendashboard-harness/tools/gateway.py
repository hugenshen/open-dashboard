"""Tool Gateway facade for registry, permission filtering, and guarded execution."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from agent.user_context import has_permission
from agent.types import AgentTool
from tools.guard import execute_guarded
from tools.registry import create_registry
from tools.od_bi import ToolState


QUERY_TOOLS = {
    "od_list_datasets",
    "od_get_schema",
    "od_profile_dataset",
    "od_run_query",
    "od_run_sql",
    "od_plan_charts",
    "od_interpret_fields",
}
WRITE_TOOLS = {
    "od_layout_board",
    "od_compose_board",
    "od_emit_patch",
    "od_rechart_chart",
}


@dataclass
class ToolGateway:
    tools: List[AgentTool]
    state: ToolState
    by_name: Dict[str, AgentTool]

    @classmethod
    def create(
        cls,
        linked_dashboard_id: Optional[str] = None,
        *,
        defer_apply: bool = False,
        user_id: str = "demo",
        workspace_id: str = "default",
    ) -> "ToolGateway":
        tools, state, by_name = create_registry(
            linked_dashboard_id,
            defer_apply=defer_apply,
            user_id=user_id,
            workspace_id=workspace_id,
        )
        allowed = [tool for tool in tools if cls._allowed(tool.name)]
        return cls(tools=allowed, state=state, by_name={t.name: t for t in allowed})

    @staticmethod
    def _allowed(name: str) -> bool:
        can_ask = has_permission("conversation:use") and (
            has_permission("dataset:use") or has_permission("dataset:manage")
        )
        if name in QUERY_TOOLS and not can_ask:
            return False
        if name in WRITE_TOOLS and not (
            has_permission("dashboard:manage") or has_permission("dashboard:edit") or has_permission("*")
        ):
            return False
        return True

    def openai_specs(self) -> List[Dict[str, Any]]:
        return [tool.openai_spec() for tool in self.tools]

    def execute(self, name: str, args: Dict[str, Any]) -> Any:
        tool = self.by_name.get(name)
        if not tool:
            if name in QUERY_TOOLS or name in WRITE_TOOLS:
                return {"ok": False, "error": "TOOL_FORBIDDEN", "tool": name}
            return {"ok": False, "error": f"unknown tool: {name}"}
        return execute_guarded(tool, args)
