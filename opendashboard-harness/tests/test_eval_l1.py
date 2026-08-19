from eval.runner import load_cases, run_case


def test_l1_cases_pass():
    cases = [c for c in load_cases() if c.get("layer") == "L1"]
    assert cases, "expected L1 yaml cases"
    failed = []
    for case in cases:
        res = run_case(case)
        if not res["passed"]:
            failed.append((case.get("id"), res.get("metrics"), res.get("errors")))
    assert not failed, failed


def test_l2_golden_subset():
    want = {
        "ASK-01-agg",
        "ASK-04-clarify",
        "ERR-01-no-dataset",
        "GEN-01-board",
        "GEN-05-empty",
        "MTR-01-append",
        "MTR-02-rechart",
    }
    cases = [c for c in load_cases() if c.get("id") in want]
    assert {c.get("id") for c in cases} == want
    failed = []
    for case in cases:
        res = run_case(case, mock_bi=True)
        if not res["passed"]:
            failed.append((case.get("id"), res.get("metrics"), res.get("errors")))
    assert not failed, failed


def test_err01_no_dataset():
    res = run_case(
        {
            "id": "ERR-01",
            "layer": "L2",
            "message": "各地区的销售额是多少？",
            "intent": "ask",
            "datasetIds": [],
            "expected": {"error_code": "BI_DATASETS", "finish_reason": "error"},
        }
    )
    assert res["passed"], res
