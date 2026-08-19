"""In-process mock for Java /api/internal/bi/* used by L2 eval."""

from __future__ import annotations

from typing import Any, Dict
from unittest import mock

PROFILE = {
    "ok": True,
    "name": "订单表",
    "tableName": "t_pay_order",
    "empty": False,
    "dims": [{"name": "Status", "label": "支付状态"}],
    "measures": [{"name": "Amount", "label": "支付金额"}],
    "timeFields": [],
    "queryFields": [],
    "fields": [
        {"name": "Status", "label": "支付状态", "group": "d"},
        {"name": "Amount", "label": "支付金额", "group": "q"},
    ],
    "probes": [
        {"kind": "count", "field": "Status", "rowCount": 4, "emptyValue": False, "kpiValue": 10},
        {"kind": "kpi", "field": "Amount", "rowCount": 1, "emptyValue": False, "kpiValue": 100},
        {"kind": "bar", "field": "Status", "rowCount": 4, "emptyValue": False},
    ],
}

BOARD = {
    "dashboardId": "dash-1",
    "name": "经营分析",
    "charts": [
        {
            "chartId": "c-sales",
            "title": "销售额分布",
            "chartType": "bar",
            "datasetId": "ds_1",
            "encode": {"category": "Status", "value": "Amount"},
            "rowCount": 4,
        },
        {
            "chartId": "c-kpi",
            "title": "总金额",
            "chartType": "kpi",
            "datasetId": "ds_1",
            "encode": {"value": "Amount"},
            "rowCount": 1,
            "kpiValue": 100,
        },
    ],
    "components": [
        {"id": "c_c-sales", "chartId": "c-sales", "x": 0, "y": 0, "w": 36, "h": 20},
        {"id": "c_c-kpi", "chartId": "c-kpi", "x": 36, "y": 0, "w": 36, "h": 12},
    ],
}


EMPTY_PROFILE = {
    **PROFILE,
    "id": "ds_empty",
    "name": "空表",
    "empty": True,
    "probes": [
        {"kind": "count", "field": "Status", "rowCount": 0, "emptyValue": True},
        {"kind": "kpi", "field": "Amount", "rowCount": 0, "emptyValue": True, "kpiValue": None},
        {"kind": "bar", "field": "Status", "rowCount": 0, "emptyValue": True},
    ],
}


def handle(method: str, path: str, body: Any = None) -> Any:
    if path.endswith("/health"):
        return {"ok": True}
    if path.endswith("/datasets"):
        return [{"id": "ds_1", "name": "订单表", "tableName": "t_pay_order"}]
    if "/schema" in path:
        return {
            "id": "ds_1",
            "name": "订单表",
            "tableName": "t_pay_order",
            "engine": "mysql",
            "fields": PROFILE["fields"],
        }
    if path.endswith("/profile-dataset"):
        ds = (body or {}).get("datasetId") or "ds_1"
        if ds == "ds_empty":
            return dict(EMPTY_PROFILE)
        return dict(PROFILE, id=ds)
    if "/board-summary" in path:
        return BOARD
    if path.endswith("/apply-patch"):
        return {"ok": True, "dashboardId": (body or {}).get("dashboardId") or "dash-1", "charts": BOARD["charts"]}
    if path.endswith("/compose-board"):
        return {"ok": True, "title": "AI 生成看板", "patch": {"ops": [{"op": "upsert_chart", "chartId": "c1"}]}}
    if path.endswith("/query/sql"):
        sql = str((body or {}).get("sql") or "")
        if "DELETE" in sql.upper() or "DROP" in sql.upper():
            raise RuntimeError("BI POST /query/sql -> 400: write not allowed")
        return {
            "ok": True,
            "fields": [{"name": "Status"}, {"name": "Amount"}],
            "data": [["成功", 10], ["失败", 2]],
            "rowCount": 2,
        }
    if path.endswith("/query/chart") or path.endswith("/query/dataset"):
        return {
            "ok": True,
            "fields": [{"name": "Status", "type": "varchar"}, {"name": "Amount", "type": "decimal"}],
            "data": [["成功", 10], ["失败", 2]],
            "rowCount": 2,
        }
    if path.endswith("/resolve-intent"):
        return {"ok": True, "unresolved": [], "mappings": [], "cards": []}
    return {"ok": True}


def install_mock():
    """Patch every module-level ``bi_call`` binding used by L2 runs."""
    targets = (
        "tools.od_bi.bi_call",
        "agent.runtime.bi_call",
        "sqlbot.pipeline.bi_call",
    )
    patchers = [mock.patch(name, side_effect=handle) for name in targets]
    for p in patchers:
        p.start()

    class _Bundle:
        def stop(self) -> None:
            for p in reversed(patchers):
                p.stop()

    return _Bundle()
