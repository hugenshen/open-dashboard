from agent.runtime import _emit_sqlbot
from agent.types import parse_sse_event
from sqlbot.pipeline import display_columns, humanize_ident, is_empty_query, time_span_hint


def _events(bot):
    out = []
    for chunk in _emit_sqlbot(bot):
        parsed = parse_sse_event(chunk)
        if parsed:
            out.append(parsed)
    return out


def test_empty_query_detects_zero_and_null_row():
    assert is_empty_query([], 0) is True
    assert is_empty_query([[None, None]], 1) is True
    assert is_empty_query([["m1", 10]], 1) is False


def test_display_columns_prefer_schema_label_and_humanize():
    schema = {"fields": [{"name": "order_cnt", "label": "订单数"}, {"name": "foo", "label": "foo"}]}
    assert display_columns(["order_cnt", "mch_cnt", "total_plat_profit"], schema) == [
        "订单数",
        "商户数",
        "总平台利润",
    ]
    assert humanize_ident("avg_amount") == "平均金额"
    assert humanize_ident("success_order_cnt") == "成功订单数"
    assert humanize_ident("unknown_xyz") == "unknown_xyz"


def test_time_span_hint_from_sample():
    schema = {
        "fields": [
            {"name": "merchant_id", "group": "dimension"},
            {"name": "pay_time", "group": "time", "dataType": "datetime"},
        ]
    }
    hint = time_span_hint(
        schema,
        [["m1", "2024-09-01 10:00:00"], ["m2", "2024-10-08 12:00:00"]],
        [{"name": "merchant_id"}, {"name": "pay_time"}],
    )
    assert "2024-09-01" in hint
    assert "2024-10-08" in hint


def test_emit_sqlbot_empty_skips_chart():
    events = _events(
        {
            "ok": True,
            "sql": "SELECT merchant_id, SUM(amount) FROM t_pay_order WHERE YEAR(pay_time)=2026 GROUP BY merchant_id",
            "brief": "商户收入",
            "datasetId": "ds_1",
            "datasetName": "订单表",
            "rows": [],
            "columns": ["merchant_id", "amount"],
            "rowCount": 0,
            "timeSpanHint": "样本时间约 2024-09 ～ 2024-10",
        }
    )
    types = [t for t, _ in events]
    assert "answer_sql" in types
    assert "answer_insight" in types
    assert "answer_chart" not in types
    assert "answer_table" not in types
    insight = next(d for t, d in events if t == "answer_insight")
    assert "0 行" in insight["headlineHtml"]
    assert "2024-09" in insight["insightHtml"]
    finish = next(d for t, d in events if t == "finish")
    assert finish["detail"] == "empty"


def test_emit_sqlbot_with_rows_still_charts():
    events = _events(
        {
            "ok": True,
            "sql": "SELECT merchant_id, SUM(amount) FROM t_pay_order GROUP BY merchant_id",
            "brief": "商户收入",
            "datasetId": "ds_1",
            "datasetName": "订单表",
            "rows": [["m1", 100]],
            "columns": ["merchant_id", "amount"],
            "rowCount": 1,
            "encode": {"category": "merchant_id", "value": "amount"},
        }
    )
    types = [t for t, _ in events]
    assert types[-2:] == ["message_delta", "finish"]
    assert "answer_chart" in types
    assert "answer_insight" not in types
