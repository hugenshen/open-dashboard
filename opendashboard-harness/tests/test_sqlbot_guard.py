from sqlbot.guard import assert_allowed_tables, check_sql_read, extract_nested_json, extract_tables


def test_rejects_write():
    ok, reason = check_sql_read("DELETE FROM orders")
    assert ok is False
    assert "Write" in reason or "not allowed" in reason.lower() or "DELETE" in reason


def test_allows_select():
    ok, reason = check_sql_read("SELECT merchant, SUM(amount) FROM orders GROUP BY merchant LIMIT 100")
    assert ok is True, reason


def test_rejects_multi_statement():
    ok, _ = check_sql_read("SELECT 1; DROP TABLE orders")
    assert ok is False


def test_table_whitelist():
    sql = "SELECT a FROM orders LIMIT 10"
    assert_allowed_tables(sql, ["orders"], "mysql")
    try:
        assert_allowed_tables(sql, ["sales"], "mysql")
        raise AssertionError("should reject")
    except ValueError as e:
        assert "unauthorized" in str(e)


def test_extract_json():
    blob = extract_nested_json('think\n{"success":true,"sql":"SELECT 1"}\n')
    assert blob and '"success":true' in blob


def test_extract_tables_skips_cte():
    sql = "WITH t AS (SELECT 1 AS x) SELECT x FROM t JOIN orders o ON 1=1"
    tables = extract_tables(sql, "mysql")
    assert "orders" in {x.lower() for x in tables}
    assert "t" not in {x.lower() for x in tables}
