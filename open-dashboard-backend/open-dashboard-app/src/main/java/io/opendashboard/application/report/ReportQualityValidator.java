package io.opendashboard.application.report;

import io.opendashboard.domain.ReportRunDtos.*;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Deterministic report gate. Reviewer-like checks are server-owned and never trust a model score. */
final class ReportQualityValidator {
    private static final Pattern NUMBER = Pattern.compile("(?<![\\w.-])-?\\d+(?:,\\d{3})*(?:\\.\\d+)?%?");
    private static final Pattern TIME = Pattern.compile("(?:20\\d{2}(?:[-/.年]\\d{1,2}(?:[-/.月]\\d{1,2}日?)?)?|\\d{1,2}月)");
    private static final Pattern FILTER = Pattern.compile("(状态|渠道|商户|地区)(?:为|=|：)\\s*([\\p{IsHan}A-Za-z0-9_-]+)");
    private static final List<String> UNITS = List.of("亿元", "万元", "元", "%", "笔", "个", "人", "天", "小时");

    record Result(List<ReportClaimCreateRequest> claims, Map<String, Object> quality, int blockers) {}

    static Result validate(ReportRunVO run, List<ReportTaskVO> tasks, List<ReportEvidenceVO> evidence,
                           List<ReportArtifactVO> artifacts, ReportQualityUpdateRequest request) {
        List<Map<String, Object>> issues = new ArrayList<>();
        Set<String> evidenceIds = new HashSet<>(evidence.stream().map(ReportEvidenceVO::id).toList());
        List<ReportClaimCreateRequest> checked = new ArrayList<>();

        for (ReportClaimCreateRequest claim : request.claims()) {
            List<String> refs = claim.evidenceRefs() == null ? List.of() : claim.evidenceRefs();
            List<ReportEvidenceVO> cited = evidence.stream().filter(e -> refs.contains(e.id())).toList();
            int before = blockerCount(issues);
            if ((refs.isEmpty() || !evidenceIds.containsAll(refs)) && !"recommendation".equals(claim.claimType())) {
                issue(issues, "MISSING_EVIDENCE", claim.sectionId(), "blocker", "结论缺少有效 evidenceRef", "重新绑定产生该结论的证据");
            }
            if (!cited.isEmpty()) {
                validateNumbers(claim, cited, issues);
                validateUnit(claim, cited, issues);
                validateTime(claim, cited, issues);
                validateComparison(claim, cited, issues);
                validateFilter(claim, cited, issues);
            }
            if (Pattern.compile("导致|因为|造成|驱动|归因于").matcher(text(claim.statement())).find()
                    && !Pattern.compile("相关|待验证|不能证明因果|假设").matcher(text(claim.caveat())).find()) {
                issue(issues, "UNSUPPORTED_CAUSALITY", claim.sectionId(), "blocker", "因果结论缺少可验证设计或限制说明", "改为相关性表述或补充因果证据");
            }
            String status = blockerCount(issues) == before ? "pass" : "block";
            checked.add(new ReportClaimCreateRequest(claim.artifactVersion(), claim.sectionId(), claim.claimType(),
                    claim.statement(), refs, claim.confidence(), claim.caveat(), status));
        }
        if (checked.stream().noneMatch(claim -> Set.of("fact", "comparison", "anomaly", "limitation").contains(claim.claimType()))) {
            issue(issues, "QUESTION_COVERAGE_MISSING", null, "blocker", "报告没有可验证结论或限制，无法证明已回答 Brief", "补充回答目标的事实结论或 limitation");
        }
        validateContradictions(checked, issues);

        int activeVersion = run.activeArtifactVersion() == null ? 0 : run.activeArtifactVersion();
        List<ReportArtifactVO> active = artifacts.stream().filter(a -> a.artifactVersion() == activeVersion).toList();
        Set<String> kinds = new HashSet<>(active.stream().map(ReportArtifactVO::kind).toList());
        String markdown = active.stream().filter(a -> "final_md".equals(a.kind())).map(ReportArtifactVO::content).findFirst().orElse("");
        if (!kinds.contains("final_md") || !kinds.contains("final_html"))
            issue(issues, "DELIVERY_FORMAT_MISSING", null, "blocker", "HTML/Markdown 交付格式不完整", "同时生成 final_md 与 final_html");
        if (markdown.length() < 40 || !containsAny(markdown, "报告摘要", "核心结论", "Executive Summary")
                || !containsAny(markdown, "建议", "行动") || !containsAny(markdown, "附录", "证据", "口径"))
            issue(issues, "REPORT_STRUCTURE_INVALID", null, "blocker", "报告缺少摘要、建议或证据章节", "补齐标准业务章节");
        if (evidence.isEmpty() || evidence.stream().anyMatch(e -> text(e.datasetId()).isBlank()
                || text(e.queryFingerprint()).isBlank() || text(e.resultDigest()).isBlank()
                || e.unit() == null || e.unit().isEmpty() || e.timeRange() == null || e.timeRange().isEmpty()))
            issue(issues, "EVIDENCE_METADATA_INCOMPLETE", null, "blocker", "证据缺少数据集、查询指纹、时间、单位或摘要指纹", "由取数工具重新生成完整 Evidence");

        validateClaimCoverage(markdown, checked, issues);
        validateTotals(evidence, issues);
        boolean skipped = tasks.stream().anyMatch(t -> "skipped".equals(t.status()));
        if (skipped && !containsAny(markdown, "局限", "限制", "未完成", "跳过"))
            issue(issues, "SKIPPED_TASK_NOT_DISCLOSED", null, "blocker", "跳过任务未在报告披露", "在局限章节说明跳过原因和影响");
        for (ReportClaimCreateRequest claim : checked) {
            if ("recommendation".equals(claim.claimType()) && text(claim.statement()).length() < 12)
                issue(issues, "GENERIC_RECOMMENDATION", claim.sectionId(), "warning", "建议过于笼统", "补充责任人、动作与验证指标");
        }
        int repairAttempt = integer(request.quality().get("repairAttempt"), 0);
        if (repairAttempt > 2)
            issue(issues, "REPAIR_LIMIT_EXCEEDED", null, "blocker", "质量修复次数已达上限", "保留问题并交由用户处理");

        int blockers = blockerCount(issues);
        Map<String, Object> deterministic = new LinkedHashMap<>();
        deterministic.put("deliveryFormats", kinds.contains("final_md") && kinds.contains("final_html"));
        deterministic.put("evidenceMetadata", !evidence.isEmpty());
        deterministic.put("claimCoverage", issues.stream().noneMatch(i -> "UNCLAIMED_QUANTITATIVE_STATEMENT".equals(i.get("issueCode"))));
        deterministic.put("mutationChecks", List.of("number", "unit", "denominator", "filter", "timeRange", "totalParts"));
        Map<String, Object> reviewer = new LinkedHashMap<>();
        reviewer.put("status", blockers == 0 ? "pass" : "block");
        reviewer.put("repairAttempt", repairAttempt);
        reviewer.put("maxRepairAttempts", 2);
        reviewer.put("issues", issues);
        Map<String, Object> quality = new LinkedHashMap<>();
        quality.put("deterministic", deterministic);
        quality.put("reviewer", reviewer);
        quality.put("repairAttempt", repairAttempt);
        quality.put("blockers", blockers);
        quality.put("warnings", issues.stream().filter(i -> "warning".equals(i.get("severity"))).count());
        quality.put("status", blockers == 0 ? "pass" : "block");
        return new Result(List.copyOf(checked), Map.copyOf(quality), blockers);
    }

