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
        String dsName = datasetName(detail, datasetId);

        FieldRef measure = pickBestMeasure(detail, q);
        FieldRef measure2 = pickSecondMeasure(detail, measure, q);
        FieldRef dim = pickBestDim(detail, q);
        FieldRef dim2 = pickSecondDim(detail, dim);

        String boardTitle = boardTitle(q, dsName, detail);
        long base = SEQ.addAndGet(20);
        String kpi1 = String.valueOf(base);
        String kpi2 = String.valueOf(base + 1);
        String barId = String.valueOf(base + 2);
        String bar2Id = String.valueOf(base + 3);
        String lineId = String.valueOf(base + 4);

        List<Map<String, Object>> ops = new ArrayList<>();
        ops.add(DashboardPatch.setLayout(72, "default"));
        ops.add(DashboardPatch.setTheme(styleId == null || styleId.isBlank() ? "feishu-blue" : styleId));

        if (measure == null || dim == null) {
            FieldRef countKey = dim != null ? dim : firstUsableField(detail);
            if (countKey == null) {
                return new DashboardPatch.Patch(dashboardId, ops);
            }
            String kpiTitle = measure != null ? measure.display() : "记录数";
            Map<String, Object> kpiEncode = measure != null
                    ? encodeKpi(datasetId, measure.name(), suggestedAgg(measure))
                    : encodeKpi(datasetId, countKey.name(), "COUNT");
            ops.add(DashboardPatch.upsertChart(kpi1, "kpi", datasetId, kpiTitle, kpiEncode, Map.of()));
            ops.add(DashboardPatch.upsertComponent("c_" + kpi1, kpi1, 0, 0, 36, 12));

            FieldRef cat = dim != null ? dim : countKey;
            String valueField = measure != null ? measure.name() : cat.name();
            String agg = measure != null ? suggestedAgg(measure) : "COUNT";
            String barTitle = cat.display() + " · " + (measure != null ? measure.display() : "记录数");
            ops.add(DashboardPatch.upsertChart(
                    barId, "bar", datasetId, barTitle,
                    encodeCat(datasetId, cat.name(), valueField, agg), Map.of()
            ));
            ops.add(DashboardPatch.upsertComponent("c_" + barId, barId, 36, 0, 36, 18));
            return new DashboardPatch.Patch(dashboardId, ops);
        }

        String agg1 = suggestedAgg(measure);
        ops.add(DashboardPatch.upsertChart(
                kpi1, "kpi", datasetId, measure.display(),
                encodeKpi(datasetId, measure.name(), agg1), Map.of()
        ));
        ops.add(DashboardPatch.upsertComponent("c_" + kpi1, kpi1, 0, 0, measure2 == null ? 36 : 18, 10));

        if (measure2 != null) {
            ops.add(DashboardPatch.upsertChart(
                    kpi2, "kpi", datasetId, measure2.display(),
                    encodeKpi(datasetId, measure2.name(), suggestedAgg(measure2)), Map.of()
            ));
            ops.add(DashboardPatch.upsertComponent("c_" + kpi2, kpi2, 18, 0, 18, 10));
        }

        ops.add(DashboardPatch.upsertChart(
                barId, "bar", datasetId, dim.display() + " · " + measure.display(),
                encodeCat(datasetId, dim.name(), measure.name(), agg1), Map.of()
        ));
        ops.add(DashboardPatch.upsertComponent("c_" + barId, barId, 36, 0, 36, 18));

        int y2 = 18;
        if (dim2 != null) {
            ops.add(DashboardPatch.upsertChart(
                    bar2Id, "bar", datasetId, dim2.display() + " · " + measure.display(),
                    encodeCat(datasetId, dim2.name(), measure.name(), agg1), Map.of()
            ));
            ops.add(DashboardPatch.upsertComponent("c_" + bar2Id, bar2Id, 0, y2, 36, 18));
            ops.add(DashboardPatch.upsertChart(
                    lineId, "line", datasetId, dim.display() + "走势 · " + measure.display(),
                    encodeCat(datasetId, dim.name(), measure.name(), agg1), Map.of()
            ));
            ops.add(DashboardPatch.upsertComponent("c_" + lineId, lineId, 36, y2, 36, 18));
        } else {
            ops.add(DashboardPatch.upsertChart(
                    lineId, "line", datasetId, boardTitle + " · 分布",
                    encodeCat(datasetId, dim.name(), measure.name(), agg1), Map.of()
            ));
            ops.add(DashboardPatch.upsertComponent("c_" + lineId, lineId, 0, y2, 72, 18));
        }

        return new DashboardPatch.Patch(dashboardId, ops);
    }

    /** Public title helper for harness SSE / dashboard create. */
    public static String resolveTitle(String message, SchemaGuard.SchemaBundle schema) {
        String datasetId = pickDataset(message == null ? "" : message, schema);
        DatasetDetailVO detail = schema.byId().get(datasetId);
        return boardTitle(message == null ? "" : message, datasetName(detail, datasetId), detail);
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
            int comma = raw.indexOf(',');
            if (comma > 0 && comma < raw.length() - 1) {
                String head = raw.substring(0, comma).trim();
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

        if (isWeakMeta(name, table, folder)) score -= 80;
        if (table.startsWith("de_")) score -= 40;
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
        return table.startsWith("de_")
                || name.contains("工作室")
                || name.contains("拖拽")
                || name.contains("验证")
                || "测试".equals(folder);
    }

    private static FieldRef pickBestMeasure(DatasetDetailVO detail, String q) {
        if (detail == null || detail.fields() == null) return null;
        return detail.fields().stream()
                .map(f -> toRef(f, scoreMeasure(f, q)))
                .filter(f -> f.score() > 0)
                .max(Comparator.comparingInt(FieldRef::score))
                .orElseGet(() -> detail.fields().stream()
                        .filter(f -> "quota".equalsIgnoreCase(f.group()))
                        .filter(f -> !"calc".equalsIgnoreCase(f.origin()))
                        .filter(f -> !isJunkMeasure(f))
                        .map(f -> toRef(f, 1))
                        .findFirst()
                        .orElse(null));
    }

    private static boolean isJunkMeasure(DatasetFieldVO f) {
        if (f == null || f.name() == null) return true;
        String n = f.name().toLowerCase(Locale.ROOT);
        String l = f.label() == null ? "" : f.label();
        return n.endsWith("_len") || n.contains("length") || l.contains("长度")
                || n.equals("id") || n.equals("uuid");
    }

    private static FieldRef pickSecondMeasure(DatasetDetailVO detail, FieldRef primary, String q) {
        if (detail == null || detail.fields() == null || primary == null) return null;
        return detail.fields().stream()
                .filter(f -> !f.name().equalsIgnoreCase(primary.name()))
                .map(f -> toRef(f, scoreMeasure(f, q)))
                .filter(f -> f.score() >= 40)
                .max(Comparator.comparingInt(FieldRef::score))
                .orElse(null);
    }

    private static FieldRef pickBestDim(DatasetDetailVO detail, String q) {
        if (detail == null || detail.fields() == null) return null;
        return detail.fields().stream()
                .map(f -> toRef(f, scoreDim(f, q)))
                .filter(f -> f.score() > 0)
                .max(Comparator.comparingInt(FieldRef::score))
                .orElseGet(() -> detail.fields().stream()
                        .filter(f -> "dim".equalsIgnoreCase(f.group()))
                        .map(f -> toRef(f, 1))
                        .findFirst()
                        .orElse(null));
    }

    private static FieldRef pickSecondDim(DatasetDetailVO detail, FieldRef primary) {
        if (detail == null || detail.fields() == null || primary == null) return null;
        return detail.fields().stream()
                .filter(f -> !f.name().equalsIgnoreCase(primary.name()))
                .map(f -> toRef(f, scoreDim(f, "")))
                .filter(f -> f.score() >= 35)
                .max(Comparator.comparingInt(FieldRef::score))
                .orElse(null);
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
        if (n.contains("rate") || l.contains("费率") || l.contains("率")) score += 25;
        if (n.contains("status") || l.contains("状态")) score -= 90;
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
        if (n.contains("mch") || l.contains("商户")) score += 55;
        if (n.contains("app") || l.contains("应用")) score += 55;
        if (n.contains("agent") || l.contains("代理")) score += 50;
        if (n.contains("region") || l.contains("区域")) score += 70;
        if (n.contains("channel") || l.contains("渠道")) score += 65;
        if (n.contains("way") || n.contains("if_type") || l.contains("接口") || l.contains("类型")) score += 60;
        if (n.contains("status") || l.contains("状态")) score += 85;
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
