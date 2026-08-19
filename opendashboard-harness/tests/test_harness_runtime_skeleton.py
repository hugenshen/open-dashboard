from agent import session_store
from agent.context_builder import build_run_payload
from agent.event_stream import EventStreamRecorder
from agent.knowledge import save as save_knowledge
from agent.memory_runtime import remember_user_fact
from agent.runtime import _record_runtime_refs
from agent.run_controller import RunController
from agent.trace_store import get_run_trace
from agent.types import sse
from tools.gateway import ToolGateway


class Body:
    message = "各地区销售额"
    intent = "ask"
    mode = "auto"
    styleId = "feishu-blue"
    datasetIds = ["ds_1"]
    selectedChartId = None
    selectedEncode = None


def test_run_controller_records_events_and_trace(tmp_path, monkeypatch):
    monkeypatch.setenv("OD_HARNESS_DATA_DIR", str(tmp_path))
    conv = session_store.create_conversation(owner_id="alice", title="A", dataset_ids=["ds_1"])
    run = session_store.create_run(conv["id"])
    controller = RunController(conv["id"], run["id"], message="GMV", intent="ask", style_id="feishu-blue")
    recorder = EventStreamRecorder(controller)

    chunks = [
        sse("answer_sql", {"sql": "SELECT 1", "datasetId": "ds_1"}),
        sse("message_delta", {"text": "答案"}),
        sse("finish", {"reason": "answered", "detail": "sql"}),
    ]
    assert list(recorder.wrap(chunks)) == chunks
    controller.complete()

    trace = get_run_trace(conv["id"], run["id"])
    assert trace["status"] == "answered"
    assert trace["eventCount"] == 3
    assert trace["artifact"]["answer_sql"]["sql"] == "SELECT 1"
    assert session_store.list_messages(conv["id"])[0]["content"] == "答案"


def test_context_builder_adds_runtime_context(tmp_path, monkeypatch):
    monkeypatch.setenv("OD_HARNESS_DATA_DIR", str(tmp_path))
    conv = session_store.create_conversation(owner_id="alice", title="A", dataset_ids=["ds_1"])
    payload = build_run_payload(
        conversation_id=conv["id"],
        run_id="run-1",
        body=Body(),
        conversation=conv,
        user_id="alice",
        workspace_id="ws-a",
        permissions=["conversation:use"],
    )
    assert payload["datasetIds"] == ["ds_1"]
    assert payload["runtimeContext"]["workspaceId"] == "ws-a"
    assert payload["runtimeContext"]["userId"] == "alice"
    assert payload["runtimeContext"]["permissions"] == ["conversation:use"]


def test_tool_gateway_unknown_tool_is_structured_error():
    gateway = ToolGateway.create()
    result = gateway.execute("missing_tool", {})
    assert result["ok"] is False
    assert "unknown tool" in result["error"]


def test_runtime_refs_are_workspace_scoped_and_persisted(tmp_path, monkeypatch):
    monkeypatch.setenv("OD_HARNESS_DATA_DIR", str(tmp_path))
    save_knowledge(
        "ds_1",
        {"glossary": [{"term": "GMV", "field": "pay_amount"}], "examples": []},
        workspace_id="ws-a",
    )
    save_knowledge(
        "ds_1",
        {"glossary": [{"term": "GMV", "field": "hidden_amount"}], "examples": []},
        workspace_id="ws-b",
    )
    remember_user_fact("alice", "Preferred chart: line", workspace_id="ws-a")

    conv = session_store.create_conversation(owner_id="alice", workspace_id="ws-a", title="A", dataset_ids=["ds_1"])
    run = session_store.create_run(conv["id"])
    refs = _record_runtime_refs(
        {
            "conversationId": conv["id"],
            "runId": run["id"],
            "message": "查询 GMV",
            "datasetIds": ["ds_1"],
            "runtimeContext": {"workspaceId": "ws-a", "userId": "alice", "permissions": ["conversation:use"]},
        }
    )

    assert refs["memoryRefs"][0]["workspaceId"] == "ws-a"
    assert refs["memoryRefs"][0]["content"] == "Preferred chart: line"
    assert refs["knowledgeRefs"][0]["workspaceId"] == "ws-a"
    assert refs["knowledgeRefs"][0]["field"] == "pay_amount"

    trace = get_run_trace(conv["id"], run["id"])
    assert trace["memoryRefs"] == refs["memoryRefs"]
    assert trace["knowledgeRefs"] == refs["knowledgeRefs"]