    private static void validateNumbers(ReportClaimCreateRequest claim, List<ReportEvidenceVO> evidence, List<Map<String, Object>> issues) {
        List<Double> allowed = new ArrayList<>();
        evidence.forEach(e -> { collectNumbers(e.resultSummary(), allowed); collectNumbers(e.sampleRows(), allowed); });
        for (String token : numbers(text(claim.statement()))) {
            double value = numeric(token);
            if (Math.abs(value) >= 1900 && Math.abs(value) <= 2100) continue;
            boolean matched = allowed.stream().anyMatch(a -> close(a, value) || (token.endsWith("%") && (close(a * 100, value) || close(a, value / 100))));
            if (!matched) issue(issues, "NUMERIC_MISMATCH", claim.sectionId(), "blocker", "结论数值 " + token + " 不在引用证据中", "依据 Evidence 结果重算并替换数值");
        }
    }

    private static void validateUnit(ReportClaimCreateRequest claim, List<ReportEvidenceVO> evidence, List<Map<String, Object>> issues) {
        String statement = text(claim.statement());
        String unit = UNITS.stream().filter(statement::contains).findFirst().orElse("");
        if (unit.isEmpty()) return;
        String declared = evidence.stream().map(e -> String.valueOf(e.unit())).reduce("", (a, b) -> a + " " + b);
        if (!declared.contains(unit)) issue(issues, "UNIT_MISMATCH", claim.sectionId(), "blocker", "结论单位 " + unit + " 与证据单位不一致", "使用 Evidence 声明的 display unit");
    }

