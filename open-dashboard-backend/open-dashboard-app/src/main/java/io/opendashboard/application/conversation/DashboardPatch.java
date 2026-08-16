package io.opendashboard.application.conversation;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Structured DashboardPatch emitted by the conversation harness. */
public final class DashboardPatch {

    private DashboardPatch() {}

    public record Patch(
            String dashboardId,
            List<Map<String, Object>> ops
    ) {
        public Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("dashboardId", dashboardId);
            m.put("ops", ops == null ? List.of() : ops);
            return m;
        }

        @SuppressWarnings("unchecked")
        public static Patch fromMap(Map<String, Object> raw) {
            if (raw == null) return new Patch(null, List.of());
            Object nested = raw.get("patch");
            if (!(raw.get("ops") instanceof List<?>) && nested instanceof Map<?, ?> nestedMap) {
                Map<String, Object> inner = new LinkedHashMap<>();
                nestedMap.forEach((k, v) -> inner.put(String.valueOf(k), v));
                return fromMap(inner);
            }
            Object opsObj = raw.get("ops");
            List<Map<String, Object>> ops = new ArrayList<>();
            if (opsObj instanceof List<?> list) {
                for (Object o : list) {
                    if (o instanceof Map<?, ?> map) {
                        Map<String, Object> row = new LinkedHashMap<>();
                        map.forEach((k, v) -> row.put(String.valueOf(k), v));
                        ops.add(row);
                    }
                }
            }
            Object dash = raw.get("dashboardId");
            return new Patch(dash == null ? null : String.valueOf(dash), ops);
        }
    }

    public static Map<String, Object> upsertChart(
            String chartId,
            String type,
            String datasetId,
            String title,
            Map<String, Object> encode,
            Map<String, Object> style
    ) {
        Map<String, Object> op = new LinkedHashMap<>();
        op.put("op", "upsert_chart");
        op.put("chartId", chartId);
        op.put("type", type);
        op.put("datasetId", datasetId);
        op.put("title", title);
        op.put("encode", encode == null ? Map.of() : encode);
        op.put("style", style == null ? Map.of() : style);
        return op;
    }

    public static Map<String, Object> upsertComponent(
            String id,
            String chartId,
            int x,
            int y,
            int w,
            int h
    ) {
        Map<String, Object> op = new LinkedHashMap<>();
        op.put("op", "upsert_component");
        op.put("id", id);
        op.put("chartId", chartId);
        op.put("x", x);
        op.put("y", y);
        op.put("w", w);
        op.put("h", h);
        return op;
    }

    public static Map<String, Object> setLayout(int gridCols, String themeRef) {
        Map<String, Object> op = new LinkedHashMap<>();
        op.put("op", "set_layout");
        op.put("gridCols", gridCols);
        op.put("themeRef", themeRef);
        return op;
    }

    public static Map<String, Object> setTheme(String styleId) {
        Map<String, Object> op = new LinkedHashMap<>();
        op.put("op", "set_theme");
        op.put("styleId", styleId);
        return op;
    }
}
