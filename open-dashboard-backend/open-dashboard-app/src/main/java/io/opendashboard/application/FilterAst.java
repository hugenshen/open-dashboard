package io.opendashboard.application;

import io.opendashboard.domain.DatasetDtos.DatasetFieldVO;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Apply Filter AST ({items:[{field,op,value|from|to}]}) to in-memory rows.
 * Used by stub tables and landed file tables so query-bar / encode filters
 * still work when JDBC is not the query path.
 */
public final class FilterAst {

    private FilterAst() {}

    public static List<Map<String, Object>> apply(List<Map<String, Object>> rows, Map<String, Object> filters) {
        if (rows == null || rows.isEmpty() || !hasItems(filters)) return rows == null ? List.of() : rows;
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            if (matches(row, filters)) out.add(row);
        }
        return out;
    }

    public static List<List<Object>> filterTableRows(
            List<DatasetFieldVO> fields,
            List<List<Object>> rows,
            Map<String, Object> filters
    ) {
        if (rows == null || rows.isEmpty() || !hasItems(filters)) {
            return rows == null ? List.of() : rows;
        }
        List<String> names = new ArrayList<>();
        if (fields != null) {
            for (DatasetFieldVO f : fields) names.add(f == null ? "" : f.name());
        }
        List<List<Object>> out = new ArrayList<>();
        for (List<Object> row : rows) {
            if (matchesList(names, row, filters)) out.add(row);
        }
        return out;
    }

    static boolean hasItems(Map<String, Object> filters) {
        if (filters == null || filters.isEmpty()) return false;
        Object raw = filters.get("items");
        return raw instanceof List<?> list && !list.isEmpty();
    }

    static boolean matches(Map<String, Object> row, Map<String, Object> filters) {
        Object raw = filters.get("items");
        if (!(raw instanceof List<?> items)) return true;
        for (Object it : items) {
            if (!(it instanceof Map<?, ?> m)) continue;
            String field = m.get("field") == null ? "" : String.valueOf(m.get("field"));
            if (field.isBlank() || !row.containsKey(field)) continue;
            if (!cellMatches(row.get(field), m)) return false;
        }
        return true;
    }

    static boolean matchesList(List<String> names, List<Object> row, Map<String, Object> filters) {
        Object raw = filters.get("items");
        if (!(raw instanceof List<?> items)) return true;
        for (Object it : items) {
            if (!(it instanceof Map<?, ?> m)) continue;
            String field = m.get("field") == null ? "" : String.valueOf(m.get("field"));
            if (field.isBlank()) continue;
            int idx = names.indexOf(field);
            if (idx < 0) continue;
            Object cell = idx < row.size() ? row.get(idx) : null;
            if (!cellMatches(cell, m)) return false;
        }
        return true;
    }

    static boolean cellMatches(Object cell, Map<?, ?> m) {
        String op = m.get("op") == null
                ? (m.get("operator") == null ? "eq" : String.valueOf(m.get("operator")))
                : String.valueOf(m.get("op"));
        String lop = op.toLowerCase();
        if ("last".equals(lop)) {
            return true;
        }
        if ("between".equals(lop) || "daterange".equals(lop)) {
            Object from = m.get("from") != null ? m.get("from")
                    : (m.get("value") instanceof List<?> p && !p.isEmpty() ? p.get(0) : null);
            Object to = m.get("to") != null ? m.get("to")
                    : (m.get("value") instanceof List<?> p && p.size() > 1 ? p.get(1) : null);
            String s = cell == null ? "" : String.valueOf(cell);
            if (from != null && !String.valueOf(from).isBlank() && s.compareTo(String.valueOf(from)) < 0) return false;
            if (to != null && !String.valueOf(to).isBlank() && s.compareTo(String.valueOf(to)) > 0) return false;
            return true;
        }
        if ("in".equals(lop) && m.get("value") instanceof List<?> vals) {
            String s = cell == null ? "" : String.valueOf(cell);
            for (Object v : vals) {
                if (v != null && s.equals(String.valueOf(v))) return true;
            }
            return false;
        }
        Object value = m.get("value");
        if (value == null || String.valueOf(value).isBlank()) return true;
        return String.valueOf(value).equals(cell == null ? "" : String.valueOf(cell));
    }
}
