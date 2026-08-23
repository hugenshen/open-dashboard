package io.opendashboard.application.conversation;

import io.opendashboard.domain.DatasetDtos.DatasetDetailVO;
import io.opendashboard.domain.DatasetDtos.DatasetFieldVO;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * NL → intent cards by matching the user text to schema field name/label
 * (glossary aliases already folded into labels). No business-word dictionaries.
 */
public final class IntentResolver {

    private IntentResolver() {}

    public record TimeFilter(String field, String label, String phrase, int n, String unit) {
        Map<String, Object> toFilterAst() {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("field", field);
            item.put("op", "last");
            item.put("n", n);
            item.put("unit", unit);
            Map<String, Object> root = new LinkedHashMap<>();
            root.put("items", List.of(item));
            return root;
        }
    }

    public record Mapping(String phrase, String kind, String field, String label, String note) {}

    public record Unresolved(String phrase, String reason) {}

    public record Card(
            String title,
            String chartType,
            String dimension,
            String dimLabel,
            String measure,
            String measureLabel,
            String agg,
            String fromPhrase
    ) {}

    public record Plan(
            String datasetId,
            String datasetName,
            String rewrite,
            TimeFilter time,
            List<Card> cards,
            List<Mapping> mapping,
            List<Unresolved> unresolved
    ) {
        public boolean needsClarify() {
            return unresolved != null && !unresolved.isEmpty();
        }

        public Card primaryChart() {
            if (cards == null || cards.isEmpty()) return null;
            for (Card c : cards) {
                if ("bar".equals(c.chartType()) || "line".equals(c.chartType())) return c;
            }
            return cards.getFirst();
        }

        public Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("datasetId", datasetId);
            m.put("datasetName", datasetName);
            m.put("rewrite", rewrite == null ? "" : rewrite);
            if (time != null) {
                Map<String, Object> t = new LinkedHashMap<>();
                t.put("field", time.field());
                t.put("label", time.label());
                t.put("phrase", time.phrase());
                t.put("n", time.n());
                t.put("unit", time.unit());
                m.put("time", t);
                m.put("filters", time.toFilterAst());
            } else {
                m.put("filters", Map.of("items", List.of()));
            }
            List<Map<String, Object>> cardMaps = new ArrayList<>();
            if (cards != null) {
                for (Card c : cards) {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("title", c.title());
                    row.put("chartType", c.chartType());
                    row.put("dimension", c.dimension());
                    row.put("dimLabel", c.dimLabel());
                    row.put("measure", c.measure());
                    row.put("measureLabel", c.measureLabel());
                    row.put("agg", c.agg());
                    row.put("fromPhrase", c.fromPhrase());
                    cardMaps.add(row);
                }
            }
            m.put("cards", cardMaps);
            List<Map<String, Object>> maps = new ArrayList<>();
            if (mapping != null) {
                for (Mapping x : mapping) {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("phrase", x.phrase());
                    row.put("kind", x.kind());
                    row.put("field", x.field());
                    row.put("label", x.label());
                    if (x.note() != null && !x.note().isBlank()) row.put("note", x.note());
                    maps.add(row);
                }
            }
            m.put("mapping", maps);
            List<Map<String, Object>> miss = new ArrayList<>();
            if (unresolved != null) {
                for (Unresolved u : unresolved) {
                    miss.add(Map.of("phrase", u.phrase(), "reason", u.reason()));
                }
            }
            m.put("unresolved", miss);
            m.put("ok", miss.isEmpty() && !cardMaps.isEmpty());
            return m;
        }
    }

    private static final Pattern LAST_YEAR = Pattern.compile("近一?年|最近一?年|过去一?年|近1年");
    private static final Pattern LAST_MONTH = Pattern.compile("近一?个?月|最近一?个?月|近30天");
    private static final Pattern LAST_WEEK = Pattern.compile("近一?周|最近7天|近7天");

    public static Plan resolve(String message, SchemaGuard.SchemaBundle schema) {
        String q = message == null ? "" : message.trim();
        if (schema == null || schema.byId().isEmpty()) {
            return new Plan("", "", q, null, List.of(), List.of(),
                    List.of(new Unresolved("数据集", "未绑定可用数据集")));
        }
        String datasetId = pickDataset(q, schema);
        DatasetDetailVO detail = schema.byId().get(datasetId);
        String dsName = detail != null && detail.meta() != null ? detail.meta().name() : datasetId;

        List<Mapping> mapping = new ArrayList<>();
        List<Unresolved> unresolved = new ArrayList<>();
        TimeFilter time = resolveTime(q, detail, mapping, unresolved);

        List<DatasetFieldVO> hitMeasures = new ArrayList<>();
        List<DatasetFieldVO> hitDims = new ArrayList<>();
        if (detail != null && detail.fields() != null) {
            for (DatasetFieldVO f : detail.fields()) {
                String phrase = mentioned(q, f);
                if (phrase == null) continue;
                String role = DatasetProfiler.roleOf(f);
                mapping.add(new Mapping(phrase, role, f.name(), display(f), null));
                switch (role) {
                    case "measure" -> hitMeasures.add(f);
                    case "dim" -> hitDims.add(f);
                    default -> {
                    }
                }
            }
        }

        DatasetFieldVO primaryMeasure = !hitMeasures.isEmpty()
                ? hitMeasures.getFirst()
                : firstOf(detail, "measure");
        if (hitDims.isEmpty() && hitMeasures.isEmpty()) {
            DatasetFieldVO dim = firstOf(detail, "dim");
            List<Card> fallback = new ArrayList<>();
            if (primaryMeasure != null && dim != null) {
                fallback.add(new Card(
                        display(dim) + " · " + display(primaryMeasure),
                        "bar",
                        dim.name(), display(dim),
                        primaryMeasure.name(), display(primaryMeasure),
                        "SUM",
                        q
                ));
            } else if (primaryMeasure != null) {
                fallback.add(new Card(
                        display(primaryMeasure), "kpi", null, null,
                        primaryMeasure.name(), display(primaryMeasure), "SUM", q
                ));
            }
            return new Plan(datasetId, dsName, buildRewrite(dsName, time, fallback), time, fallback, mapping, unresolved);
        }

        List<Card> cards = new ArrayList<>();
        for (DatasetFieldVO m : hitMeasures) {
            cards.add(new Card(display(m), "kpi", null, null, m.name(), display(m), "SUM", display(m)));
        }
        List<DatasetFieldVO> dims = !hitDims.isEmpty() ? hitDims : listOf(firstOf(detail, "dim"));
        if (primaryMeasure != null) {
            for (DatasetFieldVO d : dims) {
                if (d == null) continue;
                cards.add(new Card(
                        display(d) + " · " + display(primaryMeasure),
                        "bar",
                        d.name(), display(d),
                        primaryMeasure.name(), display(primaryMeasure),
                        "SUM",
                        display(d)
                ));
            }
        }
        return new Plan(datasetId, dsName, buildRewrite(dsName, time, cards), time, cards, mapping, unresolved);
    }

    public static Map<String, Object> encodeOf(Card card, String datasetId, TimeFilter time) {
        Map<String, Object> encode = new LinkedHashMap<>();
        encode.put("datasetId", datasetId);
        if (card.dimension() != null && !card.dimension().isBlank()) {
            encode.put("category", card.dimension());
        }
        encode.put("value", card.measure());
        encode.put("agg", card.agg() == null ? "SUM" : card.agg());
        if (time != null) {
            encode.put("filters", time.toFilterAst());
        }
        return encode;
    }

    private static TimeFilter resolveTime(String q, DatasetDetailVO detail, List<Mapping> mapping, List<Unresolved> unresolved) {
        String phrase = null;
        int n = 1;
        String unit = "year";
        if (LAST_YEAR.matcher(q).find()) {
            phrase = "近一年";
            n = 1;
            unit = "year";
        } else if (LAST_MONTH.matcher(q).find()) {
            phrase = "近一个月";
            n = 1;
            unit = "month";
        } else if (LAST_WEEK.matcher(q).find()) {
            phrase = "近一周";
            n = 7;
            unit = "day";
        }
        if (phrase == null) return null;
        DatasetFieldVO timeField = firstOf(detail, "time");
        if (timeField == null) {
            unresolved.add(new Unresolved(phrase, "数据集没有可用的时间字段，无法过滤" + phrase));
            return null;
        }
        mapping.add(new Mapping(phrase, "filter", timeField.name(), display(timeField), null));
        return new TimeFilter(timeField.name(), display(timeField), phrase, n, unit);
    }

    private static String mentioned(String q, DatasetFieldVO f) {
        if (q == null || q.isBlank() || f == null) return null;
        String label = display(f);
        if (!label.isBlank() && q.contains(label)) return label;
        String name = f.name() == null ? "" : f.name();
        if (!name.isBlank() && q.toLowerCase(Locale.ROOT).contains(name.toLowerCase(Locale.ROOT))) {
            return name;
        }
        return null;
    }

    private static String buildRewrite(String dsName, TimeFilter time, List<Card> cards) {
        StringBuilder sb = new StringBuilder("基于「").append(dsName == null ? "数据集" : dsName).append("」");
        if (time != null) sb.append("，限定").append(time.phrase());
        if (cards != null && !cards.isEmpty()) {
            sb.append("：");
            for (int i = 0; i < cards.size(); i++) {
                if (i > 0) sb.append("；");
                Card c = cards.get(i);
                if ("kpi".equals(c.chartType())) {
                    sb.append("汇总").append(c.measureLabel());
                } else {
                    sb.append("按").append(c.dimLabel()).append("看").append(c.measureLabel());
                }
            }
        }
        return sb.toString();
    }

    private static String pickDataset(String q, SchemaGuard.SchemaBundle schema) {
        return schema.byId().entrySet().stream()
                .max(Comparator.comparingInt(e -> overlapScore(q, e.getValue())))
                .map(Map.Entry::getKey)
                .orElseGet(() -> schema.byId().keySet().iterator().next());
    }

    private static int overlapScore(String q, DatasetDetailVO detail) {
        int score = 0;
        String name = detail.meta() != null && detail.meta().name() != null ? detail.meta().name() : "";
        String table = detail.meta() != null && detail.meta().tableName() != null ? detail.meta().tableName() : "";
        if (!q.isBlank() && !name.isBlank() && q.contains(name)) score += 50;
        if (!q.isBlank() && !table.isBlank() && q.toLowerCase(Locale.ROOT).contains(table.toLowerCase(Locale.ROOT))) {
            score += 40;
        }
        if (detail.fields() != null) {
            for (DatasetFieldVO f : detail.fields()) {
                if (mentioned(q, f) != null) score += 10;
            }
        }
        return score;
    }

    private static DatasetFieldVO firstOf(DatasetDetailVO detail, String role) {
        if (detail == null || detail.fields() == null) return null;
        for (DatasetFieldVO f : detail.fields()) {
            if (role.equals(DatasetProfiler.roleOf(f))) return f;
        }
        return null;
    }

    private static List<DatasetFieldVO> listOf(DatasetFieldVO f) {
        return f == null ? List.of() : List.of(f);
    }

    private static String display(DatasetFieldVO f) {
        if (f == null) return "";
        String raw = f.label() == null || f.label().isBlank() ? nz(f.name()) : f.label();
        String normalized = raw.replace('，', ',');
        int comma = normalized.indexOf(',');
        if (comma > 0) {
            String head = normalized.substring(0, comma).trim();
            if (!head.isBlank()) return head;
        }
        return raw;
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }
}
