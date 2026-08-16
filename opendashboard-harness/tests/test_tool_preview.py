from agent.runtime import _profile_preview, _query_preview, _schema_preview, _tool_preview


def test_schema_preview_lists_fields():
    prev = _schema_preview(
        {
            "tableName": "orders",
            "fields": [
                {"name": "Amount", "label": "金额", "dataType": "DECIMAL", "group": "quota"},
                {"name": "Region", "label": "区域", "dataType": "VARCHAR", "group": "dim"},
            ],
        }
    )
    assert prev and prev["hint"].startswith("2 个字段")
    assert [f["name"] for f in prev["fields"]] == ["Amount", "Region"]


def test_query_preview_uses_encode():
    prev = _query_preview(
        {"ok": True, "rowCount": 8, "sample": [["华南", 12]], "fields": [{"name": "Region"}, {"name": "Amount"}]},
        {"title": "区域收入", "chartType": "bar", "encode": {"category": "Region", "value": "Amount", "agg": "SUM"}},
    )
    assert "SUM(Amount)" in prev["summary"]
    assert "按 Region" in prev["summary"]
    assert prev["rowCount"] == 8
    assert prev["sample"][0][0] == "华南"


def test_profile_preview_exposes_roles_and_probes():
    prev = _profile_preview(
        {
            "ok": True,
            "tableName": "orders",
            "fields": [{"name": "Amount", "label": "金额", "group": "quota"}],
            "dims": [{"name": "Region", "label": "区域"}],
            "measures": [{"name": "Amount", "label": "金额"}],
            "timeFields": [{"name": "CreateTime", "label": "下单时间"}],
            "probes": [{"kind": "kpi", "field": "Amount", "rowCount": 12, "kpiValue": 99}],
        }
    )
    assert "区域" in prev["dims"]
    assert "金额" in prev["measures"]
    assert any("kpi" in x and "99" in x for x in prev["items"])


def test_tool_preview_start_uses_args():
    prev = _tool_preview("od_run_query", None, {"encode": {"value": "Amount", "agg": "SUM"}, "chartType": "kpi"})
    assert prev and "SUM(Amount)" in (prev.get("summary") or "")
