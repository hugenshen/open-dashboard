#!/usr/bin/env python3
"""Seed Open Dashboard assets for the user manual (real MySQL demo DB)."""

from __future__ import annotations

import json
import subprocess
import sys
import urllib.error
import urllib.request

API = "http://127.0.0.1:8082/api"
HEADERS = {
    "Content-Type": "application/json",
    "X-User-Id": "demo",
    "X-User-Name": "demo",
    "X-User-Perms": "*",
}
PG = [
    "psql",
    "-h127.0.0.1",
    "-p5434",
    "-Uopendashboard",
    "-dopendashboard",
    "-v",
    "ON_ERROR_STOP=1",
]


def api(method: str, path: str, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(API + path, data=data, headers=HEADERS, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        raise RuntimeError(f"{method} {path} -> {e.code}: {raw}") from e


def psql(sql: str):
    env = dict(**{**subprocess.os.environ, "PGPASSWORD": "opendashboard"})
    r = subprocess.run(PG + ["-c", sql], capture_output=True, text=True, env=env)
    if r.returncode != 0:
        raise RuntimeError(r.stderr or r.stdout)
    return r.stdout


def main():
    # 1) Remove business xxpay datasource from UI (keep demo stub optional — remove for clean shots)
    status, sources = api("GET", "/datasource")
    for s in sources or []:
        name = s.get("name") or ""
        sid = s["id"]
        if sid == "src_demo":
            continue  # templates may still reference; datasets will rebind
        if "xxpay" in name.lower() or "xxpay" in (s.get("dbName") or "").lower():
            print("delete datasource", sid, name)
            try:
                api("DELETE", f"/datasource/{sid}")
            except Exception as e:
                print("  skip delete:", e)

    # 2) Create / reuse manual demo datasource
    status, sources = api("GET", "/datasource")
    demo_src = next((s for s in sources if s.get("dbName") == "od_manual_demo"), None)
    if not demo_src:
        status, demo_src = api(
            "POST",
            "/datasource",
            {
                "name": "手册演示库",
                "type": "mysql",
                "host": "127.0.0.1",
                "port": 3306,
                "dbName": "od_manual_demo",
                "username": "root",
                "password": "abc123",
                "ext": {"desc": "用户手册场景数据（与业务库隔离）"},
            },
        )
        print("created datasource", demo_src["id"])
    else:
        # refresh password/host
        api(
            "PATCH",
            f"/datasource/{demo_src['id']}",
            {
                "name": "手册演示库",
                "host": "127.0.0.1",
                "port": 3306,
                "dbName": "od_manual_demo",
                "username": "root",
                "password": "abc123",
                "status": "ok",
            },
        )
        print("updated datasource", demo_src["id"])

    src_id = demo_src["id"]
    ping = api("POST", f"/datasource/{src_id}/ping")[1]
    print("ping", ping)
    if not ping.get("ok"):
        raise SystemExit("datasource ping failed")

    # 3) Upsert fixed-id datasets into meta PG (templates hardcode ds_sales/ds_ops/ds_fin)
    field_specs = {
        "ds_sales": (
            "销售明细",
            "销售分析",
            "fact_sales",
            [
                ("region", "区域", "dim", "STRING"),
                ("channel", "渠道", "dim", "STRING"),
                ("product", "产品", "dim", "STRING"),
                ("salesman", "销售员", "dim", "STRING"),
                ("amount", "销售额", "quota", "DECIMAL"),
                ("qty", "销量", "quota", "INT"),
                ("profit", "利润", "quota", "DECIMAL"),
                ("order_cnt", "订单数", "quota", "INT"),
            ],
        ),
        "ds_ops": (
            "运营日报",
            "运营增长",
            "ops_daily",
            [
                ("day", "日期", "dim", "DATE"),
                ("channel", "来源", "dim", "STRING"),
                ("platform", "端", "dim", "STRING"),
                ("module", "模块", "dim", "STRING"),
                ("uv", "UV", "quota", "INT"),
                ("pv", "PV", "quota", "INT"),
                ("duration", "均停留秒", "quota", "DECIMAL"),
                ("bounce", "跳出率", "quota", "DECIMAL"),
            ],
        ),
        "ds_fin": (
            "财务科目月报",
            "财务库存",
            "fact_finance",
            [
                ("month", "月份", "dim", "STRING"),
                ("subject", "科目", "dim", "STRING"),
                ("dept", "部门", "dim", "STRING"),
                ("income", "收入", "quota", "DECIMAL"),
                ("expense", "支出", "quota", "DECIMAL"),
                ("profit", "利润", "quota", "DECIMAL"),
            ],
        ),
    }

    import time

    base_ts = int(time.time() * 1000)
    # Avoid colliding with existing field primary keys
    max_fid = psql("SELECT COALESCE(MAX(id), 0) FROM de_dataset_field;").strip().splitlines()[-1]
    next_fid = int(max_fid) + 1000
    for di, (ds_id, (name, folder, table, fields)) in enumerate(field_specs.items()):
        ts = base_ts + di * 1000
        psql(
            f"""
            DELETE FROM de_dataset_field WHERE dataset_id = '{ds_id}';
            INSERT INTO de_dataset (id, name, folder, datasource_id, table_name, status, create_time, update_time)
            VALUES ('{ds_id}', '{name}', '{folder}', '{src_id}', '{table}', 'ready', {ts}, {ts})
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name,
              folder = EXCLUDED.folder,
              datasource_id = EXCLUDED.datasource_id,
              table_name = EXCLUDED.table_name,
              status = 'ready',
              update_time = EXCLUDED.update_time;
            """
        )
        values = []
        for i, (fname, label, group, dtype) in enumerate(fields, start=1):
            next_fid += 1
            values.append(
                f"({next_fid}, '{ds_id}', '{fname}', '{label}', '{group}', '{dtype}', {i}, 'table', NULL)"
            )
        psql(
            "INSERT INTO de_dataset_field "
            "(id, dataset_id, name, label, field_group, data_type, ord, origin, expression) VALUES "
            + ",\n".join(values)
            + ";"
        )
        print("dataset upserted", ds_id, "->", src_id, table)

    # 4) Clean junk dashboards/reports; create scenario boards from templates
    status, tree = api("POST", "/dashboardTree/tree", {})
    keep_names = set()
    for node in tree or []:
        nid = node["id"]
        name = node.get("name") or ""
        # delete scaffold / duplicates — we recreate fresh
        print("delete dashboard", nid, name)
        try:
            api("POST", f"/dashboardTree/delete/{nid}")
        except Exception as e:
            print("  delete soft failed", e)
            try:
                api("POST", f"/dashboardTree/perDelete/{nid}")
            except Exception as e2:
                print("  perDelete failed", e2)

    created = {}
    for tpl, name in (("sales", "销售分析看板"), ("ops", "运营增长看板"), ("finance", "财务概览看板")):
        status, node = api(
            "POST",
            "/dashboardTree/create",
            {
                "pid": "0",
                "name": name,
                "nodeType": "dashboard",
                "layoutMode": "grid",
                "templateId": tpl,
            },
        )
        created[tpl] = node["id"]
        pub = api("POST", f"/dashboard/{node['id']}/publish", {})[1]
        print("dashboard", name, node["id"], "published", pub)
        keep_names.add(name)

    # share sales board
    sales_id = created["sales"]
    share = api("POST", f"/dashboard/{sales_id}/share", {"visibility": "public", "perm": "view"})[1]
    print("share token", share.get("token"))

    # 5) Clean reports clutter; keep one named report
    status, reports = api("GET", "/report")
    for r in reports or []:
        # no delete API — rename junk ones out of the way via patch if possible
        if r["name"].startswith("报告 2026") or "脚手架" in r["name"]:
            try:
                api("PATCH", f"/report/{r['id']}", {"name": f"_归档_{r['id']}"})
            except Exception:
                pass

    status, r = api("POST", "/report", {"name": "七月销售周报"})
    print("report", r.get("id"), r.get("name"))

    # verify dataset preview hits MySQL
    for ds_id in ("ds_sales", "ds_ops", "ds_fin"):
        prev = api("POST", f"/dataset/{ds_id}/preview")[1]
        rows = len(prev.get("rows") or [])
        print("preview", ds_id, "rows", rows, "cols", [c.get("name") for c in prev.get("columns") or []])

    print("OK", json.dumps({"datasourceId": src_id, "dashboards": created, "share": share}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("FAILED:", e, file=sys.stderr)
        sys.exit(1)