    private static void validateTime(ReportClaimCreateRequest claim, List<ReportEvidenceVO> evidence, List<Map<String, Object>> issues) {
        Matcher matcher = TIME.matcher(text(claim.statement()));
        String ranges = evidence.stream().map(e -> String.valueOf(e.timeRange())).reduce("", (a, b) -> a + " " + b);
        while (matcher.find()) {
            String token = matcher.group();
            String normalized = token.replace("年", "-").replace("月", "").replace("日", "").replace('/', '-').replace('.', '-');
            if (!ranges.contains(token) && !ranges.contains(normalized))
                issue(issues, "TIME_RANGE_MISMATCH", claim.sectionId(), "blocker", "结论时间 " + token + " 不在证据范围中", "改用 Evidence 的 timeRange");
        }
    }

    private static void validateComparison(ReportClaimCreateRequest claim, List<ReportEvidenceVO> evidence, List<Map<String, Object>> issues) {
        if (!Pattern.compile("同比|环比|增长|下降|增加|减少").matcher(text(claim.statement())).find()) return;
        boolean ready = evidence.stream().anyMatch(e -> e.denominator() != null && !e.denominator().isEmpty()
                && (containsKeyLike(e.resultSummary(), "baseline") || containsKeyLike(e.resultSummary(), "previous") || containsKeyLike(e.resultSummary(), "base")));
        if (!ready) issue(issues, "DENOMINATOR_MISSING", claim.sectionId(), "blocker", "比较结论缺少基期或分母", "补充 baseline 与 denominator 后重算");
    }

    private static void validateFilter(ReportClaimCreateRequest claim, List<ReportEvidenceVO> evidence, List<Map<String, Object>> issues) {
        Matcher matcher = FILTER.matcher(text(claim.statement()));
        String filters = evidence.stream().map(e -> String.valueOf(e.filters())).reduce("", (a, b) -> a + " " + b);
        while (matcher.find()) if (!filters.contains(matcher.group(2)))
            issue(issues, "FILTER_MISMATCH", claim.sectionId(), "blocker", "结论筛选值 " + matcher.group(2) + " 未出现在证据筛选中", "绑定相同 filters 的 Evidence");
    }

    private static void validateClaimCoverage(String markdown, List<ReportClaimCreateRequest> claims, List<Map<String, Object>> issues) {
        String claimText = claims.stream().map(ReportClaimCreateRequest::statement).reduce("", (a, b) -> a + " " + b);
        for (String line : markdown.split("[。！？\\n]+")) {
            String trimmed = line.trim();
            if (trimmed.isEmpty() || trimmed.startsWith("#") || trimmed.startsWith("|") || trimmed.matches(".*(?:版本|任务|证据)\\s*#?\\d+.*")) continue;
            List<String> values = numbers(trimmed).stream().filter(n -> {
                double v = numeric(n); return !(Math.abs(v) >= 1900 && Math.abs(v) <= 2100);
            }).toList();
            if (!values.isEmpty() && values.stream().noneMatch(claimText::contains)) {
                issue(issues, "UNCLAIMED_QUANTITATIVE_STATEMENT", null, "blocker", "正文定量语句未建立 Claim：" + abbreviate(trimmed), "为该语句建立 Claim → Evidence 引用");
            }
        }
    }

