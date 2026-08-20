"""transformContext + convertToLlm + skills injection."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional

from agent import memory_store
from agent.knowledge import ensure_skill_file, fetch_knowledge, format_knowledge_block
from agent.memory import format_memory_block, load_facts
from agent.types import AgentMessage
from agent.user_context import current_workspace_id


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
3. 多轮（已有 linkedDashboardId）按用户意图分治：
   a. 用户要改/换/删某张图（如「把 XX 改成折线」「删掉占比图」）→ 先 od_get_board_summary，再 od_rechart_chart(changes/removeChartIds)，然后 od_emit_patch。
   b. 用户要加一张图（「再加一张/多来些」）→ od_rechart_chart(adds=[...]) 或 append 少量 ops；新增图放现有内容之下，不动已有布局。
   c. 只有用户明确「重新生成/整页/从零」才整版 replace；否则禁止整页重建布局。
4. 生成看板必须走 DeerFlow planner + JoyAgent 质检闸，禁止机械套「KPI+对比+分布」模板：
   a. write_todos 列出步骤（分析特征 → 按特征选图 → 质检修复 → 写入）
   b. od_profile_dataset 看字段角色、是否有数、probe 结果
   c. od_plan_charts 依据探测出图（只保留 rowCount>0 且 KPI 非 null；empty=true 则不要 emit；内含质检）
   d. od_review_charts 可显式再跑一遍；layout 也会强制再跑，禁止跳过修复结果
   e. od_layout_board 传入 plan 的 charts **和 query**，再 od_emit_patch
   f. 禁止在 od_plan_charts 之外再发明未探测的图；禁止用 od_compose_board，除非 profile/plan_charts 都失败
   g. 默认 IA：顶栏查询条 + KPI 行 + 多图满铺 + 底汇总表；查询条字段会进入 chartQuery.context.filters。
      即使数据集没有业务度量（log/埋点/状态表），也要用「计数」把可数维度做成分布+汇总+趋势的
      多图看板，不要只出一张 KPI。只有当用户明确要求「只要一张图/单图/KPI 就行」时，才传 mode="single"。
   h. 质检硬规则：KPI 无 yoy/mom 则关假环比；饼图不与柱图同维；原始时间戳/过密折线丢掉；明细 table 改 grouptable
5. 多轮改/删/加单图时：必须先用 od_get_board_summary 了解现存图（chartId/title/chartType/encode），再决定 od_rechart_chart 的 changes/removeChartIds/adds；不存在的 chartId 会被拒绝。
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
    multi_turn: bool = False,
    user_id: str = "demo",
) -> List[AgentMessage]:
    """Inject system + memory + knowledge + runtime hints before LLM.

    阶段2/4（frozen-snapshot）：<knowledge>（confirmed 指标+词表）与 <memory>（用户偏好）
    作为独立块注入，静态 system prompt（SYSTEM_CORE + skills）不掺动态内容。
    """
    ids = [str(x) for x in (dataset_ids or [])]
    # 用户级记忆（跨会话，deermem document shape）
    workspace_id = current_workspace_id()
    mem = memory_store.format_memory_block(user_id, workspace_id=workspace_id)
    if not mem:
        # 兜底：会话级旧事实（不破坏既有行为）
        mem = format_memory_block(load_facts(conversation_id))
    # 知识冻结快照：confirmed 指标 + 词表（同数据集集合缓存，不重复拉取）
    knowledge_payload = fetch_knowledge(ids)
    knowledge = format_knowledge_block(
        knowledge_payload.get("metrics") or [],
        knowledge_payload.get("terms") or [],
    )
    try:
        # skills/od-metrics/SKILL.md 保持最新（Pi skills 模式：模型按需读取完整字典）
        ensure_skill_file(knowledge_payload.get("metrics") or [], knowledge_payload.get("terms") or [])
    except Exception:
        pass
    hints = {
        "datasetIds": ids,
        "styleId": style_id,
        "intent": intent,
        "boardSummary": board_summary,
    }
    import json

    extra = ""
    if knowledge:
        extra += knowledge + "\n"
    if mem:
        extra += mem + "\n"
    extra += "## Runtime context\n```json\n" + json.dumps(hints, ensure_ascii=False) + "\n```\n"
    if multi_turn and isinstance(board_summary, dict):
        charts = board_summary.get("charts") or []
        if isinstance(charts, list) and charts:
            lines = []
            for c in charts:
                if not isinstance(c, dict):
                    continue
                lines.append(
                    f"- {c.get('chartId')} | {c.get('title')} | {c.get('chartType')} | {c.get('datasetId')}"
                )
            extra += (
                "\n## 多轮编辑提示（用户正在调整已生成看板）\n"
                "你现在面对一个已存在的看板。规则：\n"
                "1. 要改/换/删某张图 → od_rechart_chart(changes 或 removeChartIds)，然后 od_emit_patch。\n"
                "2. 要加图 → od_rechart_chart(adds=[...])，新增图放现有内容之下。\n"
                "3. 禁止整页 replace，除非用户明确说「重新生成/整页/从零」。\n"
                "现存图表（chartId | title | chartType | datasetId）：\n" + "\n".join(lines) + "\n"
            )
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
