"""Read-only SQL guard — SQLBot check_sql_read + table whitelist (sqlglot)."""

from __future__ import annotations

import re
from typing import Iterable, Optional, Set, Tuple

try:
    import sqlglot
    from sqlglot import exp
except ImportError:  # pragma: no cover
    sqlglot = None
    exp = None


_WRITE = {
    "INSERT", "UPDATE", "DELETE", "CREATE", "DROP", "ALTER",
    "TRUNCATE", "MERGE", "COPY", "REPLACE", "GRANT", "REVOKE",
    "USE", "SET", "CALL",
}
_DANGEROUS = [
    r"\bINTO\s+OUTFILE\b",
    r"\bLOAD_FILE\s*\(",
    r"\bSLEEP\s*\(",
    r"\bpg_sleep\s*\(",
    r";\s*(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b",
]


def extract_nested_json(text: str) -> Optional[str]:
    if not text:
        return None
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        return None
    return text[start : end + 1]


def _first_keyword(sql: str) -> str:
    s = sql.strip().lstrip("(").strip()
    if not s:
        return ""
    return s.split(None, 1)[0].upper()


def extract_tables(sql: str, dialect: Optional[str] = None) -> Set[str]:
    tables: Set[str] = set()
    if sqlglot is None:
        for m in re.finditer(r"(?i)\b(?:FROM|JOIN)\s+([`\"\[]?)([^\s,`\"\]();]+)", sql):
            tables.add(m.group(2).split(".")[-1].strip("`\"[]"))
        return tables
    try:
        statements = sqlglot.parse(sql, dialect=_dialect(dialect))
    except Exception:
        return tables
    for stmt in statements:
        if not stmt:
            continue
        cte_names = {cte.alias for cte in stmt.find_all(exp.CTE) if cte.alias}
        for table in stmt.find_all(exp.Table):
            name = table.name
            if name and name not in cte_names:
                tables.add(name)
    return tables


def check_sql_read(sql: str, dialect: Optional[str] = None) -> Tuple[bool, str]:
    raw = (sql or "").strip()
    if not raw:
        return False, "SQL is empty"
    if raw.endswith(";"):
        raw = raw[:-1].strip()
    if ";" in raw:
        return False, "Multiple statements are not allowed"
    first = _first_keyword(raw)
    if first in _WRITE:
        return False, f"Write operation '{first}' is not allowed"
    for pattern in _DANGEROUS:
        if re.search(pattern, raw, re.IGNORECASE):
            return False, f"SQL contains dangerous pattern: {pattern}"
    if first not in {"SELECT", "WITH"}:
        return False, f"SQL command '{first}' is not allowed. Only SELECT and WITH are permitted"
    if sqlglot is None:
        return True, ""
    try:
        statements = sqlglot.parse(raw, dialect=_dialect(dialect))
    except Exception as e:
        return False, f"Parse SQL Error: {e}"
    if not statements:
        return False, "Parse SQL Error"
    write_types = (exp.Insert, exp.Update, exp.Delete, exp.Create, exp.Drop, exp.Alter)
    for stmt in statements:
        if stmt is None:
            continue
        if isinstance(stmt, write_types):
            return False, f"SQL contains write operation: {type(stmt).__name__}"
    return True, ""


def assert_allowed_tables(sql: str, allowed: Iterable[str], dialect: Optional[str] = None) -> None:
    ok, reason = check_sql_read(sql, dialect)
    if not ok:
        raise ValueError(reason)
    actual = {t.lower() for t in extract_tables(sql, dialect)}
    if not actual:
        raise ValueError("SQL parsing failed: unable to extract table names")
    allow = {str(t).lower() for t in allowed if t}
    extra = actual - allow
    if extra:
        raise ValueError(
            f"SQL contains unauthorized tables: {', '.join(sorted(extra))}. "
            f"Allowed: {', '.join(sorted(allow))}"
        )


def _dialect(engine: Optional[str]) -> Optional[str]:
    if not engine:
        return None
    e = engine.lower()
    if e in ("mysql", "mariadb"):
        return "mysql"
    if e in ("postgres", "postgresql", "pg", "file", "excel", "csv"):
        return "postgres"
    return e
