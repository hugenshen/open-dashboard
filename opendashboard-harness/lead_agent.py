"""DeerFlow-style Lead Agent: LLM + OD BI tools → OD SSE events."""

from __future__ import annotations

import json
import re
from typing import Any, Callable, Dict, Generator, List, Optional

from llm_client import chat_completions, llm_configured, llm_settings
from tools_od import TOOL_SPECS, dumps_tool_result, make_tool_executor

SYSTEM_PROMPT = """你是 Open Dashboard 的 Lead Agent（对齐 DeerFlow Lead：规划 → 调工具 → 收口）。
Java 平台是零 AI 的 BI 执行层；你只能通过工具读写。

硬规则：
1. 看板真相只能经 od_emit_patch 写入；禁止把查询结果行写进布局。
2. 优先业务数据集；避免 de_* / studio / 元数据表（如 dashborad表、拖拽工作室）除非用户点名。
3. 多轮已有 linkedDashboardId 时默认 mode=append；用户说重新生成/整页才 replace。
4. 生成看板：先 od_get_schema（必要时 od_list_datasets），再自己设计 DashboardPatch ops，或调用 od_compose_board 作草稿后仍须 od_emit_patch。
5. 问数/洞察：od_run_query，用结果组织回答，最后 od_finish(reason=answered)。
6. 生成完成后 od_finish(reason=done)；出错 od_finish(reason=error)。
7. Patch ops 常用：set_layout, set_theme, upsert_chart(chartId,type,datasetId,title,encode), upsert_component(id,chartId,x,y,w,h)。
8. encode 用真实字段名；KPI: {datasetId,value,agg}；类目图: {datasetId,category,value,agg}。
9. 用中文与用户沟通（message / 最终说明）。
"""


