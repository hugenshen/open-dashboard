package io.opendashboard.application.conversation;

import io.opendashboard.domain.DatasetDtos.DatasetDetailVO;
import io.opendashboard.domain.DatasetDtos.DatasetFieldVO;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Last-resort board plan from schema group / dataType only.
 * No business-word dictionaries. Primary path is dsh {@code od_generate_board}.
 */
public final class DeterministicPlanner {

    private static final AtomicLong SEQ = new AtomicLong(System.currentTimeMillis() % 1_000_000_000L);

    private DeterministicPlanner() {}

    public static DashboardPatch.Patch plan(
            String dashboardId,
            String styleId,
            String message,
            SchemaGuard.SchemaBundle schema
    ) {
        String q = message == null ? "" : message.trim();
        String datasetId = pickDataset(q, schema);
        DatasetDetailVO detail = schema.byId().get(datasetId);

        List<DatasetFieldVO> measures = fieldsOf(detail, "measure").stream()
                .filter(f -> !FieldSemantics.looksLikeIdentifier(f.name(), f.label()))
                .toList();
        List<DatasetFieldVO> additive = measures.stream()
                .filter(f -> !FieldSemantics.looksLikeRatio(f.name(), f.label()))
                .toList();
        List<DatasetFieldVO> ratios = measures.stream()
                .filter(f -> FieldSemantics.looksLikeRatio(f.name(), f.label()))
                .toList();
        List<DatasetFieldVO> dims = fieldsOf(detail, "dim");
        DatasetFieldVO time = fieldsOf(detail, "time").stream().findFirst().orElse(null);

        long base = SEQ.addAndGet(40);
        List<Map<String, Object>> ops = new ArrayList<>();
        ops.add(DashboardPatch.setLayout(72, "default"));
        ops.add(DashboardPatch.setTheme(styleId == null || styleId.isBlank() ? "feishu-blue" : styleId));

        DatasetFieldVO countKey = !dims.isEmpty() ? dims.getFirst() : time;
        if (countKey == null && additive.isEmpty() && ratios.isEmpty()) {
            return new DashboardPatch.Patch(dashboardId, ops);
        }

        int seq = 0;
        List<ChartSpec> kpis = new ArrayList<>();
        List<ChartSpec> plots = new ArrayList<>();
        if (countKey != null) {
            kpis.add(new ChartSpec(
                    String.valueOf(base + seq++), "kpi", "记录数",
                    encodeKpi(datasetId, countKey.name(), "COUNT")
            ));
        }
        for (DatasetFieldVO m : additive) {
            if (kpis.size() >= 4) break;
            kpis.add(new ChartSpec(
                    String.valueOf(base + seq++), "kpi", display(m),
                    encodeKpi(datasetId, m.name(), "SUM")
            ));
        }
        if (kpis.size() < 4 && !ratios.isEmpty()) {
            DatasetFieldVO r0 = ratios.getFirst();
            kpis.add(new ChartSpec(
                    String.valueOf(base + seq++), "kpi", display(r0),
                    encodeKpi(datasetId, r0.name(), "AVG")
            ));
        }

        DatasetFieldVO plotMeasure = additive.isEmpty() ? null : additive.getFirst();
        String valueField = plotMeasure != null
                ? plotMeasure.name()
                : (countKey != null ? countKey.name() : null);
        String agg = plotMeasure != null ? "SUM" : "COUNT";
        String valueLabel = plotMeasure != null ? display(plotMeasure) : "记录数";

        if (valueField != null && !dims.isEmpty()) {
            DatasetFieldVO d0 = dims.getFirst();
            plots.add(new ChartSpec(
                    String.valueOf(base + seq++), "bar",
                    display(d0) + " · " + valueLabel,
                    encodeCat(datasetId, d0, valueField, agg)
            ));
            DatasetFieldVO pieDim = dims.size() > 1 ? dims.get(1) : null;
            if (pieDim != null && FieldSemantics.looksLikeCodeDim(pieDim.name(), pieDim.label())) {
                plots.add(new ChartSpec(
                        String.valueOf(base + seq++), "pie",
                        display(pieDim) + " 构成",
                        encodeCat(datasetId, pieDim, pieDim.name(), "COUNT")
                ));
            }
            if (time != null) {
                plots.add(new ChartSpec(
                        String.valueOf(base + seq++), "line",
                        display(time) + "走势 · " + valueLabel,
                        encodeCat(datasetId, time, valueField, agg)
                ));
            } else if (dims.size() > 2) {
                DatasetFieldVO d2 = dims.get(2);
                plots.add(new ChartSpec(
                        String.valueOf(base + seq++), "bar",
                        display(d2) + " · " + valueLabel,
                        encodeCat(datasetId, d2, valueField, agg)
                ));
            }
        } else if (valueField != null && countKey != null) {
            plots.add(new ChartSpec(
                    String.valueOf(base + seq++), "bar",
                    display(countKey) + " · " + valueLabel,
                    encodeCat(datasetId, countKey, valueField, agg)
            ));
        }

        layout(ops, datasetId, kpis, plots);
        return new DashboardPatch.Patch(dashboardId, ops);
    }

