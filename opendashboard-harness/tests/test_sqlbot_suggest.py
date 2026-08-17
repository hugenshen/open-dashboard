from sqlbot.suggest import is_suggest_request, question_candidates, suggest_follows, suggest_questions


ORDER_SCHEMA = {
    "name": "订单表",
    "tableName": "t_pay_order",
    "fields": [
        {"name": "PayOrderId", "label": "支付订单号", "dataType": "VARCHAR", "group": "d"},
        {"name": "MchId", "label": "商户ID", "dataType": "VARCHAR", "group": "d"},
        {"name": "MchType", "label": "商户类型", "dataType": "VARCHAR", "group": "d"},
        {"name": "MchRate", "label": "商户费率", "dataType": "DECIMAL", "group": "q"},
        {"name": "MchIncome", "label": "商户收入", "dataType": "DECIMAL", "group": "q"},
        {"name": "PaySuccTime", "label": "支付成功时间", "dataType": "DATETIME", "group": "t"},
    ],
}


def test_meta_instruction_is_suggest_request():
    assert is_suggest_request("换一个问数问题")
    assert is_suggest_request("换一批问题")
    assert is_suggest_request("不知道问什么")
    assert is_suggest_request("按该表已有字段重新提问")
    assert not is_suggest_request("各商户类型的商户收入合计")
    assert not is_suggest_request("换一个问数问题，查各商户收入")


def test_suggest_questions_from_order_table():
    qs = suggest_questions(ORDER_SCHEMA)
    assert qs
    assert any("商户类型" in q and "商户收入" in q for q in qs)
    assert not any("商户ID" in q for q in qs)
    assert all(not is_suggest_request(q) for q in qs)
    assert "换一个问数问题" not in qs


def test_suggest_follows_can_rotate():
    first = suggest_follows(ORDER_SCHEMA, seed="换一个问数问题")
    assert first[0] == "各商户类型的商户收入合计"
    assert "换一个问数问题" not in first
    more = question_candidates(ORDER_SCHEMA)
    if len(more) > 4:
        assert "换一批问题" in first
    rotated = suggest_follows(ORDER_SCHEMA, seed="换一批问题")
    assert rotated[0] != first[0] or rotated[:4] != first[:4]
    assert is_suggest_request("换一批问题")
