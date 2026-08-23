package io.opendashboard.application.conversation;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Ask / insight answers from schema-matched intent cards. No fake drivers, no business dictionaries.
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
        if (q.matches("(?s).*生成.*(看板|仪表盘).*")) return "gen";
        return "ask";
    }

    public static Answer planAsk(String message, SchemaGuard.SchemaBundle schema) {
        return fromIntent(message, schema, "intent");
    }

    public static Answer planInsight(String message, SchemaGuard.SchemaBundle schema) {
        return fromIntent(message, schema, "insight");
    }

    private static Answer fromIntent(String message, SchemaGuard.SchemaBundle schema, String kind) {
        String q = message == null ? "" : message.trim();
        IntentResolver.Plan intent = IntentResolver.resolve(q, schema);
        if (intent.needsClarify()) {
            return clarifyFromIntent(intent, q);
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
                kind,
                primary.title(),
                insight,
                mappingHeadline(intent),
                datasetId,
                primary.chartType(),
                encode,
                List.of(),
                List.of(),
                Map.of("scope", kind, "intent", intent.toMap())
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
        html.append("<br/>请用数据集里的字段名或中文标签提问。");
        List<String> follows = new ArrayList<>();
        if (intent.datasetName() != null && !intent.datasetName().isBlank()) {
            follows.add("按「" + intent.datasetName() + "」已有字段重新提问");
        }
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
        ops.add(DashboardPatch.upsertComponent(chartId, chartId, 0, 0, 36, 18));
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

    private static String esc(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    private static String truncate(String s, int n) {
        if (s == null) return "";
        return s.length() <= n ? s : s.substring(0, n) + "…";
    }
}