    private record ChartSpec(String id, String type, String title, Map<String, Object> encode) {}

    private static void layout(
            List<Map<String, Object>> ops,
            String datasetId,
            List<ChartSpec> kpis,
            List<ChartSpec> plots
    ) {
        int kpiN = Math.min(4, kpis.size());
        int kpiW = kpiN == 0 ? 72 : 72 / kpiN;
        for (int i = 0; i < kpiN; i++) {
            ChartSpec c = kpis.get(i);
            ops.add(DashboardPatch.upsertChart(c.id(), c.type(), datasetId, c.title(), c.encode(), Map.of()));
            ops.add(DashboardPatch.upsertComponent(c.id(), c.id(), i * kpiW, 0, kpiW, 10));
        }
        int y = kpiN == 0 ? 0 : 12;
        int col = 0;
        for (int i = 0; i < plots.size(); i++) {
            ChartSpec c = plots.get(i);
            boolean last = i == plots.size() - 1;
            int w;
            int x;
            if (plots.size() == 1) {
                w = 72;
                x = 0;
            } else if (last && col == 0) {
                w = 72;
                x = 0;
            } else {
                w = 36;
                x = col * 36;
            }
            ops.add(DashboardPatch.upsertChart(c.id(), c.type(), datasetId, c.title(), c.encode(), Map.of()));
            ops.add(DashboardPatch.upsertComponent(c.id(), c.id(), x, y, w, 20));
            if (w == 72 || col == 1) {
                y += 22;
                col = 0;
            } else {
                col = 1;
            }
        }
    }

    public static String resolveTitle(String message, SchemaGuard.SchemaBundle schema) {
        String datasetId = pickDataset(message == null ? "" : message, schema);
        DatasetDetailVO detail = schema.byId().get(datasetId);
        String dsName = datasetName(detail, datasetId);
        String q = message == null ? "" : message.trim();
        if (!q.isBlank() && q.length() <= 24 && !q.equals(dsName)) {
            return q;
        }
        return dsName.isBlank() ? "数据概览" : truncate(dsName, 18) + "分析";
    }

    public static String resolveDatasetId(String message, SchemaGuard.SchemaBundle schema) {
        return pickDataset(message == null ? "" : message, schema);
    }

    public static boolean isWeakDataset(DatasetDetailVO detail) {
        if (detail == null || detail.meta() == null) return false;
        String table = detail.meta().tableName() == null ? "" : detail.meta().tableName().toLowerCase(Locale.ROOT);
        String name = detail.meta().name() == null ? "" : detail.meta().name().toLowerCase(Locale.ROOT);
        return table.startsWith("de_") || table.contains("dashboard") || name.contains("dashboard");
    }

    public static Map<String, Object> planSummary(DashboardPatch.Patch patch, String message) {
        Map<String, Object> plan = new LinkedHashMap<>();
        plan.put("title", "生成数据分析看板");
        plan.put("summary", message == null ? "" : message);
        List<Map<String, Object>> steps = new ArrayList<>();
        steps.add(Map.of("id", "1", "label", "读取数据集 Schema"));
        steps.add(Map.of("id", "2", "label", "按字段角色规划 KPI / 对比 / 分布"));
        steps.add(Map.of("id", "3", "label", "写入 Dashboard draft"));
        steps.add(Map.of("id", "4", "label", "预览 chartQuery"));
        plan.put("steps", steps);
        plan.put("patch", patch.toMap());
        return plan;
    }