    private static void validateTotals(List<ReportEvidenceVO> evidence, List<Map<String, Object>> issues) {
        for (ReportEvidenceVO row : evidence) {
            Object total = row.resultSummary() == null ? null : row.resultSummary().get("total");
            Object parts = row.resultSummary() == null ? null : row.resultSummary().get("parts");
            if (total instanceof Number expected && parts instanceof List<?> list) {
                double sum = list.stream().filter(Number.class::isInstance).map(Number.class::cast).mapToDouble(Number::doubleValue).sum();
                if (!close(sum, expected.doubleValue())) issue(issues, "TOTAL_PARTS_MISMATCH", row.id(), "blocker", "总计与分项之和不一致", "重新聚合 total 与 parts");
            }
        }
    }

    private static void validateContradictions(List<ReportClaimCreateRequest> claims, List<Map<String, Object>> issues) {
        for (int i = 0; i < claims.size(); i++) for (int j = i + 1; j < claims.size(); j++) {
            ReportClaimCreateRequest left = claims.get(i);
            ReportClaimCreateRequest right = claims.get(j);
            Set<String> shared = new HashSet<>(left.evidenceRefs() == null ? List.of() : left.evidenceRefs());
            shared.retainAll(right.evidenceRefs() == null ? List.of() : right.evidenceRefs());
            if (!shared.isEmpty() && oppositeDirection(text(left.statement()), text(right.statement()))) {
                issue(issues, "CHAPTER_CONTRADICTION", right.sectionId(), "blocker", "引用同一证据的章节结论方向矛盾", "统一增长/下降方向并复核 Evidence");
            }
        }
    }

    private static boolean oppositeDirection(String left, String right) {
        boolean leftUp = containsAny(left, "增长", "上升", "增加", "改善");
        boolean leftDown = containsAny(left, "下降", "减少", "下滑", "恶化");
        boolean rightUp = containsAny(right, "增长", "上升", "增加", "改善");
        boolean rightDown = containsAny(right, "下降", "减少", "下滑", "恶化");
        return (leftUp && rightDown) || (leftDown && rightUp);
    }

    private static boolean containsKeyLike(Map<String, Object> map, String token) {
        return map != null && map.keySet().stream().anyMatch(k -> k.toLowerCase(Locale.ROOT).contains(token));
    }
    private static void collectNumbers(Object value, List<Double> out) {
        if (value instanceof Number n) out.add(n.doubleValue());
        else if (value instanceof Map<?, ?> map) map.values().forEach(v -> collectNumbers(v, out));
        else if (value instanceof Iterable<?> list) list.forEach(v -> collectNumbers(v, out));
    }
    private static List<String> numbers(String value) { List<String> out = new ArrayList<>(); Matcher m = NUMBER.matcher(value); while (m.find()) out.add(m.group()); return out; }
    private static double numeric(String value) { try { return Double.parseDouble(value.replace(",", "").replace("%", "")); } catch (Exception e) { return Double.NaN; } }
    private static boolean close(double a, double b) { return Math.abs(a - b) <= Math.max(0.0001, Math.max(Math.abs(a), Math.abs(b)) * 0.00001); }
    private static int integer(Object value, int fallback) { return value instanceof Number n ? n.intValue() : fallback; }
    private static boolean containsAny(String value, String... tokens) { for (String token : tokens) if (value.contains(token)) return true; return false; }
    private static int blockerCount(List<Map<String, Object>> issues) { return (int) issues.stream().filter(i -> "blocker".equals(i.get("severity"))).count(); }
    private static void issue(List<Map<String, Object>> issues, String code, String claimId, String severity, String message, String hint) {
        Map<String, Object> row = new LinkedHashMap<>(); row.put("issueCode", code); row.put("claimId", claimId == null ? "" : claimId);
        row.put("severity", severity); row.put("message", message); row.put("repairHint", hint); issues.add(Map.copyOf(row));
    }
    private static String text(Object value) { return value == null ? "" : String.valueOf(value).trim(); }
    private static String abbreviate(String value) { return value.length() <= 60 ? value : value.substring(0, 60) + "…"; }
}
