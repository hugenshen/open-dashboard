from agent.knowledge import format_knowledge_block, match_glossary
from sqlbot.ask_context import compose_ask_knowledge, pick_few_shots, value_hints


def test_pick_few_shots_prefers_overlap():
    examples = [
        {"question": "各省销售额", "sql": "SELECT region, SUM(amt) FROM t GROUP BY region"},
        {"question": "人民币订单数", "sql": "SELECT COUNT(*) FROM t WHERE Currency='CNY'"},
        {"question": "无关问法", "sql": "SELECT 2"},
    ]
    shots = pick_few_shots("人民币有多少订单", examples, limit=2)
    assert shots
    assert "CNY" in shots[0]["sql"]


def test_pick_few_shots_fallback_when_no_overlap():
    examples = [
        {"id": 1, "question": "A问法", "sql": "SELECT 1"},
        {"id": 2, "question": "B问法", "sql": "SELECT 2"},
    ]
    shots = pick_few_shots("完全不相关的问题xyz", examples, limit=1)
    assert shots == [examples[0]]


def test_value_hints_uses_literal_when_question_hits():
    fields = [
        {"name": "Currency", "label": "货币", "values": ["CNY", "USD", "EUR"]},
        {"name": "user_id", "label": "用户", "values": [str(i) for i in range(50)]},
    ]
    block = value_hints("人民币 CNY 订单", fields)
    assert "CNY" in block
    assert "Currency" in block
    assert "user_id" not in block


def test_value_hints_includes_small_enum_always():
    fields = [{"name": "Currency", "label": "货币", "values": ["CNY", "USD"]}]
    block = value_hints("销售额多少", fields)
    assert "CNY" in block
    assert "<dimension-values>" in block


def test_compose_includes_few_shot_and_values():
    text = compose_ask_knowledge(
        few_shots=[{"question": "Q", "sql": "SELECT 1 FROM t"}],
        file_block="",
        java_block="",
        value_block="<dimension-values>\n- 货币(Currency): CNY\n</dimension-values>",
    )
    assert "<few-shot-examples>" in text
    assert "SELECT 1 FROM t" in text
    assert "CNY" in text


def test_knowledge_block_includes_dimension_values():
    block = format_knowledge_block(
        [],
        [{"term": "货币", "field": "Currency", "values": ["CNY", "USD"]}],
    )
    assert "货币=Currency" in block
    assert "CNY" in block


def test_glossary_matches_dimension_value():
    hits = match_glossary(
        "查一下 CNY 订单",
        [{"term": "货币", "field": "Currency", "aliases": ["币种"], "values": ["CNY", "USD"]}],
    )
    assert hits and hits[0]["field"] == "Currency"
