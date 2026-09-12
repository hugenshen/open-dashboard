package io.opendashboard.application.report;

import io.opendashboard.domain.ReportRunDtos.*;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class ReportQualityValidatorTest {
    @Test
    void goldenReportPasses() {
        ReportQualityValidator.Result result = validate("销售额100元，较基期80元增长25%", evidence(), List.of(), 0);
        assertEquals(0, result.blockers());
        assertEquals("pass", result.quality().get("status"));
    }

    @Test
    void blocksEveryDeterministicMutationWithLocation() {
        assertIssue(validate("销售额999元", evidence(), List.of(), 0), "NUMERIC_MISMATCH");
        assertIssue(validate("销售额100万元", evidence(), List.of(), 0), "UNIT_MISMATCH");
        assertIssue(validate("销售额100元同比增长25%", evidenceWithoutDenominator(), List.of(), 0), "DENOMINATOR_MISSING");
        assertIssue(validate("2025年12月销售额100元", evidence(), List.of(), 0), "TIME_RANGE_MISMATCH");
        assertIssue(validate("状态为失败的销售额100元", evidence(), List.of(), 0), "FILTER_MISMATCH");
        ReportEvidenceVO inconsistent = evidence().getFirst();
        inconsistent = new ReportEvidenceVO(inconsistent.id(), inconsistent.runId(), inconsistent.taskId(), inconsistent.datasetId(),
                inconsistent.queryFingerprint(), inconsistent.metric(), inconsistent.filters(), inconsistent.timeRange(), inconsistent.unit(),
                inconsistent.denominator(), inconsistent.resultDigest(), Map.of("total", 100, "parts", List.of(40, 50), "baseline", 80),
                inconsistent.sampleRows(), inconsistent.createTime());
        assertIssue(validate("销售额100元", List.of(inconsistent), List.of(), 0), "TOTAL_PARTS_MISMATCH");
        assertIssue(validateWithMarkdown("报告正文另有销售额777元。", "销售额100元", evidence(), List.of(), 0), "UNCLAIMED_QUANTITATIVE_STATEMENT");
    }

    @Test
    void reviewerBlocksCausalitySkippedDisclosureAndRepairOverflow() {
        assertIssue(validate("促销导致销售额100元", evidence(), List.of(), 0), "UNSUPPORTED_CAUSALITY");
        ReportTaskVO skipped = new ReportTaskVO("t1", "r1", 1, "one", "skipped", 1, List.of(), Map.of(), Map.of(), "无数据", 1L, 1L);
        assertIssue(validate("销售额100元", evidence(), List.of(skipped), 0), "SKIPPED_TASK_NOT_DISCLOSED");
        assertIssue(validate("销售额100元", evidence(), List.of(), 3), "REPAIR_LIMIT_EXCEEDED");
        assertIssue(validateClaims(List.of(
                new ReportClaimCreateRequest(1, "summary", "comparison", "销售额增长25%", List.of("e1"), "high", null, null),
                new ReportClaimCreateRequest(1, "detail", "comparison", "销售额下降25%", List.of("e1"), "high", null, null))),
                "CHAPTER_CONTRADICTION");
        assertIssue(validateClaims(List.of()), "QUESTION_COVERAGE_MISSING");
    }

    private static ReportQualityValidator.Result validate(String statement, List<ReportEvidenceVO> evidence, List<ReportTaskVO> tasks, int repairAttempt) {
        return validateWithMarkdown("# 报告\n\n## 报告摘要\n\n" + statement + "。\n\n## 结论与建议\n\n建议跟进。\n\n## 附录：证据\n\n口径见证据。",
                statement, evidence, tasks, repairAttempt);
    }

    private static ReportQualityValidator.Result validateWithMarkdown(String extra, String statement, List<ReportEvidenceVO> evidence, List<ReportTaskVO> tasks, int repairAttempt) {
        String markdown = extra.contains("## 报告摘要") ? extra : "# 报告\n\n## 报告摘要\n\n销售额100元。" + extra + "\n\n## 结论与建议\n\n建议跟进。\n\n## 附录：证据\n\n口径见证据。";
        ReportRunVO run = new ReportRunVO("r1", "c1", "w1", "u1", "quality_check", Map.of(), 1, Map.of(), 1, 1,
                Map.of(), Map.of(), 1, 1L, 1L);
        List<ReportArtifactVO> artifacts = List.of(
                new ReportArtifactVO("a1", "r1", 1, "final_md", "r.md", "text/markdown", markdown, 1, null, null, 1L),
                new ReportArtifactVO("a2", "r1", 1, "final_html", "r.html", "text/html", "<h1>报告</h1>", 1, null, null, 1L));
        ReportClaimCreateRequest claim = new ReportClaimCreateRequest(1, "summary", "fact", statement, List.of("e1"), "high", null, null);
        return ReportQualityValidator.validate(run, tasks, evidence, artifacts,
                new ReportQualityUpdateRequest(Map.of("repairAttempt", repairAttempt), List.of(claim)));
    }

    private static ReportQualityValidator.Result validateClaims(List<ReportClaimCreateRequest> claims) {
        ReportRunVO run = new ReportRunVO("r1", "c1", "w1", "u1", "quality_check", Map.of("goal", "分析销售"), 1,
                Map.of(), 1, 1, Map.of(), Map.of(), 1, 1L, 1L);
        String markdown = "# 报告\n\n## 报告摘要\n\n销售额100元。\n\n## 结论与建议\n\n建议跟进。\n\n## 附录：证据\n\n口径见证据。";
        List<ReportArtifactVO> artifacts = List.of(
                new ReportArtifactVO("a1", "r1", 1, "final_md", "r.md", "text/markdown", markdown, 1, null, null, 1L),
                new ReportArtifactVO("a2", "r1", 1, "final_html", "r.html", "text/html", "<h1>报告</h1>", 1, null, null, 1L));
        return ReportQualityValidator.validate(run, List.of(), evidence(), artifacts,
                new ReportQualityUpdateRequest(Map.of(), claims));
    }

    private static List<ReportEvidenceVO> evidence() {
        return List.of(new ReportEvidenceVO("e1", "r1", "t1", "ds1", "query", Map.of("field", "sales", "agg", "sum"),
                List.of(Map.of("field", "status", "value", "成功")), Map.of("from", "2026-01-01", "to", "2026-01-31"),
                Map.of("source", "元", "display", "元"), Map.of("kind", "previous_period"), "digest",
                Map.of("current", 100, "baseline", 80, "changePercent", 25), List.of(Map.of("sales", 100), Map.of("sales", 80)), 1L));
    }

    private static List<ReportEvidenceVO> evidenceWithoutDenominator() {
        ReportEvidenceVO e = evidence().getFirst();
        return List.of(new ReportEvidenceVO(e.id(), e.runId(), e.taskId(), e.datasetId(), e.queryFingerprint(), e.metric(), e.filters(),
                e.timeRange(), e.unit(), Map.of(), e.resultDigest(), Map.of("current", 100, "changePercent", 25), e.sampleRows(), e.createTime()));
    }

    @SuppressWarnings("unchecked")
    private static void assertIssue(ReportQualityValidator.Result result, String code) {
        Map<String, Object> reviewer = (Map<String, Object>) result.quality().get("reviewer");
        List<Map<String, Object>> issues = (List<Map<String, Object>>) reviewer.get("issues");
        assertTrue(issues.stream().anyMatch(issue -> code.equals(issue.get("issueCode")) && issue.containsKey("claimId")
                && issue.containsKey("severity") && issue.containsKey("message") && issue.containsKey("repairHint")), issues.toString());
        assertTrue(result.blockers() > 0);
    }
}
