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
 * Compact dataset features for the Lead Agent planner (no LLM).
 * Probes a few encodes so the agent can skip empty charts.
 * Field roles come from self-learning profile (de_dataset_field_profile) when
 * present (stats-first deterministic gate); keyword roleOf is the fallback.
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

    public Map<String, Object> profile(String datasetId) {
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
        // 已学习的角色（统计判定）优先；无则回退现场关键词判定
        Map<String, String> learned = loadLearnedRoles(datasetId);
        Map<String, FieldProfileVO> stats = loadFieldStats(datasetId);
        if (detail.fields() != null) {
            for (DatasetFieldVO f : detail.fields()) {
                String role = learned.getOrDefault(f.name(), roleOf(f));
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("name", f.name());
                row.put("label", display(f));
                row.put("group", f.group());
                row.put("dataType", f.dataType());
                row.put("role", role);
                row.put("roleSource", learned.containsKey(f.name()) ? "learned" : "naming");
                // 附带统计特征（distinct/取值/null），供"维度管理/公共维度"展示与消费
                FieldProfileVO p = stats.get(f.name());
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

        dims.sort((a, b) -> Integer.compare(dimScore(b), dimScore(a)));
        measures.sort((a, b) -> Integer.compare(measureScore(b), measureScore(a)));
        times.sort((a, b) -> Integer.compare(timeScore(b), timeScore(a)));

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

        out.put("ok", true);
        out.put("datasetId", datasetId);
        out.put("name", detail.meta().name());
        out.put("tableName", detail.meta().tableName());
        out.put("folder", detail.meta().folder());
        out.put("weakDataset", DeterministicPlanner.isWeakDataset(detail));
        out.put("empty", empty);
        out.put("liveRowHint", liveRows);
        if (FieldSemantics.queryFailed(sqlNote) || sqlNote.startsWith("-- live")) {
            out.put("hint", "部分实时聚合超时或失败（不一定是没数据）。优先用已探活字段；商户维用 MchId，入账失败时回退支付金额 Amount。");
        } else if (empty) {
            out.put("hint", "探测查询无有效行，不要用空 encode 写看板。");
        }
        out.put("fields", fields);
        out.put("measures", names(measures, 6));
        out.put("dims", names(dims, 6));
        out.put("timeFields", names(times, 3));
        out.put("queryFields", queryFields(times, dims));
        out.put("probes", probes);
        return out;
    }

    private Map<String, String> loadLearnedRoles(String datasetId) {
        FieldProfileGateway store = profileStore.getIfAvailable();
        if (store == null) return Map.of();
        Map<String, String> out = new HashMap<>();
        try {
            for (FieldProfileVO p : store.listByDataset(datasetId)) {
                if (p.roleLearned() != null && !p.roleLearned().isBlank()) {
                    out.put(p.fieldName(), p.roleLearned());
                }
            }
        } catch (Exception e) {
            // 无表/查询失败时回退关键词判定
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
            String n = d.name().toLowerCase(Locale.ROOT);
            String l = display(d);
            boolean skip = n.contains("late") || l.contains("最终");
            boolean pick = n.contains("status") || l.contains("状态")
                    || n.contains("channel") || l.contains("渠道")
                    || n.contains("region") || l.contains("区域");
            if (skip || !pick) continue;
            out.add(Map.of("name", d.name(), "label", l, "kind", "select"));
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

    static String roleOf(DatasetFieldVO f) {
        if (f == null || f.name() == null) return "junk";
        String n = f.name().toLowerCase(Locale.ROOT);
        String l = f.label() == null ? "" : f.label();
        if (n.contains("url") || n.contains("msg") || n.contains("extra") || n.contains("param")
                || n.contains("email") || n.contains("safekey") || n.contains("errcode") || n.contains("errmsg")
                || n.contains("ip") || n.equals("body") || n.equals("subject")
                || n.contains("attach") || n.contains("notify") || n.contains("player")
                || n.contains("orderno") || n.contains("order_no")
                || (n.contains("order") && (n.contains("id") || n.endsWith("no")))) {
            return "junk";
        }
        if (isTimeField(f)) return "time";
        if (isStatusLike(f)) return "dim";
        if (FieldSemantics.isBusinessEntityId(f)) return "dim";
        if ("quota".equalsIgnoreCase(f.group())
                && !n.equals("id") && !n.equals("pid") && !n.equals("version")
                && !n.endsWith("id") && measureScore(f) >= 20) {
            return "measure";
        }
        if ("dim".equalsIgnoreCase(f.group()) && (!n.endsWith("id") || FieldSemantics.isBusinessEntityId(f))) {
            return "dim";
        }
        return "junk";
    }

    private static boolean isTimeField(DatasetFieldVO f) {
        if (f == null || f.name() == null) return false;
        String n = f.name().toLowerCase(Locale.ROOT);
        String l = f.label() == null ? "" : f.label();
        String dt = f.dataType() == null ? "" : f.dataType().toUpperCase(Locale.ROOT);
        if (n.contains("expire") || n.contains("fail") || l.contains("失效")) return false;
        if (n.equals("day") || n.equals("month") || l.contains("日期") || l.contains("月份")
                || l.contains("时间") || n.contains("createtime") || n.contains("paysucc")
                || n.endsWith("time")) {
            return true;
        }
        return dt.contains("DATE") || dt.contains("TIME") || dt.contains("TIMESTAMP");
    }

    private static int dimScore(DatasetFieldVO f) {
        if (f == null || f.name() == null) return -100;
        String n = f.name().toLowerCase(Locale.ROOT);
        String l = f.label() == null ? "" : f.label();
        int score = 10;
        if (n.contains("status") || l.contains("状态")) score += 50;
        if (n.contains("region") || l.contains("区域")) score += 40;
        if (n.contains("channel") || l.contains("渠道")) score += 30;
        if (n.contains("product") || l.contains("产品")) score += 25;
        if (FieldSemantics.isBusinessEntityId(f)) score += 45;
        else if (n.endsWith("id") || n.contains("appid")) score -= 40;
        return score;
    }

    private static int timeScore(DatasetFieldVO f) {
        String n = f.name().toLowerCase(Locale.ROOT);
        if (n.contains("create")) return 40;
        if (n.equals("day") || n.equals("month")) return 30;
        if (n.contains("paysucc")) return 10;
        if (n.contains("update")) return 5;
        return 1;
    }

    private static boolean isStatusLike(DatasetFieldVO f) {
        if (f == null || f.name() == null) return false;
        String n = f.name().toLowerCase(Locale.ROOT);
        String l = f.label() == null ? "" : f.label();
        return n.contains("status") || l.contains("状态") || n.contains("channeltype")
                || l.contains("渠道类型") || (n.contains("type") && l.contains("类型"));
    }

    private static int measureScore(DatasetFieldVO f) {
        if (f == null || f.name() == null) return -100;
        String n = f.name().toLowerCase(Locale.ROOT);
        String l = f.label() == null ? "" : f.label();
        int score = "quota".equalsIgnoreCase(f.group()) ? 10 : -20;
        if (n.contains("amount") || l.contains("金额") || l.contains("销售额")) score += 80;
        if (n.contains("income") || l.contains("入账") || l.contains("收入")) score += 70;
        if (n.contains("profit") || l.contains("利润")) score += 65;
        if (n.contains("qty") || l.contains("数量") || l.contains("销量")) score += 50;
        if (n.contains("rate") || l.contains("率")) score += 15;
        if (n.endsWith("id") || n.contains("status") || l.contains("状态")) score -= 80;
        return score;
    }

    private static DatasetFieldVO pickMeasure(List<DatasetFieldVO> measures) {
        if (measures == null || measures.isEmpty()) return null;
        return measures.stream()
                .max((a, b) -> Integer.compare(measureScore(a), measureScore(b)))
                .filter(f -> measureScore(f) >= 20)
                .orElse(measures.getFirst());
    }

    private static String suggestedAgg(DatasetFieldVO f) {
        String n = f.name().toLowerCase(Locale.ROOT);
        String l = f.label() == null ? "" : f.label();
        if (n.contains("rate") || l.contains("率")) return "AVG";
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
