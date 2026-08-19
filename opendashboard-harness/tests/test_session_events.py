import os
from pathlib import Path

from agent import session_store
from agent.runtime import _match_target_chart, classify_multiturn, run_lead
from agent.types import parse_sse_event


def test_owner_filter(tmp_path, monkeypatch):
    monkeypatch.setenv("OD_HARNESS_DATA_DIR", str(tmp_path))
    session_store.create_conversation(owner_id="alice", title="A")
    session_store.create_conversation(owner_id="bob", title="B")
    alice = session_store.list_conversations("alice")
    bob = session_store.list_conversations("bob")
    assert [c["title"] for c in alice] == ["A"]
    assert [c["title"] for c in bob] == ["B"]


def test_workspace_filter_for_same_owner(tmp_path, monkeypatch):
    monkeypatch.setenv("OD_HARNESS_DATA_DIR", str(tmp_path))
    session_store.create_conversation(owner_id="alice", workspace_id="ws-a", title="A")
    session_store.create_conversation(owner_id="alice", workspace_id="ws-b", title="B")
    ws_a = session_store.list_conversations("alice", workspace_id="ws-a")
    ws_b = session_store.list_conversations("alice", workspace_id="ws-b")
    assert [c["title"] for c in ws_a] == ["A"]
    assert [c["title"] for c in ws_b] == ["B"]
    assert session_store.get_conversation(ws_a[0]["id"], owner_id="alice", workspace_id="ws-b") is None


def test_event_log_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv("OD_HARNESS_DATA_DIR", str(tmp_path))
    conv = session_store.create_conversation(owner_id="alice", title="A")
    cid = conv["id"]
    session_store.append_event(cid, "step", {"id": "context"}, run_id="r1")
    session_store.append_event_from_sse(cid, "r1", 'event: finish\ndata: {"reason": "done"}\n\n')
    events = session_store.list_events(cid, "r1")
    assert [e["type"] for e in events] == ["step", "finish"]
    assert events[0]["data"]["id"] == "context"


def test_match_prefers_selected_chart_id():
    charts = [
        {"chartId": "a", "title": "销售额", "chartType": "bar"},
        {"chartId": "b", "title": "订单量", "chartType": "line"},
    ]
    cid, title = _match_target_chart("改成折线", charts, "b")
    assert cid == "b"
    assert title == "订单量"


def test_lead_hard_routes_rechart(monkeypatch):
    """Lead path must call _run_rechart instead of the LLM loop for surgical edits."""
    called = {}

    def fake_rechart(*args, **kwargs):
        called["yes"] = True
        from agent.types import sse

        yield sse("finish", {"reason": "done", "detail": "rechart:dash"})

    monkeypatch.setattr("agent.runtime.llm_configured", lambda: True)
    monkeypatch.setattr("agent.runtime.llm_settings", lambda: {"model": "mock"})
    monkeypatch.setattr("agent.runtime._run_rechart", fake_rechart)
    payload = {
        "message": "把销售额改成折线",
        "intent": "gen",
        "datasetIds": ["ds_1"],
        "linkedDashboardId": "dash-1",
        "selectedChartId": "c-sales",
        "history": [],
    }
    events = []
    for chunk in run_lead(payload):
        parsed = parse_sse_event(chunk)
        if parsed:
            events.append(parsed[0])
    assert called.get("yes")
    assert events[-1] == "finish"
    assert classify_multiturn(payload["message"]) == "rechart"
