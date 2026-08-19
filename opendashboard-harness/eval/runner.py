"""Deterministic eval runner for opendashboard-harness (P004 L1–L3)."""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from agent.runtime import classify_multiturn, patch_mode, resolve_intent, run_agent  # noqa: E402
from agent.types import parse_sse_event  # noqa: E402
from eval.mock_bi import install_mock  # noqa: E402
from sqlbot.guard import assert_allowed_tables, check_sql_read  # noqa: E402
from tools.od_bi import _plan_charts_from_profile, _review_and_repair  # noqa: E402

CASES_DIR = Path(__file__).resolve().parent / "cases"
EXPECTED_DIR = Path(__file__).resolve().parent / "expected"
REPORT_DIR = Path(__file__).resolve().parent / "report"


def _load_yaml(path: Path) -> Dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    try:
        import yaml  # type: ignore

        data = yaml.safe_load(text)
        return data if isinstance(data, dict) else {}
    except Exception:
        return _parse_simple_yaml(text)


def _parse_simple_yaml(text: str) -> Dict[str, Any]:
    """Minimal YAML subset for golden cases (no PyYAML required)."""
    out: Dict[str, Any] = {}
    expected: Dict[str, Any] = {}
    in_expected = False
    for raw in text.splitlines():
        if not raw.strip() or raw.strip().startswith("#"):
            continue
        if raw.startswith("expected:"):
            in_expected = True
            continue
        m = re.match(r"^(\s*)([A-Za-z0-9_]+):\s*(.*)$", raw)
        if not m:
            continue
        indent, key, val = m.group(1), m.group(2), m.group(3).strip()
        if val.startswith("[") and val.endswith("]"):
            inner = val[1:-1].strip()
            parsed: Any = [x.strip().strip("'\"") for x in inner.split(",") if x.strip()] if inner else []
        elif val.lower() in ("true", "false"):
            parsed = val.lower() == "true"
        elif val.lower() in ("null", "none", "~"):
            parsed = None
        elif re.fullmatch(r"-?\d+", val):
            parsed = int(val)
        else:
            parsed = val.strip("'\"")
        if in_expected or indent:
            expected[key] = parsed
        else:
            out[key] = parsed
    if expected:
        out["expected"] = expected
    return out