def _sse(event: str, data: Dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _step(name: str, detail: str) -> str:
    return _sse("step", {"id": name, "label": detail, "name": name, "detail": detail})


def _parse_args(raw: Any) -> Dict[str, Any]:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(raw) if raw.strip() else {}
        except json.JSONDecodeError:
            return {"_raw": raw}
    return {}


def _emit_applied(applied_wrap: Dict[str, Any]) -> Generator[str, None, None]:
    title = applied_wrap.get("title") or "AI 生成看板"
    mode = applied_wrap.get("mode") or "replace"
    patch = applied_wrap.get("patch") or {}
    applied = applied_wrap.get("result") or {}
    dash_id = applied.get("dashboardId")
    charts = applied.get("charts") or []
    yield _sse("patch", {"dashboardId": dash_id, "mode": mode, "ops": patch.get("ops") or []})
    empty_n = 0
    for c in charts:
        row_count = int(c.get("rowCount") or 0)
        kpi = c.get("kpiValue")
        chart_empty = row_count == 0
        if str(c.get("chartType")) == "kpi" and (kpi is None):
            chart_empty = True
        if chart_empty:
            empty_n += 1
            c = {**c, "rowCount": 0}
        yield _sse("chart_ready", c)
    all_empty = bool(charts) and empty_n == len(charts)
    yield _sse(
        "board_ready",
        {
            "dashboardId": dash_id,
            "title": title,
            "chartCount": len(charts),
            "emptyPreview": all_empty,
            "mode": mode,
        },
    )


def run_lead(
    payload: Dict[str, Any],
    bi: Callable[..., Any],
    *,
    max_rounds: int = 12,
) -> Generator[str, None, None]:
    if not llm_configured():
        yield _step("lead", "LLM 未配置（OD_LLM_API_KEY），无法启动 Lead Agent")
        raise RuntimeError("LLM_NOT_CONFIGURED")

    cfg = llm_settings()
    message = payload.get("message") or ""
    dataset_ids: List[str] = [str(x) for x in (payload.get("datasetIds") or [])]
    linked = payload.get("linkedDashboardId") or None
    style_id = payload.get("styleId") or "feishu-blue"
    intent = payload.get("intent")
    run_mode = (payload.get("mode") or "auto").lower()

    yield _step("lead", f"Lead Agent 启动 · model={cfg['model']}")
    yield _step("context", "注入会话上下文与工具白名单")

    user_blob = {
        "message": message,
        "intent": intent,
        "mode": run_mode,
        "styleId": style_id,
        "datasetIds": dataset_ids,
        "linkedDashboardId": linked,
        "hint": "若已绑定 datasetIds，优先用它们；生成看板时避免元数据表。",
    }
    messages: List[Dict[str, Any]] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": json.dumps(user_blob, ensure_ascii=False)},
    ]

    executor = make_tool_executor(bi, linked)
    finished = False
    board_emitted = False

    for round_i in range(max_rounds):
        yield _step("think", f"Lead 推理轮次 {round_i + 1}/{max_rounds}")
        resp = chat_completions(messages, tools=TOOL_SPECS)
        choice = (resp.get("choices") or [{}])[0]
        msg = choice.get("message") or {}
        tool_calls = msg.get("tool_calls") or []
        content = msg.get("content")

        # Keep assistant message in history
        asst: Dict[str, Any] = {"role": "assistant", "content": content}
        if tool_calls:
            asst["tool_calls"] = tool_calls
        messages.append(asst)

        if content and not tool_calls:
            # Model talked without tools — treat as soft answer if ask-like
            yield _sse("message_delta", {"text": str(content)[:2000]})

        if not tool_calls:
            # Force finish if model stopped without od_finish
            if executor.state.get("applied") and not board_emitted:  # type: ignore[attr-defined]
                yield from _emit_applied(executor.state["applied"])  # type: ignore[index]
                board_emitted = True
            if executor.state.get("answers"):  # type: ignore[attr-defined]
                for ans in executor.state["answers"]:  # type: ignore[index]
                    yield _sse("answer_table", {
                        "title": ans.get("title"),
                        "datasetId": ans.get("datasetId"),
                        "fields": ans.get("fields") or [],
                        "rows": ans.get("rows") or [],
                        "rowCount": ans.get("rowCount") or 0,
                        "encode": ans.get("encode") or {},
                    })
                    yield _sse("answer_chart", {
                        "title": ans.get("title"),
                        "chartType": ans.get("chartType"),
                        "datasetId": ans.get("datasetId"),
                        "encode": ans.get("encode") or {},
                        "rowCount": ans.get("rowCount") or 0,
                    })
                yield _sse("finish", {"reason": "answered", "detail": "lead_text"})
            elif executor.state.get("applied"):  # type: ignore[attr-defined]
                dash = (executor.state["applied"].get("result") or {}).get("dashboardId")  # type: ignore[index]
                yield _sse("finish", {"reason": "done", "detail": f"applied:{dash}", "dashboardId": dash})
            else:
                yield _sse("finish", {"reason": "answered", "detail": "lead_no_tools"})
            finished = True
            break

        for tc in tool_calls:
            fn = (tc.get("function") or {})
            name = fn.get("name") or ""
            args = _parse_args(fn.get("arguments"))
            yield _step("tool", f"调用 {name}")
            try:
                result = executor(name, args)
            except Exception as e:
                result = {"ok": False, "error": str(e)}

            # Side-effect SSE for user-visible products
            if name == "od_run_query" and isinstance(result, dict) and result.get("ok"):
                # answers already stored in executor.state
                pass
            if name == "od_emit_patch" and isinstance(result, dict) and result.get("ok"):
                if executor.state.get("applied") and not board_emitted:  # type: ignore[attr-defined]
                    yield _sse("plan", {
                        "title": executor.state["applied"].get("title"),  # type: ignore[index]
                        "mode": executor.state["applied"].get("mode"),  # type: ignore[index]
                        "opsCount": len((executor.state["applied"].get("patch") or {}).get("ops") or []),  # type: ignore[index]
                        "message": message,
                        "via": "lead+llm",
                    })
                    yield from _emit_applied(executor.state["applied"])  # type: ignore[index]
                    board_emitted = True
            if name == "od_finish":
                fin = executor.state.get("finished") or {}  # type: ignore[attr-defined]
                # Flush answers if any
                for ans in executor.state.get("answers") or []:  # type: ignore[attr-defined]
                    yield _sse("answer_table", {
                        "title": ans.get("title"),
                        "datasetId": ans.get("datasetId"),
                        "fields": ans.get("fields") or [],
                        "rows": ans.get("rows") or [],
                        "rowCount": ans.get("rowCount") or 0,
                        "encode": ans.get("encode") or {},
                    })
                    if re.search(r"(洞察|为什么|归因)", message or ""):
                        yield _sse("answer_insight", {
                            "title": ans.get("title") or "洞察",
                            "html": fin.get("message") or f"查询返回 {ans.get('rowCount') or 0} 行。",
                            "follows": ["保存到仪表盘", "生成整页看板"],
                        })
                    else:
                        yield _sse("answer_chart", {
                            "title": ans.get("title"),
                            "chartType": ans.get("chartType"),
                            "datasetId": ans.get("datasetId"),
                            "encode": ans.get("encode") or {},
                            "rowCount": ans.get("rowCount") or 0,
                        })
                if fin.get("message"):
                    yield _sse("message_delta", {"text": fin["message"]})
                elif board_emitted and executor.state.get("applied"):  # type: ignore[attr-defined]
                    dash = (executor.state["applied"].get("result") or {}).get("dashboardId")  # type: ignore[index]
                    title = executor.state["applied"].get("title")  # type: ignore[index]
                    yield _sse("message_delta", {"text": f"已由 Lead Agent 生成「{title}」草稿 #{dash}。"})
                reason = fin.get("reason") or "done"
                detail = fin.get("detail") or "lead"
                finish_payload: Dict[str, Any] = {"reason": reason, "detail": detail}
                if executor.state.get("applied"):  # type: ignore[attr-defined]
                    finish_payload["dashboardId"] = (
                        executor.state["applied"].get("result") or {}  # type: ignore[index]
                    ).get("dashboardId")
                yield _sse("finish", finish_payload)
                finished = True

            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tc.get("id") or name,
                    "content": dumps_tool_result(result),
                }
            )

        if finished:
            break

    if not finished:
        if executor.state.get("applied") and not board_emitted:  # type: ignore[attr-defined]
            yield from _emit_applied(executor.state["applied"])  # type: ignore[index]
        yield _sse("error", {"code": "LEAD_MAX_ROUNDS", "message": "Lead 超过最大工具轮次"})
        yield _sse("finish", {"reason": "error", "detail": "max_rounds"})
