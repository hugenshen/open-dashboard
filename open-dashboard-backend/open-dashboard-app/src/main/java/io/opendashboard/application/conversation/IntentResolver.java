package io.opendashboard.application.conversation;

import io.opendashboard.domain.DatasetDtos.DatasetDetailVO;
import io.opendashboard.domain.DatasetDtos.DatasetFieldVO;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Deterministic NL → intent cards (DataEase-style: no model SQL).
 * Maps phrases onto schema fields; missing required phrases become clarify.
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
        List<Card> cards = new ArrayList<>();

        TimeFilter time = resolveTime(q, detail, mapping, unresolved);
        FieldHit income = findMeasure(detail, q, List.of("收入", "销售额", "营收", "gmv", "amount", "income", "订单收入"));
        FieldHit profit = findMeasure(detail, q, List.of("利润", "profit", "毛利"));
        FieldHit merchant = findDim(detail, q, List.of("商户", "商家", "门店", "merchant", "mch", "shop", "store"));
        FieldHit region = findDim(detail, q, List.of("区域", "地区", "region"));
        FieldHit channel = findDim(detail, q, List.of("渠道", "channel"));

        boolean askedIncome = containsAny(q, "收入", "销售额", "营收", "gmv", "订单收入");
        boolean askedProfit = containsAny(q, "利润", "毛利");
        boolean askedMerchant = containsAny(q, "商户", "商家", "门店");
        boolean askedRegion = containsAny(q, "区域", "地区");
        boolean askedChannel = containsAny(q, "渠道");
        boolean askedPlatform = q.contains("平台");

        if (askedMerchant) bindOrMiss(merchant, "商户", "dim", mapping, unresolved, "数据集没有商户/商家类维度");
        if (askedRegion) bindOrMiss(region, "区域", "dim", mapping, unresolved, "数据集没有区域维度");
        if (askedChannel) bindOrMiss(channel, "渠道", "dim", mapping, unresolved, "数据集没有渠道维度");
        if (askedIncome) bindOrMiss(income, askedPlatform && q.contains("平台") ? "收入" : "收入", "measure", mapping, unresolved, "数据集没有收入/销售额类指标");
        if (askedProfit) {
            FieldHit platformProfit = askedPlatform ? findMeasure(detail, q, List.of("平台利润", "platform_profit", "platformprofit")) : null;
            if (platformProfit != null && platformProfit.field != null) {
                bindOrMiss(platformProfit, "平台利润", "measure", mapping, unresolved, "");
                profit = platformProfit;
            } else {
                bindOrMiss(profit, "利润", "measure", mapping, unresolved, "数据集没有利润类指标");
                if (askedPlatform && profit != null && profit.field != null) {
                    mapping.add(new Mapping("平台利润", "measure", profit.field, profit.label, "未找到平台专用字段，使用表内利润"));
                }
            }
        }

        FieldHit primaryMeasure = income != null && income.field != null ? income : profit;
        if (primaryMeasure == null || primaryMeasure.field == null) {
            primaryMeasure = bestMeasure(detail);
        }

        if (askedMerchant && merchant != null && merchant.field != null && primaryMeasure != null && primaryMeasure.field != null) {
            cards.add(new Card(
                    merchant.label + " · " + primaryMeasure.label,
                    "bar",
                    merchant.field, merchant.label,
                    primaryMeasure.field, primaryMeasure.label,
                    "SUM",
                    "各" + merchant.label
            ));
        }
        if (askedRegion && region != null && region.field != null && primaryMeasure != null && primaryMeasure.field != null
                && cards.stream().noneMatch(c -> region.field.equals(c.dimension()))) {
            cards.add(new Card(
                    region.label + " · " + primaryMeasure.label,
                    "bar",
                    region.field, region.label,
                    primaryMeasure.field, primaryMeasure.label,
                    "SUM",
                    "各" + region.label
            ));
        }
        if (askedChannel && channel != null && channel.field != null && primaryMeasure != null && primaryMeasure.field != null
                && cards.stream().noneMatch(c -> channel.field.equals(c.dimension()))) {
            cards.add(new Card(
                    channel.label + " · " + primaryMeasure.label,
                    "bar",
                    channel.field, channel.label,
                    primaryMeasure.field, primaryMeasure.label,
                    "SUM",
                    "各" + channel.label
            ));
        }
        if (askedIncome && income != null && income.field != null) {
            cards.add(0, new Card("订单收入", "kpi", null, null, income.field, income.label, "SUM", "收入"));
        }
        if (askedProfit && profit != null && profit.field != null) {
            cards.add(new Card(profit.label, "kpi", null, null, profit.field, profit.label, "SUM", "利润"));
        }
        if (cards.isEmpty() && primaryMeasure != null && primaryMeasure.field != null) {
            FieldHit dim = firstDim(detail, merchant, region, channel);
            if (dim != null && dim.field != null) {
                cards.add(new Card(
                        dim.label + " · " + primaryMeasure.label,
                        "bar",
                        dim.field, dim.label,
                        primaryMeasure.field, primaryMeasure.label,
                        "SUM",
                        q
                ));
            } else {
                cards.add(new Card(primaryMeasure.label, "kpi", null, null, primaryMeasure.field, primaryMeasure.label, "SUM", q));
            }
        }

        String rewrite = buildRewrite(dsName, time, cards);
        return new Plan(datasetId, dsName, rewrite, time, cards, mapping, unresolved);
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

    private static void bindOrMiss(
            FieldHit hit, String phrase, String kind,
            List<Mapping> mapping, List<Unresolved> unresolved, String missReason
    ) {
        if (hit != null && hit.field != null) {
            mapping.add(new Mapping(phrase, kind, hit.field, hit.label, hit.note));
        } else if (missReason != null && !missReason.isBlank()) {
            unresolved.add(new Unresolved(phrase, missReason));
        }
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
        DatasetFieldVO timeField = pickTime(detail);
        if (timeField == null) {
            unresolved.add(new Unresolved(phrase, "数据集没有可用的时间字段，无法过滤" + phrase));
            return null;
        }
        String label = display(timeField);
        mapping.add(new Mapping(phrase, "filter", timeField.name(), label, "相对时间过滤将写入 SQL WHERE"));
        return new TimeFilter(timeField.name(), label, phrase, n, unit);
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
        String best = schema.byId().keySet().iterator().next();
        int bestScore = Integer.MIN_VALUE;
        for (Map.Entry<String, DatasetDetailVO> e : schema.byId().entrySet()) {
            int score = scoreDataset(q, e.getValue());
            if (score > bestScore) {
                bestScore = score;
                best = e.getKey();
            }
        }
        return best;
    }

    private static int scoreDataset(String q, DatasetDetailVO detail) {
        int score = 0;
        String name = detail.meta() != null && detail.meta().name() != null ? detail.meta().name() : "";
        String table = detail.meta() != null && detail.meta().tableName() != null ? detail.meta().tableName() : "";
        String blob = (name + " " + table).toLowerCase(Locale.ROOT);
        if (q.contains("订单") && (name.contains("订单") || blob.contains("order"))) score += 40;
        if (q.contains("销售") && (name.contains("销售") || blob.contains("sales"))) score += 30;
        if (detail.fields() == null) return score;
        for (DatasetFieldVO f : detail.fields()) {
            String n = nz(f.name()).toLowerCase(Locale.ROOT);
            String l = nz(f.label());
            if (q.contains("商户") && (n.contains("mch") || n.contains("merchant") || l.contains("商户"))) score += 12;
            if (q.contains("收入") && (n.contains("income") || n.contains("amount") || l.contains("收入") || l.contains("金额"))) {
                score += 10;
            }
            if (q.contains("利润") && (n.contains("profit") || l.contains("利润"))) score += 10;
        }
        return score;
    }

    private record FieldHit(String field, String label, String note) {}

    private static FieldHit findMeasure(DatasetDetailVO detail, String q, List<String> keys) {
        return findField(detail, keys, true);
    }

    private static FieldHit findDim(DatasetDetailVO detail, String q, List<String> keys) {
        return findField(detail, keys, false);
    }

    private static FieldHit findField(DatasetDetailVO detail, List<String> keys, boolean measure) {
        if (detail == null || detail.fields() == null) return null;
        DatasetFieldVO best = null;
        int bestScore = 0;
        for (DatasetFieldVO f : detail.fields()) {
            if (measure && !"quota".equalsIgnoreCase(f.group()) && !looksMeasure(f)) continue;
            if (!measure && "quota".equalsIgnoreCase(f.group()) && !looksDim(f)) continue;
            int score = 0;
            String n = nz(f.name()).toLowerCase(Locale.ROOT);
            String l = nz(f.label());
            for (String k : keys) {
                String kk = k.toLowerCase(Locale.ROOT);
                if (n.equals(kk) || l.equals(k)) score += 80;
                else if (n.contains(kk) || l.contains(k)) score += 40;
            }
            if (score > bestScore) {
                bestScore = score;
                best = f;
            }
        }
        if (best == null || bestScore < 20) return null;
        return new FieldHit(best.name(), display(best), null);
    }

    private static FieldHit bestMeasure(DatasetDetailVO detail) {
        if (detail == null || detail.fields() == null) return null;
        DatasetFieldVO best = null;
        int bestScore = -1;
        for (DatasetFieldVO f : detail.fields()) {
            int s = 0;
            String n = nz(f.name()).toLowerCase(Locale.ROOT);
            String l = nz(f.label());
            if ("quota".equalsIgnoreCase(f.group())) s += 10;
            if (n.contains("amount") || l.contains("金额") || l.contains("收入") || l.contains("销售额")) s += 50;
            if (n.contains("income")) s += 40;
            if (n.contains("profit") || l.contains("利润")) s += 30;
            if (s > bestScore) {
                bestScore = s;
                best = f;
            }
        }
        return best == null ? null : new FieldHit(best.name(), display(best), null);
    }

    private static FieldHit firstDim(DatasetDetailVO detail, FieldHit... preferred) {
        for (FieldHit h : preferred) {
            if (h != null && h.field != null) return h;
        }
        if (detail == null || detail.fields() == null) return null;
        for (DatasetFieldVO f : detail.fields()) {
            if ("dim".equalsIgnoreCase(f.group()) && looksDim(f)) {
                return new FieldHit(f.name(), display(f), null);
            }
        }
        return null;
    }

    private static DatasetFieldVO pickTime(DatasetDetailVO detail) {
        if (detail == null || detail.fields() == null) return null;
        DatasetFieldVO best = null;
        int bestScore = -1;
        for (DatasetFieldVO f : detail.fields()) {
            if (!isTimeField(f)) continue;
            int s = 1;
            String n = nz(f.name()).toLowerCase(Locale.ROOT);
            if (n.contains("create")) s += 25;
            if (n.contains("order") || n.contains("pay")) s += 15;
            if (n.contains("update") || n.contains("expire")) s -= 10;
            if (s > bestScore) {
                bestScore = s;
                best = f;
            }
        }
        return best;
    }

    private static boolean isTimeField(DatasetFieldVO f) {
        String n = nz(f.name()).toLowerCase(Locale.ROOT);
        String l = nz(f.label());
        String dt = nz(f.dataType()).toUpperCase(Locale.ROOT);
        if (n.contains("expire") || l.contains("失效")) return false;
        return n.contains("time") || n.contains("date") || n.equals("day") || n.equals("month")
                || l.contains("日期") || l.contains("时间") || l.contains("月份")
                || dt.contains("DATE") || dt.contains("TIME") || dt.contains("TIMESTAMP");
    }

    private static boolean looksMeasure(DatasetFieldVO f) {
        String n = nz(f.name()).toLowerCase(Locale.ROOT);
        String l = nz(f.label());
        return n.contains("amount") || n.contains("income") || n.contains("profit") || n.contains("qty")
                || l.contains("金额") || l.contains("收入") || l.contains("利润") || l.contains("销售额");
    }

    private static boolean looksDim(DatasetFieldVO f) {
        return FieldSemantics.looksDim(f);
    }

    private static boolean containsAny(String q, String... keys) {
        for (String k : keys) {
            if (q.toLowerCase(Locale.ROOT).contains(k.toLowerCase(Locale.ROOT))) return true;
        }
        return false;
    }

    private static String display(DatasetFieldVO f) {
        if (f.label() != null && !f.label().isBlank()) return f.label();
        return f.name();
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }
}
