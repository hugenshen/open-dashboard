"""Deterministic chart quality gate (JoyAgent-style critic)."""

from __future__ import annotations

from tools.od_bi import _plan_charts_from_profile, _review_and_repair


def test_kpi_disables_fake_compare():
    out = _review_and_repair([{"type": "kpi", "encode": {"value": "Amount"}}], {}, [])
    kpi = out["charts"][0]
    assert kpi["encode"]["calc"] == "none"
    assert kpi["style"]["showCompare"] is False
    assert "kpi_disable_compare" in out["fixes"]


def test_keeps_explicit_yoy():
    out = _review_and_repair(
        [{"type": "kpi", "encode": {"value": "Amount", "calc": "yoy"}, "style": {"showCompare": True}}],
        {},
        [],
    )
    assert out["charts"][0]["encode"]["calc"] == "yoy"
    assert "kpi_disable_compare" not in out["fixes"]


def test_keep_pie_with_same_dim_bar():
    """同维 bar+pie 并存是运营模板（柱看量、饼看占比），不去重。"""
    out = _review_and_repair(
        [
            {"type": "bar", "encode": {"category": "Status", "value": "Amount"}},
            {"type": "pie", "encode": {"category": "Status", "value": "Amount"}},
        ],
        {},
        [],
    )
    assert [c["type"] for c in out["charts"]] == ["bar", "pie"]
    assert "drop_pie_same_as_bar" not in out["fixes"]


def test_drop_duplicate_pie_same_dim():
    """同维两张饼图才去重。"""
    out = _review_and_repair(
        [
            {"type": "pie", "encode": {"category": "Status", "value": "Amount"}},
            {"type": "pie", "encode": {"category": "Status", "value": "Amount"}},
        ],
        {},
        [],
    )
    assert [c["type"] for c in out["charts"]] == ["pie"]
    assert "drop_duplicate_pie" in out["fixes"]


def test_drop_granular_line():
    out = _review_and_repair(
        [{"type": "line", "encode": {"category": "CreateTime", "value": "Amount"}}],
        {},
        [{"kind": "line", "field": "CreateTime", "rowCount": 100, "tooGranular": True, "emptyValue": True}],
    )
    assert out["charts"] == []
    assert "drop_raw_timestamp_line" in out["fixes"]


def test_iso_sample_drops_line():
    out = _review_and_repair(
        [{"type": "line", "encode": {"category": "CreateTime", "value": "Amount"}}],
        {},
        [
            {
                "kind": "line",
                "field": "CreateTime",
                "rowCount": 8,
                "sample": [["2024-09-08T12:51:58Z", 100], ["2024-09-11T18:34:00Z", 100]],
            }
        ],
    )
    assert out["charts"] == []
    assert "drop_raw_timestamp_line" in out["fixes"]


def test_table_to_grouptable():
    out = _review_and_repair(
        [{"type": "table", "title": "支付状态", "encode": {"category": "Status", "value": "Amount"}}],
        {},
        [],
    )
    assert out["charts"][0]["type"] == "grouptable"
    assert "汇总" in out["charts"][0]["title"]
    assert "table_to_grouptable" in out["fixes"]


def test_plan_skips_duplicate_pie():
    profile = {
        "ok": True,
        "name": "订单表",
        "empty": False,
        "dims": [{"name": "Status", "label": "支付状态"}],
        "measures": [{"name": "Amount", "label": "支付金额"}],
        "timeFields": [],
        "queryFields": [],
        "probes": [
            {"kind": "count", "field": "Status", "rowCount": 1, "emptyValue": False, "kpiValue": 10},
            {"kind": "kpi", "field": "Amount", "rowCount": 1, "emptyValue": False, "kpiValue": 100},
            {"kind": "bar", "field": "Status", "rowCount": 4, "emptyValue": False},
        ],
    }
    planned = _plan_charts_from_profile("ds_1", profile)
    kinds = [c["type"] for c in planned["charts"]]
    assert "pie" not in kinds
    assert "bar" in kinds
    assert "grouptable" in kinds
    kpi = next(c for c in planned["charts"] if c["type"] == "kpi")
    assert kpi["encode"]["calc"] == "none"
    assert kpi["style"]["showCompare"] is False


def test_intent_hint_mapping():
    """阶段3：意图 → 图型提示（trend/compare/share）。"""
    from agent.runtime import _intent_hint

    assert _intent_hint("按月份看趋势，生成看板") == "trend"
    assert _intent_hint("生成分析看板，各区域对比") == "compare"
    assert _intent_hint("生成看板，看渠道占比") == "share"
    assert _intent_hint("生成分析看板") == "none"


def test_intent_planning_chart_types():
    """意图感知规划：compare→hbar 优先；share→pie 优先；trend 有 time probe 才出 line。"""
    from tools.od_bi import _plan_charts_from_profile

    base = {
        "ok": True,
        "empty": False,
        "name": "s",
        "dims": [{"name": "region", "label": "区域"}, {"name": "channel", "label": "渠道"}],
        "measures": [{"name": "amount", "label": "销售额"}],
        "timeFields": [{"name": "day", "label": "日期"}],
        "probes": [
            {"kind": "bar", "field": "region", "rowCount": 3},
            {"kind": "bar", "field": "channel", "rowCount": 3},
            {"kind": "line", "field": "day", "rowCount": 10},
        ],
        "queryFields": [],
    }
    compare = _plan_charts_from_profile("s", base, intent="compare")
    types = [c["type"] for c in compare["charts"]]
    assert "hbar" in types, types
    share = _plan_charts_from_profile("s", base, intent="share")
    assert any(c["type"] == "pie" for c in share["charts"])
    trend = _plan_charts_from_profile("s", base, intent="trend")
    assert any(c["type"] == "line" for c in trend["charts"])
