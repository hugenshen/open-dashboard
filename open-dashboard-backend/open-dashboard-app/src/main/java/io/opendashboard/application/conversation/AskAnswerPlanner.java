package io.opendashboard.application.conversation;

import io.opendashboard.domain.DatasetDtos.DatasetDetailVO;
import io.opendashboard.domain.DatasetDtos.DatasetFieldVO;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Deterministic ask / insight answers (no arbitrary SQL).
 * Picks dataset/fields from the user-bound schema using question keywords;
 * vague questions return clarify (no fake chart).
 */
public final class AskAnswerPlanner {

    private static final AtomicLong SEQ = new AtomicLong(System.currentTimeMillis() % 1_000_000_000L);

    private AskAnswerPlanner() {}

    public record Answer(
            String kind,
            String title,
            String insightHtml,
            String headlineHtml,
            String datasetId,
            String chartType,
            Map<String, Object> encode,
            List<Map<String, Object>> drivers,
            List<String> follows,
            Map<String, Object> patchHint
    ) {
        public boolean needsClarify() {
            return "clarify".equals(kind);
        }

        public Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("kind", kind);
            m.put("title", title);
            m.put("insightHtml", insightHtml);
            m.put("headlineHtml", headlineHtml == null ? "" : headlineHtml);
            m.put("datasetId", datasetId);
            m.put("chartType", chartType);
            m.put("encode", encode);
            m.put("drivers", drivers == null ? List.of() : drivers);
            m.put("follows", follows == null ? List.of() : follows);
            m.put("patchHint", patchHint == null ? Map.of() : patchHint);
            return m;
        }
    }

    public static String resolveIntent(String explicit, String message) {
        if (explicit != null && !explicit.isBlank()) {
            String v = explicit.trim().toLowerCase(Locale.ROOT);
            if (v.equals("ask") || v.equals("insight") || v.equals("gen")) return v;
        }
        String q = message == null ? "" : message;
        if (q.matches("(?s).*(为什么|原因|归因|驱动|异常|下滑|下跌|下降).*")) return "insight";
        if (q.matches("(?s).*(生成.*(看板|仪表盘)|经营分析仪表盘|直接生成).*")) return "gen";
        return "ask";
    }

    public static Answer planAsk(String message, SchemaGuard.SchemaBundle schema) {
        String q = message == null ? "" : message.trim();
        IntentResolver.Plan intent = IntentResolver.resolve(q, schema);
        if (intent.needsClarify()) {
            return clarifyFromIntent(intent, q);
        }
        if (intent.cards().isEmpty() && isVague(q)) {
            return clarify(
                    "需要更具体的业务问题",
                    "「" + truncate(q, 40) + "」还不够明确。请指定<strong>指标</strong>（如销售额、利润）和<strong>维度</strong>（如区域、渠道、商户）。",
                    List.of("各区域销售额对比", "按渠道拆利润", "近一年各商户收入")
            );
        }

        IntentResolver.Card primary = intent.primaryChart();
        if (primary == null) {
            return clarifyFromIntent(intent, q);
        }
        String datasetId = intent.datasetId();
        Map<String, Object> encode = IntentResolver.encodeOf(primary, datasetId, intent.time());
        String insight = (intent.rewrite() == null ? "" : intent.rewrite() + "。")
                + "结果为会话预览，不落结果行。";
        if (intent.time() != null) {
            insight += "时间过滤已写入查询：" + intent.time().phrase()
                    + " → " + intent.time().label() + "。";
        }
        return new Answer(
                "intent",
                primary.title(),
                insight,
                mappingHeadline(intent),
                datasetId,
                primary.chartType(),
                encode,
                List.of(),
                List.of("保存到仪表盘", "直接生成仪表盘"),
                Map.of("scope", "single", "intent", intent.toMap())
        );
    }

    private static Answer clarifyFromIntent(IntentResolver.Plan intent, String q) {
        StringBuilder html = new StringBuilder();
        html.append("问题「").append(esc(truncate(q, 48))).append("」无法按原意取数。");
        if (intent.unresolved() != null && !intent.unresolved().isEmpty()) {
            html.append("<br/>缺字段：");
            for (int i = 0; i < intent.unresolved().size(); i++) {
                if (i > 0) html.append("；");
                var u = intent.unresolved().get(i);
                html.append("<strong>").append(esc(u.phrase())).append("</strong> — ").append(esc(u.reason()));
            }
        }
        if (intent.mapping() != null && !intent.mapping().isEmpty()) {
            html.append("<br/>已对齐：");
            for (int i = 0; i < intent.mapping().size(); i++) {
                if (i > 0) html.append("、");
                var x = intent.mapping().get(i);
                html.append(esc(x.phrase())).append("→").append(esc(x.label() == null ? x.field() : x.label()));
            }
        }
        html.append("<br/>请换有对应字段的数据集，或改问该表真实指标。");
        List<String> follows = new ArrayList<>();
        if (intent.datasetName() != null && !intent.datasetName().isBlank()) {
            follows.add("按「" + intent.datasetName() + "」已有字段重新提问");
        }
        follows.add("各区域销售额对比");
        follows.add("近几个月营收趋势");
        return clarify("当前数据集无法完整回答该问题", html.toString(), follows);
    }

    private static String mappingHeadline(IntentResolver.Plan intent) {
        if (intent.mapping() == null || intent.mapping().isEmpty()) return "";
        StringBuilder sb = new StringBuilder("字段对齐：");
        for (int i = 0; i < intent.mapping().size(); i++) {
            if (i > 0) sb.append("；");
            var x = intent.mapping().get(i);
            sb.append(esc(x.phrase())).append(" → ").append(esc(x.label() == null ? x.field() : x.label()));
        }
        return sb.toString();
    }

    public static Answer planInsight(String message, SchemaGuard.SchemaBundle schema) {
        String q = message == null ? "" : message.trim();
        String datasetId = pickDataset(q, schema);
        DatasetDetailVO detail = schema.byId().get(datasetId);
        String dsName = detail != null && detail.meta() != null ? detail.meta().name() : datasetId;
        String dim = pickField(detail, "dim", q, "channel", "渠道", "product", "产品", "region", "区域");
        String measure = pickField(detail, "quota", q, "amount", "销售额", "销售", "营收", "profit", "利润");
        Map<String, Object> encode = encodeOf(datasetId, dim, measure, "SUM");
        encode.put("filterHint", "region=华南");

        List<Map<String, Object>> drivers = new ArrayList<>();
        drivers.add(driver("线下门店", "线下贡献大部分跌幅（示意）", "-72 万", true));
        drivers.add(driver("产品结构", "弱势 SKU 拖累动销（示意）", "-41 万", true));
        drivers.add(driver("线上商城", "线上小幅增长，无法完全对冲", "+18 万", false));

        return new Answer(
                "insight",
                "下滑归因",
                "基于 <strong>" + esc(dsName) + "</strong> 的诊断示意：主因在<strong>线下</strong>；建议对华南线下做渠道×产品下钻。证据为会话预览，不落结果行。",
                "检测到异常下滑意图；已切换为 <strong>洞察诊断</strong>（非普通问数图）。",
                datasetId,
                "bar",
                encode,
                drivers,
                List.of("只看华南线下明细", "对比华东线下", "生成诊断看板"),
                Map.of("scope", "insight")
        );
    }

    public static DashboardPatch.Patch toSavePatch(Answer answer, String styleId) {
        if (answer.needsClarify()) {
            throw new IllegalStateException("clarify answer cannot be adopted");
        }
        long id = SEQ.addAndGet(3);
        String chartId = String.valueOf(id);
        List<Map<String, Object>> ops = new ArrayList<>();
        ops.add(DashboardPatch.setLayout(72, "default"));
        ops.add(DashboardPatch.setTheme(styleId == null || styleId.isBlank() ? "feishu-blue" : styleId));
        ops.add(DashboardPatch.upsertChart(
                chartId,
                answer.chartType(),
                answer.datasetId(),
                answer.title(),
                answer.encode(),
                Map.of()
        ));
        ops.add(DashboardPatch.upsertComponent("c_" + chartId, chartId, 0, 0, 36, 18));
        return new DashboardPatch.Patch(null, ops);
    }

    private static Answer clarify(String title, String html, List<String> follows) {
        return new Answer(
                "clarify",
                title,
                html,
                "当前问题无法直接取数，需要补充约束。",
                "",
                "",
                Map.of(),
                List.of(),
                follows,
                Map.of("scope", "clarify")
        );
    }

    private static boolean isVague(String q) {
        if (q == null || q.isBlank()) return true;
        String s = q.replaceAll("\\s+", "");
        if (s.length() < 4) return true;
        if (s.matches(".*(数据库|数据源|库里|表里).*(多少|几个|有哪些|什么).*")) return true;
        if (s.matches("^(有多少|多少个|几个|怎么样|如何|看看|查一下)$")) return true;
        if (s.matches("^(数据库有多少|数据有多少|库有多少).*")) return true;
        // no business anchor at all
        return !s.matches("(?s).*(区域|渠道|趋势|销售|营收|利润|收入|订单|商户|商家|UV|uv|额|月|年|华东|华南|华北|西部|线上|线下|对比|排行|为什么|下滑).*");
    }

    private static String pickDataset(String q, SchemaGuard.SchemaBundle schema) {
        String best = schema.byId().keySet().iterator().next();
        int bestScore = -1;
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
        String id = detail.meta() != null ? detail.meta().id() : "";
        String blob = (name + " " + id).toLowerCase(Locale.ROOT);
        if (q.matches("(?s).*(销售|营收|额|区域).*") && blob.matches(".*(销售|sales|经营).*")) score += 20;
        if (q.matches("(?s).*(财务|利润|收入|支出).*") && blob.matches(".*(财务|finance).*")) score += 20;
        if (q.matches("(?s).*(运营|UV|uv|渠道).*") && blob.matches(".*(运营|ops).*")) score += 15;
        if (detail.fields() != null) {
            for (DatasetFieldVO f : detail.fields()) {
                String n = f.name() == null ? "" : f.name().toLowerCase(Locale.ROOT);
                String l = f.label() == null ? "" : f.label();
                if (q.contains("区域") && (n.contains("region") || l.contains("区域"))) score += 8;
                if (q.contains("渠道") && (n.contains("channel") || l.contains("渠道"))) score += 8;
                if (q.matches("(?s).*(销售|营收|额).*") && (n.contains("amount") || l.contains("销售") || l.contains("营收"))) {
                    score += 8;
                }
                if (q.contains("利润") && (n.contains("profit") || l.contains("利润"))) score += 8;
            }
        }
        return score;
    }

    private static String pickField(DatasetDetailVO detail, String group, String q, String... preferred) {
        if (detail != null && detail.fields() != null) {
            // 1) preferred names / Chinese labels present in question
            for (String p : preferred) {
                if (q != null && q.contains(p)) {
                    for (DatasetFieldVO f : detail.fields()) {
                        if (p.equalsIgnoreCase(f.name()) || (f.label() != null && f.label().contains(p))) {
                            return f.name();
                        }
                    }
                }
            }
            // 2) preferred field exists
            for (String p : preferred) {
                for (DatasetFieldVO f : detail.fields()) {
                    if (p.equalsIgnoreCase(f.name())) return f.name();
                    if (f.label() != null && f.label().equals(p)) return f.name();
                }
            }
            // 3) any field in group
            for (DatasetFieldVO f : detail.fields()) {
                if (group.equalsIgnoreCase(f.group())) return f.name();
            }
            if (!detail.fields().isEmpty()) return detail.fields().getFirst().name();
        }
        return preferred.length > 0 ? preferred[0] : "amount";
    }

    private static Map<String, Object> encodeOf(String datasetId, String category, String value, String agg) {
        Map<String, Object> encode = new LinkedHashMap<>();
        encode.put("datasetId", datasetId);
        encode.put("category", category);
        encode.put("value", value);
        encode.put("agg", agg);
        return encode;
    }

    private static Map<String, Object> driver(String k, String d, String delta, boolean neg) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("k", k);
        m.put("d", d);
        m.put("delta", delta);
        m.put("neg", neg);
        return m;
    }

    private static String esc(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    private static String truncate(String s, int n) {
        if (s == null) return "";
        return s.length() <= n ? s : s.substring(0, n) + "…";
    }
}