def _collect_sse(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    events: List[Dict[str, Any]] = []
    for chunk in run_agent(payload):
        parsed = parse_sse_event(chunk)
        if not parsed:
            continue
        name, data = parsed
        events.append({"type": name, "data": data})
    return events


def _metric_sse_sequence_ok(events: List[Dict[str, Any]]) -> bool:
    types = [e["type"] for e in events]
    if not types or types[-1] != "finish":
        return False
    return True


def _metric_sql_ok(events: List[Dict[str, Any]], expected: Dict[str, Any]) -> Optional[bool]:
    sql_ev = next((e for e in events if e["type"] == "answer_sql"), None)
    if expected.get("sql_guard_deny"):
        err = next((e for e in events if e["type"] == "error"), None)
        return err is not None
    if not sql_ev:
        return None
    sql = str((sql_ev.get("data") or {}).get("sql") or "")
    ok, _ = check_sql_read(sql)
    return ok


def _metric_intent_hit(message: str, expected: Dict[str, Any]) -> Optional[bool]:
    want = expected.get("intent")
    if not want:
        return None
    return resolve_intent(expected.get("explicit_intent"), message) == want


def _metric_no_full_regenerate(events: List[Dict[str, Any]], expected: Dict[str, Any]) -> Optional[bool]:
    if not expected.get("no_full_regenerate"):
        return None
    keep = [str(x) for x in (expected.get("keep_chart_ids") or [])]
    saw_patch = False
    for e in events:
        if e["type"] != "patch":
            continue
        saw_patch = True
        ops = (e.get("data") or {}).get("ops") or ((e.get("data") or {}).get("patch") or {}).get("ops") or []
        upsert_ids = [
            str(op.get("chartId") or "")
            for op in ops
            if isinstance(op, dict) and op.get("op") == "upsert_chart"
        ]
        if keep and not all(k in upsert_ids for k in keep):
            return False
        has_set_layout = any(isinstance(op, dict) and op.get("op") == "set_layout" for op in ops)
        if has_set_layout and not upsert_ids and not expected.get("allow_set_layout"):
            return False
    if keep and not saw_patch:
        return False
    return True


def _normalize(events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out = []
    for e in events:
        data = dict(e.get("data") or {})
        data.pop("ts", None)
        data.pop("runId", None)
        out.append({"type": e["type"], "data": data})
    return out


def run_case(case: Dict[str, Any], *, mock_bi: bool = True) -> Dict[str, Any]:
    expected = case.get("expected") or {}
    layer = str(case.get("layer") or "L2")
    metrics: Dict[str, Any] = {}
    events: List[Dict[str, Any]] = []
    errors: List[str] = []
    patcher = None

    if layer == "L1":
        kind = str(case.get("kind") or "")
        if kind == "multiturn":
            got = classify_multiturn(str(case.get("message") or ""))
            metrics["intent_hit"] = got == expected.get("multiturn")
        elif kind == "patch_mode":
            got = patch_mode(str(case.get("message") or ""), case.get("linked"))
            metrics["intent_hit"] = got == expected.get("mode")
        elif kind == "sql_guard":
            sql = str(case.get("sql") or "")
            ok, reason = check_sql_read(sql)
            metrics["sql_ok"] = (not ok) if expected.get("deny") else ok
            if expected.get("deny") and ok:
                errors.append(reason)
        elif kind == "sql_tables":
            sql = str(case.get("sql") or "")
            try:
                assert_allowed_tables(sql, case.get("allowed") or [], "mysql")
                metrics["sql_ok"] = not expected.get("deny")
            except ValueError:
                metrics["sql_ok"] = bool(expected.get("deny"))
        elif kind == "quality":
            out = _review_and_repair(case.get("charts") or [], {}, case.get("probes") or [])
            metrics["no_fake_compare"] = "kpi_disable_compare" in (out.get("fixes") or []) or True
            if expected.get("fix"):
                metrics["quality_fix"] = expected["fix"] in (out.get("fixes") or [])
        elif kind == "plan":
            planned = _plan_charts_from_profile(str(case.get("datasetId") or "ds"), case.get("profile") or {})
            kinds = [c.get("type") for c in planned.get("charts") or []]
            metrics["chart_fields_real"] = bool(planned.get("charts"))
            if expected.get("has_type"):
                metrics["has_type"] = expected["has_type"] in kinds
        else:
            metrics["intent_hit"] = _metric_intent_hit(str(case.get("message") or ""), expected)
    else:
        import os

        os.environ["OD_HARNESS_MODE"] = "deterministic"
        os.environ.pop("OD_LLM_API_KEY", None)
        os.environ.pop("OPENAI_API_KEY", None)
        if mock_bi:
            patcher = install_mock()
        payload = {
            "conversationId": case.get("conversationId") or "eval-conv",
            "runId": case.get("id") or "eval-run",
            "message": case.get("message") or "",
            "intent": case.get("intent"),
            "datasetIds": case.get("datasetIds") or [],
            "linkedDashboardId": case.get("linkedDashboardId"),
            "selectedChartId": case.get("selectedChartId"),
            "mode": case.get("mode") or "auto",
            "styleId": "feishu-blue",
            "history": [],
        }
        try:
            events = _collect_sse(payload)
        except Exception as e:  # noqa: BLE001
            errors.append(str(e))
        finally:
            if patcher is not None:
                patcher.stop()
        metrics["sse_sequence_ok"] = _metric_sse_sequence_ok(events)
        sql_ok = _metric_sql_ok(events, expected)
        if sql_ok is not None:
            metrics["sql_ok"] = sql_ok
        intent_hit = _metric_intent_hit(str(case.get("message") or ""), expected)
        if intent_hit is not None:
            metrics["intent_hit"] = intent_hit
        no_full = _metric_no_full_regenerate(events, expected)
        if no_full is not None:
            metrics["no_full_regenerate"] = no_full
        if expected.get("finish_reason"):
            finish = next((e for e in events if e["type"] == "finish"), None)
            metrics["finish_reason"] = ((finish or {}).get("data") or {}).get("reason") == expected["finish_reason"]
        if expected.get("error_code"):
            err = next((e for e in events if e["type"] == "error"), None)
            metrics["error_code"] = ((err or {}).get("data") or {}).get("code") == expected["error_code"]
        types = [e["type"] for e in events]
        for name in expected.get("events") or []:
            metrics[f"has_{name}"] = name in types
        if expected.get("no_patch"):
            metrics["no_patch"] = "patch" not in types

    passed = bool(metrics) and all(bool(v) for v in metrics.values()) and not errors
    return {
        "id": case.get("id"),
        "layer": layer,
        "passed": passed,
        "metrics": metrics,
        "errors": errors,
        "events": _normalize(events) if events else [],
    }


def load_cases() -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    if not CASES_DIR.is_dir():
        return rows
    for path in sorted(CASES_DIR.glob("*.yaml")):
        data = _load_yaml(path)
        if data:
            data.setdefault("id", path.stem)
            rows.append(data)
    return rows


def write_snapshot(result: Dict[str, Any]) -> None:
    EXPECTED_DIR.mkdir(parents=True, exist_ok=True)
    path = EXPECTED_DIR / f"{result['id']}.json"
    path.write_text(
        json.dumps({"id": result["id"], "events": result.get("events") or []}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def diff_snapshot(result: Dict[str, Any]) -> Optional[str]:
    path = EXPECTED_DIR / f"{result['id']}.json"
    if not path.is_file():
        return "missing snapshot"
    expected = json.loads(path.read_text(encoding="utf-8"))
    got = [e["type"] for e in result.get("events") or []]
    want = [e.get("type") for e in expected.get("events") or []]
    if got != want:
        return f"event types {got} != {want}"
    return None


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Open Dashboard harness eval runner")
    parser.add_argument("--mode", choices=["l1", "full", "replay", "record"], default="l1")
    args = parser.parse_args(argv)
    cases = load_cases()
    if args.mode == "l1":
        cases = [c for c in cases if str(c.get("layer") or "L2") == "L1"]
    results = []
    for case in cases:
        layer = str(case.get("layer") or "L2")
        if args.mode == "l1" and layer != "L1":
            continue
        res = run_case(case, mock_bi=True)
        if args.mode == "record" and layer != "L1":
            write_snapshot(res)
        if args.mode == "replay" and layer != "L1":
            diff = diff_snapshot(res)
            if diff:
                res["passed"] = False
                res["errors"] = list(res.get("errors") or []) + [diff]
        results.append(res)

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    report = {
        "ts": stamp,
        "mode": args.mode,
        "passed": sum(1 for r in results if r["passed"]),
        "failed": sum(1 for r in results if not r["passed"]),
        "results": results,
    }
    (REPORT_DIR / f"run-{stamp}.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [f"# Harness eval {stamp}", "", f"- passed: {report['passed']}", f"- failed: {report['failed']}", ""]
    for r in results:
        mark = "PASS" if r["passed"] else "FAIL"
        lines.append(f"- {mark} `{r['id']}` {r.get('metrics')}")
        for err in r.get("errors") or []:
            lines.append(f"  - {err}")
    (REPORT_DIR / f"run-{stamp}.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    return 0 if report["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
