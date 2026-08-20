"""阶段2/4：知识注入 + 用户记忆（memory_store / knowledge）单测。"""

from __future__ import annotations

import os
import tempfile

os.environ["OD_HARNESS_DATA_DIR"] = tempfile.mkdtemp(prefix="od-mem-test-")

from agent import memory_store  # noqa: E402
from agent.knowledge import format_knowledge_block  # noqa: E402
from tools.gateway import ToolGateway  # noqa: E402


def test_memory_document_shape():
    doc = memory_store.create_empty_memory()
    assert doc["version"] == "1.0"
    assert doc["revision"] == 0
    assert set(doc["user"].keys()) == {"workContext", "personalContext", "topOfMind"}
    assert doc["facts"] == []


def test_memory_add_and_confirmation():
    memory_store.add_fact("u1", "以后金额用万元展示", category="preference", confidence=0.8)
    memory_store.add_fact("u1", "以后金额用万元展示", category="preference", confidence=0.8)
    doc = memory_store.load_document("u1")
    assert len(doc["facts"]) == 1
    assert doc["facts"][0]["confirmationCount"] == 2
    assert doc["revision"] >= 1


def test_memory_search_substring():
    memory_store.add_fact("u2", "用户常用维度：状态、产品", category="behavior", confidence=0.7)
    hits = memory_store.search("u2", "状态")
    assert any("状态" in h["content"] for h in hits)
    assert memory_store.search("u2", "不存在的内容") == []


def test_memory_store_isolated_by_workspace():
    memory_store.add_fact("u_ws", "A 工作区偏好金额", category="preference", confidence=0.8, workspace_id="ws-a")
    memory_store.add_fact("u_ws", "B 工作区偏好退款", category="preference", confidence=0.8, workspace_id="ws-b")

    ws_a = memory_store.load_document("u_ws", workspace_id="ws-a")
    ws_b = memory_store.load_document("u_ws", workspace_id="ws-b")

    assert ws_a["workspaceId"] == "ws-a"
    assert ws_b["workspaceId"] == "ws-b"
    assert "A 工作区偏好金额" in [f["content"] for f in ws_a["facts"]]
    assert "B 工作区偏好退款" not in [f["content"] for f in ws_a["facts"]]
    assert "B 工作区偏好退款" in [f["content"] for f in ws_b["facts"]]


def test_memory_tools_use_gateway_workspace():
    ws_a = ToolGateway.create(user_id="tool_user", workspace_id="ws-a")
    ws_b = ToolGateway.create(user_id="tool_user", workspace_id="ws-b")

    assert ws_a.execute("memory_add", {"content": "默认金额单位万元", "category": "preference"})["ok"]
    assert ws_b.execute("memory_add", {"content": "默认金额单位元", "category": "preference"})["ok"]

    hit_a = ws_a.execute("memory_search", {"query": "万元"})
    miss_a = ws_a.execute("memory_search", {"query": "单位元"})
    hit_b = ws_b.execute("memory_search", {"query": "单位元"})

    assert hit_a["workspaceId"] == "ws-a"
    assert hit_a["facts"] and hit_a["facts"][0]["content"] == "默认金额单位万元"
    assert miss_a["facts"] == []
    assert hit_b["workspaceId"] == "ws-b"
    assert hit_b["facts"] and hit_b["facts"][0]["content"] == "默认金额单位元"


def test_memory_format_block():
    memory_store.add_fact("u3", "偏好万元单位", category="preference", confidence=0.9)
    block = memory_store.format_memory_block("u3")
    assert "<system-reminder>" in block
    assert "<memory>" in block
    assert "偏好万元单位" in block


def test_message_filtering_drops_tool_and_plan():
    msgs = [
        {"role": "user", "content": "以后统一用万元展示"},
        {"role": "assistant", "content": "好的"},
        {"role": "tool", "content": '{"ok": true}'},
        {"role": "assistant", "content": "od_plan_charts 规划完成", "tool_calls": [{"id": "1"}]},
        {"role": "user", "content": '{"message": "x", "intent": "gen"}'},
    ]
    kept = memory_store.filter_messages_for_memory(msgs)
    assert [m["role"] for m in kept] == ["user", "assistant"]


def test_deterministic_fact_extraction_preference():
    facts = memory_store._deterministic_facts([{"role": "user", "content": "以后金额统一用万元展示"}])
    assert facts and facts[0]["category"] == "preference"


def test_deterministic_trivial_dropped():
    facts = memory_store._deterministic_facts([{"role": "user", "content": "你好"}])
    assert facts == []


def test_unit_preference_from_memory():
    memory_store.remember_user_choice("u4", "以后金额用万元展示")
    assert memory_store.unit_preference("u4") == "万元"
    assert memory_store.unit_preference("u5") == ""


def test_knowledge_block_format():
    block = format_knowledge_block(
        [{"field": "spending_amount", "name": "消费金额", "agg": "SUM", "unit": "元", "formula": "订单金额-退款"}],
        [{"term": "销售额", "field": "spending_amount"}],
    )
    assert "<system-reminder>" in block
    assert "<knowledge>" in block
    assert "spending_amount" in block
    assert "SUM" in block
    assert "销售额=spending_amount" in block


def test_knowledge_block_empty():
    assert format_knowledge_block([], []) == ""
