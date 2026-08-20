from tools.od_bi import review_dataset_fields


def test_review_dataset_fields_caches_llm_roles(monkeypatch):
    monkeypatch.setattr(
        "tools.od_bi.interpret_fields_llm",
        lambda ds, schema=None: {
            "ok": True,
            "source": "llm",
            "fields": [
                {
                    "name": "mch_id",
                    "label": "商户",
                    "role": "dimension",
                    "aggregatable": False,
                    "alias": "商户号",
                }
            ],
        },
    )
    out = review_dataset_fields("ds_1")
    assert out["source"] == "llm"
    assert out["fields"][0]["name"] == "mch_id"
    assert out["fields"][0]["role"] == "dimension"


def test_review_dataset_fields_stats_fallback(monkeypatch):
    monkeypatch.setattr(
        "tools.od_bi.interpret_fields_llm",
        lambda ds, schema=None: {
            "ok": True,
            "source": "stats",
            "fields": [{"name": "id", "role": "id"}],
        },
    )
    out = review_dataset_fields("ds_1")
    assert out["source"] == "stats"
