"""Tool registry."""

from __future__ import annotations

from typing import Dict, List, Optional

from agent.types import AgentTool
from tools.od_bi import ToolState, build_od_tools


def create_registry(linked_dashboard_id: Optional[str] = None) -> tuple[List[AgentTool], ToolState, Dict[str, AgentTool]]:
    state = ToolState()
    tools = build_od_tools(linked_dashboard_id, state)
    by_name = {t.name: t for t in tools}
    return tools, state, by_name
