from agent.knowledge import match_examples, match_glossary, prompt_block, save
from agent.memory import format_memory_block
from agent.user_context import set_principal, set_workspace
from agent.user_memory import add_fact, load
from sqlbot.guard import assert_allowed_tables


def test_glossary_maps_gmv(tmp_path, monkeypatch):
    monkeypatch.setenv("OD_HARNESS_DATA_DIR", str(tmp_path))
    save(
        "ds_1",
        {
            "glossary": [{"term": "GMV", "field": "pay_amount", "aliases": ["成交金额"]}],
            "examples": [{"question": "各地区销售额", "sql": "SELECT region, SUM(pay_amount) FROM t_pay_order GROUP BY region"}],
        },
    )
    hits = match_glossary("今天的 GMV 是多少", [{"term": "GMV", "field": "pay_amount", "aliases": ["成交金额"]}])
    assert hits and hits[0]["field"] == "pay_amount"
    block = prompt_block("今天的 GMV 是多少", "ds_1")
    assert "pay_amount" in block
    assert "GMV" in block
    examples = match_examples("各地区销售额对比", [{"question": "各地区销售额", "sql": "SELECT 1"}])
    assert examples


def test_knowledge_isolated_by_workspace(tmp_path, monkeypatch):
    monkeypatch.setenv("OD_HARNESS_DATA_DIR", str(tmp_path))
    save(
        "ds_1",
        {"glossary": [{"term": "GMV", "field": "pay_amount"}], "examples": []},
        workspace_id="ws-a",
    )
    save(
        "ds_1",
        {"glossary": [{"term": "GMV", "field": "gross_value"}], "examples": []},
        workspace_id="ws-b",
    )

    assert "pay_amount" in prompt_block("GMV", "ds_1", workspace_id="ws-a")
    assert "gross_value" not in prompt_block("GMV", "ds_1", workspace_id="ws-a")
    assert "gross_value" in prompt_block("GMV", "ds_1", workspace_id="ws-b")


def test_low_confidence_not_stored(tmp_path, monkeypatch):
    monkeypatch.setenv("OD_HARNESS_DATA_DIR", str(tmp_path))
    set_principal("alice", "*")
    add_fact("secret row values 1,2,3", confidence=0.4)
    assert load("alice")["facts"] == []


def test_user_memory_isolated(tmp_path, monkeypatch):
    monkeypatch.setenv("OD_HARNESS_DATA_DIR", str(tmp_path))
    set_principal("alice", "conversation:use,dataset:use")
    add_fact("Preferred datasets: ds_orders")
    set_principal("bob", "conversation:use,dataset:use")
    add_fact("Preferred datasets: ds_logs")
    alice = load("alice")["facts"]
    bob = load("bob")["facts"]
    assert "ds_orders" in alice[0]
    assert "ds_logs" in bob[0]
    assert alice != bob


def test_user_memory_isolated_by_workspace(tmp_path, monkeypatch):
    monkeypatch.setenv("OD_HARNESS_DATA_DIR", str(tmp_path))
    add_fact("Preferred metric: pay_amount", user_id="alice", workspace_id="ws-a")
    add_fact("Preferred metric: refund_amount", user_id="alice", workspace_id="ws-b")

    ws_a = load("alice", workspace_id="ws-a")
    ws_b = load("alice", workspace_id="ws-b")
    assert ws_a["workspaceId"] == "ws-a"
    assert ws_b["workspaceId"] == "ws-b"
    assert ws_a["facts"] == ["Preferred metric: pay_amount"]
    assert ws_b["facts"] == ["Preferred metric: refund_amount"]


def test_user_memory_injected_in_new_session(tmp_path, monkeypatch):
    monkeypatch.setenv("OD_HARNESS_DATA_DIR", str(tmp_path))
    set_principal("alice", "*")
    set_workspace("ws-a")
    add_fact("Preferred datasets: ds_orders")
    block = format_memory_block([])
    assert "## User memory" in block
    assert "ds_orders" in block


def test_knowledge_example_cannot_bypass_table_whitelist():
    sql = "SELECT * FROM secret_table"
    block_terms = prompt_block(
        "查 secret",
        None,
    )
    assert block_terms == ""
    try:
        assert_allowed_tables(sql, ["t_pay_order"], "mysql")
        raise AssertionError("should reject unauthorized table even if a knowledge example suggested it")
    except ValueError as e:
        assert "unauthorized" in str(e)
