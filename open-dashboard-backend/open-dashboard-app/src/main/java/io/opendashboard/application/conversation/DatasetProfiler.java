package io.opendashboard.application.conversation;

import io.opendashboard.application.DatasetService;
import io.opendashboard.application.StubQueryService;
import io.opendashboard.domain.DatasetDtos.DatasetDetailVO;
import io.opendashboard.domain.DatasetDtos.DatasetFieldVO;
import io.opendashboard.domain.DatasetDtos.FieldProfileVO;
import io.opendashboard.domain.QueryDtos.ChartQueryRequest;
import io.opendashboard.domain.QueryDtos.ChartQueryResult;
import io.opendashboard.domain.gateway.FieldProfileGateway;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Compact dataset features for the planner (no LLM).
 * Field roles come from learned profile when present; else schema group / JDBC type.
 */
@Component
public class DatasetProfiler {

    private final DatasetService datasets;
    private final StubQueryService queryService;
    private final ObjectProvider<FieldProfileGateway> profileStore;

    public DatasetProfiler(
            DatasetService datasets,
            StubQueryService queryService,
            ObjectProvider<FieldProfileGateway> profileStore
    ) {
        this.datasets = datasets;
        this.queryService = queryService;
        this.profileStore = profileStore;
    }

    /** Harness / planner: stored field stats plus live chart probes. */
    public Map<String, Object> profile(String datasetId) {
        return profile(datasetId, true);
    }

    /**
     * @param includeProbes live KPI/bar/line probes against the source DB.
     *                      Dataset manage UI must pass false — probes are for
     *                      {@code od_profile_dataset} only.
     */
    public Map<String, Object> profile(String datasetId, boolean includeProbes) {
        Map<String, Object> out = new LinkedHashMap<>();
        if (datasetId == null || datasetId.isBlank()) {
            out.put("ok", false);
            out.put("error", "datasetId required");
            return out;
        }
        DatasetDetailVO detail = datasets.get(datasetId).orElse(null);
        if (detail == null || detail.meta() == null) {
            out.put("ok", false);
            out.put("error", "dataset not found");
            return out;
        }

        List<Map<String, Object>> fields = new ArrayList<>();
        List<DatasetFieldVO> measures = new ArrayList<>();
        List<DatasetFieldVO> dims = new ArrayList<>();
        List<DatasetFieldVO> times = new ArrayList<>();
        // Learned stats first; else schema group / JDBC type.
        Map<String, FieldProfileVO> stats = loadFieldStats(datasetId);
        Map<String, String> learned = learnedRolesFrom(stats);
        if (detail.fields() != null) {
            for (DatasetFieldVO f : detail.fields()) {
                String role = learned.getOrDefault(f.name(), roleOf(f));
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("name", f.name());
                row.put("label", display(f));
                row.put("group", f.group());
                row.put("dataType", f.dataType());
                row.put("role", role);
                FieldProfileVO p = stats.get(f.name());
                String src = "schema";
                if (p != null && p.roleSource() != null && !p.roleSource().isBlank()) {
                    src = p.roleSource();
                } else if (learned.containsKey(f.name())) {
                    src = "learned";
                }
                row.put("roleSource", src);
                if (p != null) {
                    row.put("distinctCount", p.distinctCount());
                    row.put("nullRate", p.nullRate());
                    row.put("distinctValues", p.distinctValues());
                    row.put("numericMin", p.numericMin());
                    row.put("numericMax", p.numericMax());
                }
                fields.add(row);
                switch (role) {
                    case "measure" -> measures.add(f);
                    case "time" -> times.add(f);
                    case "dim" -> dims.add(f);
                    default -> {
                    }
                }
            }
        }

        // Schema order only — no business-word ranking.

        out.put("ok", true);
        out.put("datasetId", datasetId);
        out.put("name", detail.meta().name());
        out.put("tableName", detail.meta().tableName());
        out.put("folder", detail.meta().folder());
        out.put("weakDataset", DeterministicPlanner.isWeakDataset(detail));
        out.put("fields", fields);
        out.put("measures", names(measures, 6));
        out.put("dims", names(dims, 6));
        out.put("timeFields", names(times, 3));
        out.put("queryFields", queryFields(times, dims));

        if (!includeProbes) {
            return out;
        }

        List<Map<String, Object>> probes = new ArrayList<>();
        DatasetFieldVO countKey = !dims.isEmpty() ? dims.getFirst() : firstField(detail);
        int liveRows = -1;
        String sqlNote = "";
        if (countKey != null) {
            Probe p = probeKpi(datasetId, countKey.name(), "COUNT");
            probes.add(p.toMap("count", countKey));
            liveRows = p.rowCount;
            sqlNote = p.sql == null ? "" : p.sql;
        }
        DatasetFieldVO bestMeasure = pickMeasure(measures);
        int kpiN = 0;
        int liveKpis = 0;
        for (DatasetFieldVO m : measures) {
            if (kpiN >= 4) break;
            Probe kpi = probeKpi(datasetId, m.name(), suggestedAgg(m));
            probes.add(kpi.toMap("kpi", m));
            if (sqlNote.isBlank()) sqlNote = kpi.sql == null ? "" : kpi.sql;
            if (liveRows <= 0) liveRows = kpi.rowCount;
            kpiN++;
            if (!kpi.emptyValue()) liveKpis++;
            if (FieldSemantics.queryFailed(kpi.sql) && liveKpis >= 1) break;
        }
        if (bestMeasure != null) {
            for (int i = 0; i < Math.min(3, dims.size()); i++) {
                Probe bar = probeCat(datasetId, dims.get(i).name(), bestMeasure.name(), suggestedAgg(bestMeasure));
                probes.add(bar.toMap("bar", dims.get(i), bestMeasure));
                if (FieldSemantics.queryFailed(bar.sql)) break;
            }
        }
        if (bestMeasure != null) {
            for (int i = 0; i < Math.min(3, times.size()); i++) {
                Probe line = probeCat(datasetId, times.get(i).name(), bestMeasure.name(), suggestedAgg(bestMeasure));
                probes.add(line.toMap("line", times.get(i), bestMeasure));
                if (line.rowCount > 0 && !line.emptyValue()) break;
            }
        }

        boolean empty = liveRows == 0
                || (!probes.isEmpty() && probes.stream().allMatch(p -> {
                    Object n = p.get("rowCount");
                    return n instanceof Number num && num.intValue() == 0;
                }));

        out.put("empty", empty);
        out.put("liveRowHint", liveRows);
        if (FieldSemantics.queryFailed(sqlNote) || sqlNote.startsWith("-- live")) {
            out.put("hint", "部分实时聚合超时或失败（不一定是没数据）。优先用已探活字段。");
        } else if (empty) {
            out.put("hint", "探测查询无有效行，不要用空 encode 写看板。");
        }
        out.put("probes", probes);
        return out;
    }

