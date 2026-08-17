"""transformContext + convertToLlm + skills injection."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional

from agent.memory import format_memory_block, load_facts
from agent.types import AgentMessage


def load_skills_prompt() -> str:
    root = Path(__file__).resolve().parent.parent / "skills"
    if not root.is_dir():
        return ""
    chunks: List[str] = []
    for skill_md in sorted(root.glob("*/SKILL.md")):
        text = skill_md.read_text(encoding="utf-8").strip()
        if text:
            chunks.append(f"### {skill_md.parent.name}\n{text}")
    if not chunks:
        return ""
    return "## Skills\n\n" + "\n\n".join(chunks) + "\n"


SYSTEM_CORE = """你是 Open Dashboard 的 Lead Agent（Pi 工具环 + DeerFlow planner）。
Java 平台是零 AI 的 BI 执行层；你只能通过工具读写。

硬规则：
1. 看板真相只能经 od_emit_patch 写入；禁止把查询结果行写进布局。
2. 优先业务数据集（订单/销售/财务/运营）；避免 de_*、dashborad表、拖拽验证集，除非用户点名。
3. 多轮已有 linkedDashboardId 时默认 mode=append；用户说重新生成/整页才 replace。
4. 生成看板必须走 DeerFlow planner + JoyAgent 质检闸，禁止机械套「KPI+对比+分布」模板：
   a. write_todos 列出步骤（分析特征 → 按特征选图 → 质检修复 → 写入）
   b. od_profile_dataset 看字段角色、是否有数、probe 结果
   c. od_plan_charts 依据探测出图（只保留 rowCount>0 且 KPI 非 null；empty=true 则不要 emit；内含质检）
   d. od_review_charts 可显式再跑一遍；layout 也会强制再跑，禁止跳过修复结果
   e. od_layout_board 传入 plan 的 charts **和 query**，再 od_emit_patch
   f. 禁止在 od_plan_charts 之外再发明未探测的图；禁止用 od_compose_board，除非 profile/plan_charts 都失败
   g. 默认 IA：顶栏查询条 + KPI + 两列满铺图 + 底汇总表；查询条字段会进入 chartQuery.context.filters
   h. 质检硬规则：KPI 无 yoy/mom 则关假环比；饼图不与柱图同维；原始时间戳/过密折线丢掉；明细 table 改 grouptable
5. 用户明确「再加一张/只要某图」时：od_get_board_summary 后 append 少量 ops。
6. 问数（SQLBot Ask-3）：已选表后，若用户说「换一个问数问题」或问题里没有可查询需求，先按当前表字段反问具体 Chip，等用户点选后再生成只读 SQL。od_get_schema 后让模型按 M-Schema 生成 SQL，经 od_run_sql 执行，再 od_finish(reason=answered)。禁止把原始 SQL 交给前端执行。失败再退回 intentPlan + od_run_query。生成看板时不要把试查询当成问数结果。
7. 生成完成后 od_finish(reason=done)。
8. encode 用真实字段；KPI {datasetId,value,agg}；类目图 {datasetId,category,value,agg}。
9. 用中文与用户沟通，简要说明为何选这些图。
"""


def build_system_prompt(extra: str = "") -> str:
    parts = [SYSTEM_CORE, load_skills_prompt(), extra]
    return "\n".join(p for p in parts if p).strip()


def history_to_agent_messages(messages: List[Dict[str, Any]], limit: int = 24) -> List[AgentMessage]:
    out: List[AgentMessage] = []
    for m in messages[-limit:]:
        role = m.get("role") or "user"
        if role not in ("user", "assistant", "system", "tool"):
            role = "user"
        out.append(AgentMessage(role=role, content=m.get("content") or ""))  # type: ignore[arg-type]
    return out


def transform_context(
    messages: List[AgentMessage],
    *,
    conversation_id: str,
    board_summary: Optional[Dict[str, Any]] = None,
    dataset_ids: Optional[List[str]] = None,
    style_id: str = "feishu-blue",
    intent: Optional[str] = None,
) -> List[AgentMessage]:
    """Inject system + memory + runtime hints before LLM."""
    facts = load_facts(conversation_id)
    mem = format_memory_block(facts)
    hints = {
        "datasetIds": dataset_ids or [],
        "styleId": style_id,
        "intent": intent,
        "boardSummary": board_summary,
    }
    import json

    extra = mem + "\n## Runtime context\n```json\n" + json.dumps(hints, ensure_ascii=False) + "\n```\n"
    system = AgentMessage(role="system", content=build_system_prompt(extra))
    # Drop prior system messages from history; keep user/assistant/tool
    filtered = [m for m in messages if m.role != "system"]
    # Cap length
    if len(filtered) > 30:
        filtered = filtered[-30:]
    return [system] + filtered


def convert_to_llm(messages: List[AgentMessage]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for m in messages:
        llm = m.to_llm()
        if llm is not None:
            out.append(llm)
    return out