    private static String pickDataset(String q, SchemaGuard.SchemaBundle schema) {
        return schema.byId().entrySet().stream()
                .max(Comparator.comparingInt(e -> overlapScore(q, e.getValue())))
                .map(Map.Entry::getKey)
                .orElseGet(() -> schema.byId().keySet().iterator().next());
    }

    /** Prefer datasets whose name/table/field labels appear in the user text. */
    private static int overlapScore(String q, DatasetDetailVO detail) {
        if (isWeakDataset(detail)) return -100;
        int score = 0;
        String name = datasetName(detail, "");
        String table = detail.meta() != null && detail.meta().tableName() != null
                ? detail.meta().tableName() : "";
        if (!q.isBlank() && !name.isBlank() && q.contains(name)) score += 50;
        if (!q.isBlank() && !table.isBlank() && q.toLowerCase(Locale.ROOT).contains(table.toLowerCase(Locale.ROOT))) {
            score += 40;
        }
        if (detail.fields() != null) {
            for (DatasetFieldVO f : detail.fields()) {
                String n = f.name() == null ? "" : f.name();
                String l = display(f);
                if (!q.isBlank() && !n.isBlank() && containsIgnoreCase(q, n)) score += 8;
                if (!q.isBlank() && !l.isBlank() && q.contains(l)) score += 10;
            }
        }
        return score;
    }

    private static List<DatasetFieldVO> fieldsOf(DatasetDetailVO detail, String role) {
        if (detail == null || detail.fields() == null) return List.of();
        List<DatasetFieldVO> out = new ArrayList<>();
        for (DatasetFieldVO f : detail.fields()) {
            if (role.equals(DatasetProfiler.roleOf(f))) out.add(f);
        }
        return out;
    }

    private static String display(DatasetFieldVO f) {
        if (f == null) return "";
        String raw = f.label() == null || f.label().isBlank() ? f.name() : f.label();
        String normalized = raw.replace('，', ',');
        int comma = normalized.indexOf(',');
        if (comma > 0) {
            String head = normalized.substring(0, comma).trim();
            if (!head.isBlank()) raw = head;
        }
        int colon = raw.indexOf(':');
        if (colon > 1) {
            String head = raw.substring(0, colon).trim();
            if (!head.isBlank()) return head;
        }
        return raw;
    }

    private static String datasetName(DatasetDetailVO detail, String fallback) {
        if (detail != null && detail.meta() != null && detail.meta().name() != null) {
            return detail.meta().name();
        }
        return fallback;
    }

    private static Map<String, Object> encodeKpi(String datasetId, String value, String agg) {
        Map<String, Object> encode = new LinkedHashMap<>();
        encode.put("datasetId", datasetId);
        encode.put("value", value);
        encode.put("agg", agg);
        return encode;
    }

    private static Map<String, Object> encodeCat(String datasetId, DatasetFieldVO category, String value, String agg) {
        Map<String, Object> encode = new LinkedHashMap<>();
        encode.put("datasetId", datasetId);
        encode.put("category", category.name());
        encode.put("value", value);
        encode.put("agg", agg);
        Map<String, String> vm = FieldSemantics.parseValueMap(category.label());
        String alias = display(category);
        if (!vm.isEmpty() || (alias != null && !alias.equals(category.name()))) {
            Map<String, Object> entry = new LinkedHashMap<>();
            if (alias != null && !alias.equals(category.name())) entry.put("alias", alias);
            if (!vm.isEmpty()) entry.put("valueMap", vm);
            encode.put("fieldCfg", Map.of(category.name(), entry));
        }
        return encode;
    }

    private static boolean containsIgnoreCase(String hay, String needle) {
        return hay.toLowerCase(Locale.ROOT).contains(needle.toLowerCase(Locale.ROOT));
    }

    private static String truncate(String s, int n) {
        if (s == null) return "";
        return s.length() <= n ? s : s.substring(0, n) + "…";
    }
}
