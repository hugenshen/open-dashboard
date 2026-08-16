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


def test_drop_pie_same_as_bar():
    out = _review_and_repair(
        [
            {"type": "bar", "encode": {"category": "Status", "value": "Amount"}},
            {"type": "pie", "encode": {"category": "Status", "value": "Amount"}},
        ],
        {},
        [],
    )
    assert [c["type"] for c in out["charts"]] == ["bar"]
    assert "drop_pie_same_as_bar" in out["fixes"]


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
