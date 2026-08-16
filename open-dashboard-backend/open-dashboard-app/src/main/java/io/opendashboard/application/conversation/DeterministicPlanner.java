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
 * Schema-aware board planner: pick the strongest business dataset/fields,
 * use human labels, avoid meta/test junk (name_len / de_* studio tables).
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

        List<FieldRef> measures = pickMeasures(detail, q, 3);
        List<FieldRef> dims = pickCatDims(detail, q, 3);
        FieldRef time = pickTimeDim(detail);

        long base = SEQ.addAndGet(40);
        List<Map<String, Object>> ops = new ArrayList<>();
        ops.add(DashboardPatch.setLayout(72, "default"));
        ops.add(DashboardPatch.setTheme(styleId == null || styleId.isBlank() ? "feishu-blue" : styleId));

        FieldRef countKey = !dims.isEmpty() ? dims.getFirst() : firstUsableField(detail);
        if (countKey == null && measures.isEmpty()) {
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
        for (FieldRef m : measures) {
            if (kpis.size() >= 4) break;
            kpis.add(new ChartSpec(
                    String.valueOf(base + seq++), "kpi", m.display(),
                    encodeKpi(datasetId, m.name(), suggestedAgg(m))
            ));
        }

        FieldRef primaryMeasure = measures.isEmpty() ? null : measures.getFirst();
        FieldRef amountLike = measures.stream()
                .filter(m -> {
                    String n = m.name().toLowerCase(Locale.ROOT);
                    String l = m.display();
                    return n.contains("amount") || l.contains("金额") || l.contains("销售额") || n.contains("income");
                })
                .filter(m -> {
                    String n = m.name().toLowerCase(Locale.ROOT);
                    return !n.contains("mchincome") && !n.contains("mch_income");
                })
                .findFirst()
                .orElse(null);
        final FieldRef plotMeasure = amountLike != null ? amountLike : primaryMeasure;
        String valueField = plotMeasure != null
                ? plotMeasure.name()
                : (countKey != null ? countKey.name() : null);
        String agg = plotMeasure != null ? suggestedAgg(plotMeasure) : "COUNT";
        String valueLabel = plotMeasure != null ? plotMeasure.display() : "记录数";

        if (valueField != null && !dims.isEmpty()) {
            FieldRef d0 = dims.getFirst();
            plots.add(new ChartSpec(
                    String.valueOf(base + seq++), "bar",
                    d0.display() + " · " + valueLabel,
                    encodeCat(datasetId, d0.name(), valueField, agg)
            ));
            FieldRef pieDim = dims.size() > 1 ? dims.get(1) : d0;
            plots.add(new ChartSpec(
                    String.valueOf(base + seq++), "pie",
                    pieDim.display() + " 构成",
                    encodeCat(datasetId, pieDim.name(), valueField, agg)
            ));
            if (time != null) {
                plots.add(new ChartSpec(
                        String.valueOf(base + seq++), "line",
                        time.display() + "走势 · " + valueLabel,
                        encodeCat(datasetId, time.name(), valueField, agg)
                ));
            } else if (dims.size() > 2) {
                FieldRef d2 = dims.get(2);
                plots.add(new ChartSpec(
                        String.valueOf(base + seq++), "bar",
                        d2.display() + " · " + valueLabel,
                        encodeCat(datasetId, d2.name(), valueField, agg)
                ));
            }
            if (measures.size() > 1) {
                FieldRef m2 = measures.stream()
                        .filter(m -> plotMeasure == null || !m.name().equalsIgnoreCase(plotMeasure.name()))
                        .findFirst()
                        .orElse(null);
                if (m2 != null) {
                    plots.add(new ChartSpec(
                            String.valueOf(base + seq++), "bar",
                            d0.display() + " · " + m2.display(),
                            encodeCat(datasetId, d0.name(), m2.name(), suggestedAgg(m2))
                    ));
                }
            }
        } else if (valueField != null && countKey != null) {
            plots.add(new ChartSpec(
                    String.valueOf(base + seq++), "bar",
                    countKey.display() + " · " + valueLabel,
                    encodeCat(datasetId, countKey.name(), valueField, agg)
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
            ops.add(DashboardPatch.upsertComponent("c_" + c.id(), c.id(), i * kpiW, 0, kpiW, 10));
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
            ops.add(DashboardPatch.upsertComponent("c_" + c.id(), c.id(), x, y, w, 20));
            if (w == 72 || col == 1) {
                y += 22;
                col = 0;
            } else {
                col = 1;
            }
        }
    }

    /** Public title helper for harness SSE / dashboard create. */
    public static String resolveTitle(String message, SchemaGuard.SchemaBundle schema) {
        String datasetId = pickDataset(message == null ? "" : message, schema);
        DatasetDetailVO detail = schema.byId().get(datasetId);
        return boardTitle(message == null ? "" : message, datasetName(detail, datasetId), detail);
    }

    public static String resolveDatasetId(String message, SchemaGuard.SchemaBundle schema) {
        return pickDataset(message == null ? "" : message, schema);
    }

    public static boolean isWeakDataset(DatasetDetailVO detail) {
        if (detail == null || detail.meta() == null) return false;
        return isWeakMeta(
                datasetName(detail, ""),
                detail.meta().tableName() == null ? "" : detail.meta().tableName(),
                detail.meta().folder() == null ? "" : detail.meta().folder()
        );
    }

    public static Map<String, Object> planSummary(DashboardPatch.Patch patch, String message) {
        Map<String, Object> plan = new LinkedHashMap<>();
        plan.put("title", "生成数据分析看板");
        plan.put("summary", message == null ? "" : message);
        List<Map<String, Object>> steps = new ArrayList<>();
        steps.add(Map.of("id", "1", "label", "读取数据集 Schema"));
        steps.add(Map.of("id", "2", "label", "按字段语义规划 KPI / 对比 / 分布"));
        steps.add(Map.of("id", "3", "label", "写入 Dashboard draft"));
        steps.add(Map.of("id", "4", "label", "预览 chartQuery"));
        plan.put("steps", steps);
        plan.put("patch", patch.toMap());
        return plan;
    }

    private record FieldRef(String name, String label, String group, String dataType, String origin, int score) {
        String display() {
            String raw = label == null || label.isBlank() ? name : label;
            // Dataset labels often look like "商户入账,单位分" — keep the business head
            String normalized = raw.replace('，', ',');
            int comma = normalized.indexOf(',');
            if (comma > 0 && comma < normalized.length() - 1) {
                String head = normalized.substring(0, comma).trim();
                if (!head.isBlank()) raw = head;
            }
            int colon = raw.indexOf(':');
            if (colon > 1 && colon < raw.length() - 1) {
                String head = raw.substring(0, colon).trim();
                if (!head.isBlank()) return head;
            }
            return raw;
        }
    }

    private static String pickDataset(String q, SchemaGuard.SchemaBundle schema) {
        return schema.byId().entrySet().stream()
                .max(Comparator.comparingInt(e -> scoreDataset(q, e.getValue())))
                .map(Map.Entry::getKey)
                .orElseGet(() -> schema.byId().keySet().iterator().next());
    }

    private static int scoreDataset(String q, DatasetDetailVO detail) {
        int score = 0;
        String name = datasetName(detail, "");
        String table = detail.meta() != null && detail.meta().tableName() != null
                ? detail.meta().tableName().toLowerCase(Locale.ROOT) : "";
        String folder = detail.meta() != null && detail.meta().folder() != null
                ? detail.meta().folder() : "";

        if (isWeakMeta(name, table, folder)) score -= 120;
        if (table.startsWith("de_")) score -= 60;
        if (name.contains("验证") || name.contains("测试") || folder.contains("测试")) score -= 50;

        if (name.contains("订单") || table.contains("order") || table.contains("pay")) score += 40;
        if (name.contains("代理") || table.contains("agent")) score += 35;
        if (name.contains("销售") || table.contains("sales")) score += 30;
        if (name.contains("财务") || table.contains("fin")) score += 25;
        if (q.contains("订单") && (name.contains("订单") || table.contains("order"))) score += 25;
        if (q.contains("代理") && name.contains("代理")) score += 25;
        if (q.matches("(?s).*(经营|销售|营收).*") && (name.contains("销售") || name.contains("订单"))) score += 20;

        if (detail.fields() != null) {
            for (DatasetFieldVO f : detail.fields()) {
                score += Math.max(0, scoreMeasure(f, q) / 5);
                score += Math.max(0, scoreDim(f, q) / 8);
            }
        }
        return score;
    }

    private static boolean isWeakMeta(String name, String table, String folder) {
        String n = name == null ? "" : name.toLowerCase(Locale.ROOT);
        String t = table == null ? "" : table.toLowerCase(Locale.ROOT);
        String f = folder == null ? "" : folder;
        return t.startsWith("de_")
                || t.contains("dashboard") || t.contains("dashborad")
                || n.contains("dashboard") || n.contains("dashborad")
                || n.contains("工作室")
                || n.contains("拖拽")
                || n.contains("验证")
                || n.contains("清单")
                || n.contains("低能")
                || "测试".equals(f)
                || "测试".equals(folder);
    }

    private static List<FieldRef> pickMeasures(DatasetDetailVO detail, String q, int limit) {
        if (detail == null || detail.fields() == null) return List.of();
        return detail.fields().stream()
                .filter(f -> !isJunkMeasure(f))
                .map(f -> toRef(f, scoreMeasure(f, q)))
                .filter(f -> f.score() >= 25)
                .sorted(Comparator.comparingInt(FieldRef::score).reversed())
                .limit(limit)
                .toList();
    }

    private static List<FieldRef> pickCatDims(DatasetDetailVO detail, String q, int limit) {
        if (detail == null || detail.fields() == null) return List.of();
        return detail.fields().stream()
                .filter(f -> !isJunkDim(f) && !isTimeField(f))
                .map(f -> toRef(f, scoreDim(f, q)))
                .filter(f -> f.score() > 15)
                .sorted(Comparator.comparingInt(FieldRef::score).reversed())
                .limit(limit)
                .toList();
    }

    private static FieldRef pickTimeDim(DatasetDetailVO detail) {
        if (detail == null || detail.fields() == null) return null;
        return detail.fields().stream()
                .filter(DeterministicPlanner::isTimeField)
                .filter(f -> !isJunkDim(f))
                .map(f -> toRef(f, scoreDim(f, "")))
                .max(Comparator.comparingInt(FieldRef::score))
                .orElse(null);
    }

    private static boolean isTimeField(DatasetFieldVO f) {
        if (f == null || f.name() == null) return false;
        String n = f.name().toLowerCase(Locale.ROOT);
        String l = f.label() == null ? "" : f.label();
        if (n.contains("expire") || n.contains("fail") || l.contains("失效")) return false;
        return n.equals("day") || n.equals("month") || l.contains("日期") || l.contains("月份");
    }

    private static boolean isJunkDim(DatasetFieldVO f) {
        if (f == null || f.name() == null) return true;
        String n = f.name().toLowerCase(Locale.ROOT);
        String l = f.label() == null ? "" : f.label();
        return n.contains("url") || n.contains("msg") || n.contains("extra")
                || n.contains("param") || n.contains("email") || n.contains("ip")
                || n.contains("safekey") || l.contains("密钥") || l.contains("秘钥")
                || n.equals("body") || n.equals("subject")
                || n.contains("attach") || n.contains("notify")
                || n.contains("accountno") || n.contains("player")
                || n.contains("orderno") || n.contains("order_no")
                || (n.contains("order") && (n.contains("id") || n.endsWith("no")))
                || n.contains("errcode") || n.contains("errmsg");
    }

    private static boolean isJunkMeasure(DatasetFieldVO f) {
        if (f == null || f.name() == null) return true;
        String n = f.name().toLowerCase(Locale.ROOT);
        String l = f.label() == null ? "" : f.label();
        return n.endsWith("_len") || n.contains("length") || l.contains("长度")
                || n.equals("id") || n.equals("uuid") || n.equals("pid")
                || n.equals("version") || n.equals("content_id")
                || n.endsWith("_time") || n.contains("createtime") || n.contains("updatetime");
    }

    private static int scoreMeasure(DatasetFieldVO f, String q) {
        if (f == null || f.name() == null) return -100;
        String n = f.name().toLowerCase(Locale.ROOT);
        String l = f.label() == null ? "" : f.label();
        int score = "quota".equalsIgnoreCase(f.group()) ? 10 : -20;
        if ("calc".equalsIgnoreCase(f.origin()) || n.endsWith("_len") || n.contains("length")) score -= 60;
        if (n.equals("id") || n.endsWith("id") && !n.contains("income") && !n.contains("mch")) {
            // IDs are poor measures (except income-like)
            if (!(l.contains("收入") || l.contains("金额") || l.contains("余额"))) score -= 40;
        }
        if (n.contains("income") || l.contains("收入") || l.contains("入账")) score += 80;
        if (n.contains("amount") || l.contains("金额") || l.contains("销售额")) score += 75;
        if (n.contains("balance") || l.contains("余额")) score += 70;
        if (n.contains("profit") || l.contains("利润") || l.contains("收益")) score += 70;
        if (n.contains("expend") || l.contains("支出")) score += 55;
        if (n.contains("qty") || n.contains("count") || l.contains("数量") || l.contains("笔")) score += 45;
        if (l.codePoints().anyMatch(Character::isIdeographic)) score += 8;
        if (n.contains("rate") || l.contains("费率") || l.contains("率")) score += 25;
        if (n.contains("status") || l.contains("状态")) score -= 90;
        if (n.equals("version") || n.equals("pid") || n.endsWith("_time")) score -= 80;
        if (n.contains("name_len") || l.contains("长度")) score -= 100;
        if (q.contains("收入") && (l.contains("收入") || n.contains("income"))) score += 30;
        if (q.contains("余额") && (l.contains("余额") || n.contains("balance"))) score += 30;
        if (q.contains("订单") && (n.contains("income") || l.contains("入账"))) score += 20;
        return score;
    }

    private static int scoreDim(DatasetFieldVO f, String q) {
        if (f == null || f.name() == null) return -100;
        String n = f.name().toLowerCase(Locale.ROOT);
        String l = f.label() == null ? "" : f.label();
        String dt = f.dataType() == null ? "" : f.dataType().toUpperCase(Locale.ROOT);
        boolean looksCat = n.contains("status") || l.contains("状态") || l.contains("类型")
                || n.contains("type") || n.contains("level") || l.contains("等级");
        // Mis-tagged quota fields (e.g. Status) can still be good dims
        int score = "dim".equalsIgnoreCase(f.group()) || looksCat ? 10 : -15;
        if (n.equals("id") || n.equals("uuid")) score -= 25;
        if ((n.endsWith("id") || l.contains("ID") || l.contains("编号")) && !looksCat) score -= 20;
        if (n.contains("mch") || l.contains("商户")) {
            if (n.contains("type")) {
                /* 商户类型 already scored via looksCat */
            } else if (FieldSemantics.isBusinessEntityId(f) || !n.endsWith("id")) {
                score += 55;
            }
        }
        if (n.contains("app") || l.contains("应用")) {
            if (!n.endsWith("id")) score += 55;
        }
        if (n.contains("agent") || l.contains("代理")) score += 50;
        if (n.contains("region") || l.contains("区域")) score += 70;
        if ((n.contains("channel") || l.contains("渠道")) && !n.contains("type") && !n.contains("id") && !l.contains("类型")) {
            score += 65;
        }
        if (n.contains("way") || n.contains("if_type") || l.contains("接口") || l.contains("类型")) score += 60;
        if (n.contains("status") || l.contains("状态")) score += 120;
        if (n.contains("level") || l.contains("等级")) score += 70;
        if (dt.contains("TIME") || dt.contains("DATE")
                || n.contains("month") || n.contains("day")
                || l.contains("月") || l.contains("日期") || l.contains("时间")) {
            // Prefer categorical dims for default board; time is secondary
            score += 28;
        }
        if (n.equals("name") || l.equals("名称") || l.contains("名称")) score += 40;
        if (n.contains("order") && n.contains("id")) score -= 15;
        if (n.contains("safekey") || l.contains("秘钥") || l.contains("密钥")) score -= 80;
        if (l.contains("代码") || l.contains("标识") || n.contains("openid")) score -= 45;
        if (q.contains("商户") && (n.contains("mch") || l.contains("商户"))) score += 25;
        return score;
    }

    private static FieldRef toRef(DatasetFieldVO f, int score) {
        return new FieldRef(f.name(), f.label(), f.group(), f.dataType(), f.origin(), score);
    }

    private static FieldRef firstUsableField(DatasetDetailVO detail) {
        if (detail == null || detail.fields() == null || detail.fields().isEmpty()) return null;
        return detail.fields().stream()
                .filter(f -> !isJunkMeasure(f))
                .map(f -> toRef(f, 0))
                .findFirst()
                .orElseGet(() -> toRef(detail.fields().getFirst(), 0));
    }

    private static String suggestedAgg(FieldRef measure) {
        if (measure == null) return "SUM";
        String n = measure.name().toLowerCase(Locale.ROOT);
        String l = measure.display();
        if (n.contains("rate") || l.contains("率") || l.contains("费率")) return "AVG";
        if (n.contains("id") && !n.contains("income") && !l.contains("金额") && !l.contains("收入")) return "COUNT";
        return "SUM";
    }

    private static String boardTitle(String q, String dsName, DatasetDetailVO detail) {
        if (q.matches("(?s).*(经营分析|经营看板).*") && !isWeakMeta(dsName,
                detail.meta() != null ? detail.meta().tableName() : "",
                detail.meta() != null ? detail.meta().folder() : "")) {
            return "企业经营分析";
        }
        if (dsName.contains("订单")) return "订单分析";
        if (dsName.contains("代理")) return "代理商分析";
        if (dsName.contains("销售")) return "销售分析";
        if (isWeakMeta(dsName,
                detail.meta() != null ? detail.meta().tableName() : "",
                detail.meta() != null ? detail.meta().folder() : "")) {
            return dsName + " · 数据概览";
        }
        return truncate(dsName, 18) + "分析";
    }

    private static String datasetName(DatasetDetailVO detail, String fallback) {
        if (detail != null && detail.meta() != null && detail.meta().name() != null) {
            return detail.meta().name();
        }
        return fallback;
    }

    private static Map<String, Object> encodeKpi(String datasetId, String value) {
        return encodeKpi(datasetId, value, "SUM");
    }

    private static Map<String, Object> encodeKpi(String datasetId, String value, String agg) {
        Map<String, Object> encode = new LinkedHashMap<>();
        encode.put("datasetId", datasetId);
        encode.put("value", value);
        encode.put("agg", agg);
        return encode;
    }

    private static Map<String, Object> encodeCat(String datasetId, String category, String value, String agg) {
        Map<String, Object> encode = new LinkedHashMap<>();
        encode.put("datasetId", datasetId);
        encode.put("category", category);
        encode.put("value", value);
        encode.put("agg", agg);
        return encode;
    }

    private static String truncate(String s, int n) {
        if (s == null) return "";
        return s.length() <= n ? s : s.substring(0, n) + "…";
    }
}