    private static Map<String, String> learnedRolesFrom(Map<String, FieldProfileVO> stats) {
        Map<String, String> out = new HashMap<>();
        for (FieldProfileVO p : stats.values()) {
            if (p.roleLearned() != null && !p.roleLearned().isBlank()) {
                out.put(p.fieldName(), p.roleLearned());
            }
        }
        return out;
    }

    private Map<String, FieldProfileVO> loadFieldStats(String datasetId) {
        FieldProfileGateway store = profileStore.getIfAvailable();
        if (store == null) return Map.of();
        Map<String, FieldProfileVO> out = new HashMap<>();
        try {
            for (FieldProfileVO p : store.listByDataset(datasetId)) {
                out.put(p.fieldName(), p);
            }
        } catch (Exception e) {
            // 无表时返回空
        }
        return out;
    }

    private record Probe(int rowCount, Object sample, String sql) {
        boolean emptyValue() {
            if (rowCount <= 0) return true;
            return kpiSample(sample) == null;
        }

        Map<String, Object> toMap(String kind, DatasetFieldVO... used) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("kind", kind);
            if (used.length > 0) m.put("field", used[0].name());
            if (used.length > 1) m.put("category", used[0].name());
            if (used.length > 1) m.put("value", used[1].name());
            m.put("rowCount", rowCount);
            m.put("cardinality", rowCount);
            m.put("sample", sample);
            Object kpi = kpiSample(sample);
            if (kpi != null) m.put("kpiValue", kpi);
            boolean granular = "line".equals(kind) && (rowCount > 24 || looksTimestamp(sample));
            boolean empty = "kpi".equals(kind) || "count".equals(kind) ? emptyValue()
                    : (rowCount <= 0 || granular);
            m.put("tooGranular", granular);
            m.put("emptyValue", empty);
            if (sql != null && !sql.isBlank()) {
                m.put("sql", sql.length() > 240 ? sql.substring(0, 240) : sql);
            }
            return m;
        }
    }

    private static boolean looksTimestamp(Object sample) {
        Object v = sample;
        if (sample instanceof List<?> row && !row.isEmpty()) {
            v = row.getFirst();
        }
        if (v == null) return false;
        String s = String.valueOf(v);
        return s.length() >= 16 && s.indexOf('T') > 0 && (s.indexOf('Z') > 0 || s.indexOf(':') > 10);
    }

    private static Object kpiSample(Object sample) {
        if (sample instanceof List<?> row && !row.isEmpty()) {
            Object v = row.size() > 1 ? row.get(1) : row.getFirst();
            if (v == null || "".equals(v) || "null".equalsIgnoreCase(String.valueOf(v))) return null;
            return v;
        }
        return sample;
    }

    private static List<Map<String, String>> queryFields(List<DatasetFieldVO> times, List<DatasetFieldVO> dims) {
        List<Map<String, String>> out = new ArrayList<>();
        if (!times.isEmpty()) {
            DatasetFieldVO t = times.getFirst();
            out.add(Map.of("name", t.name(), "label", display(t), "kind", "date"));
        }
        for (DatasetFieldVO d : dims) {
            if (out.size() >= 3) break;
            out.add(Map.of("name", d.name(), "label", display(d), "kind", "select"));
        }
        return out;
    }

    private Probe probeKpi(String datasetId, String value, String agg) {
        Map<String, Object> encode = new LinkedHashMap<>();
        encode.put("datasetId", datasetId);
        encode.put("value", value);
        encode.put("agg", agg);
        return run(datasetId, "kpi", encode);
    }

    private Probe probeCat(String datasetId, String category, String value, String agg) {
        Map<String, Object> encode = new LinkedHashMap<>();
        encode.put("datasetId", datasetId);
        encode.put("category", category);
        encode.put("value", value);
        encode.put("agg", agg);
        return run(datasetId, "bar", encode);
    }

    private Probe run(String datasetId, String chartType, Map<String, Object> encode) {
        Map<String, Object> inline = new LinkedHashMap<>();
        inline.put("datasetId", datasetId);
        inline.put("chartType", chartType);
        inline.put("title", "profile");
        inline.put("encode", encode);
        try {
            ChartQueryResult r = queryService.query(new ChartQueryRequest("profile", null, "draft", inline, Map.of()));
            List<List<Object>> data = r.data() == null ? List.of() : r.data();
            Object sample = data.isEmpty() ? null : data.getFirst();
            Object sql = r.extra() == null ? null : r.extra().get("sql");
            return new Probe(data.size(), sample, sql == null ? "" : String.valueOf(sql));
        } catch (Exception e) {
            return new Probe(0, null, e.getMessage());
        }
    }

    /**
     * Role from name/label first (IDs and status/type codes), then schema group / JDBC type.
     * Learned profile still wins in {@code BiPlatformService} when present.
     */
    public static String roleOf(DatasetFieldVO f) {
        if (f == null || f.name() == null) return "junk";
        if (isTimeField(f)) return "time";
        if (FieldSemantics.looksLikeIdentifier(f.name(), f.label())) return "id";
        if (FieldSemantics.looksLikeCodeDim(f.name(), f.label())) return "dim";
        String g = f.group() == null ? "" : f.group().toLowerCase(Locale.ROOT);
        if (g.equals("q") || g.equals("quota") || g.equals("measure")) return "measure";
        if (g.equals("d") || g.equals("dim") || g.equals("dimension")) return "dim";
        if (g.equals("t") || g.equals("time")) return "time";
        String dt = f.dataType() == null ? "" : f.dataType().toUpperCase(Locale.ROOT);
        if (dt.contains("INT") || dt.contains("DECIMAL") || dt.contains("NUMERIC")
                || dt.contains("FLOAT") || dt.contains("DOUBLE") || dt.contains("LONG")) {
            return "measure";
        }
        if (dt.contains("CHAR") || dt.contains("TEXT") || dt.contains("STRING")) return "dim";
        return "junk";
    }

    private static boolean isTimeField(DatasetFieldVO f) {
        if (f == null) return false;
        String g = f.group() == null ? "" : f.group().toLowerCase(Locale.ROOT);
        if (g.equals("t") || g.equals("time")) return true;
        String dt = f.dataType() == null ? "" : f.dataType().toUpperCase(Locale.ROOT);
        return dt.contains("DATE") || dt.contains("TIME") || dt.contains("TIMESTAMP");
    }

    private static DatasetFieldVO pickMeasure(List<DatasetFieldVO> measures) {
        if (measures == null || measures.isEmpty()) return null;
        return measures.getFirst();
    }

    private static String suggestedAgg(DatasetFieldVO ignored) {
        return "SUM";
    }

    private static DatasetFieldVO firstField(DatasetDetailVO detail) {
        if (detail.fields() == null || detail.fields().isEmpty()) return null;
        return detail.fields().getFirst();
    }

    private static List<Map<String, String>> names(List<DatasetFieldVO> fields, int limit) {
        List<Map<String, String>> out = new ArrayList<>();
        for (DatasetFieldVO f : fields) {
            if (out.size() >= limit) break;
            out.add(Map.of("name", f.name(), "label", display(f)));
        }
        return out;
    }

    private static String display(DatasetFieldVO f) {
        String raw = f.label() == null || f.label().isBlank() ? f.name() : f.label();
        raw = raw.replace('，', ',');
        int comma = raw.indexOf(',');
        if (comma > 0) raw = raw.substring(0, comma).trim();
        int colon = raw.indexOf(':');
        if (colon > 1) raw = raw.substring(0, colon).trim();
        return raw;
    }
}
