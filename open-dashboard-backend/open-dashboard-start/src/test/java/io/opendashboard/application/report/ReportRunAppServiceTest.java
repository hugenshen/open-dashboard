package io.opendashboard.application.report;

import io.opendashboard.application.InMemoryConversationStore;
import io.opendashboard.application.InMemoryReportRunStore;
import io.opendashboard.application.InMemoryReportStore;
import io.opendashboard.domain.ConversationDtos.ConversationCreateRequest;
import io.opendashboard.domain.ReportRunDtos.*;
import io.opendashboard.domain.context.AuthContext;
import io.opendashboard.domain.context.AuthPrincipal;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

class ReportRunAppServiceTest {
    @AfterEach void clearAuth() { AuthContext.clear(); }

    @Test
    void runsPlanApprovalEvidenceQualityAndDeliveryEndToEnd() {
        AuthContext.set(new AuthPrincipal("u1", "User 1", Set.of("*"), "ws1"));
        InMemoryConversationStore conversations = new InMemoryConversationStore();
        String conversationId = conversations.create("u1", new ConversationCreateRequest("报告", List.of("ds1"), null)).id();
        InMemoryReportRunStore runs = new InMemoryReportRunStore();
        InMemoryReportStore reports = new InMemoryReportStore();
        ReportRunAppService service = new ReportRunAppService(runs, conversations, reports);

        ReportRunDetailVO created = service.create(conversationId,
                new ReportRunCreateRequest(brief("分析销售变化", "销售分析"), Map.of("maxTasks", 2), null, null));
        assertEquals("briefing", created.run().status());

        ReportRunDetailVO planned = service.updatePlan(conversationId, created.run().id(),
                new ReportPlanUpdateRequest(0, Map.of("title", "销售分析"),
                        List.of(Map.of("taskId", "trend", "title", "趋势", "task", "按月分析")), null, null));
        assertEquals("awaiting_plan_approval", planned.run().status());
        assertEquals(1, planned.run().planVersion());

        assertThrows(IllegalStateException.class, () -> service.confirmPlan(conversationId, created.run().id(),
                new ReportRunActionRequest("confirm_plan", null, 0, null, Map.of(), null, null, null)));
        ReportRunDetailVO running = service.confirmPlan(conversationId, created.run().id(),
                new ReportRunActionRequest("confirm_plan", null, 1, null, Map.of(), null, null, null));
        assertEquals("running", running.run().status());

        String taskId = running.tasks().getFirst().id();
        assertThrows(IllegalStateException.class, () -> service.action(conversationId, created.run().id(),
                new ReportRunActionRequest("pause", null, 0, null, Map.of(), "stale-pause", null, null)));
        ReportRunDetailVO paused = service.action(conversationId, created.run().id(),
                new ReportRunActionRequest("pause", null, 1, null, Map.of(), "pause-1", null, null));
        assertEquals("paused", paused.run().status());
        ReportRunDetailVO resumed = service.action(conversationId, created.run().id(),
                new ReportRunActionRequest("resume", null, 1, null, Map.of(), "resume-1", null, null));
        assertEquals("running", resumed.run().status());
        service.action(conversationId, created.run().id(),
                new ReportRunActionRequest("skip_task", taskId, 1, "暂无可用数据", Map.of(), "skip-1", null, null));
        ReportRunDetailVO retried = service.action(conversationId, created.run().id(),
                new ReportRunActionRequest("retry_task", taskId, 1, "数据恢复", Map.of(), "retry-1", null, null));
        assertEquals(2, retried.tasks().getFirst().attempt());
        assertEquals("pending", retried.tasks().getFirst().status());
        long eventCount = runs.listEvents(created.run().id(), 0L).size();
        service.action(conversationId, created.run().id(),
                new ReportRunActionRequest("retry_task", taskId, 1, "重复请求", Map.of(), "retry-1", null, null));
        assertEquals(eventCount, runs.listEvents(created.run().id(), 0L).size());

        ReportEvidenceVO evidence = service.appendEvidence(created.run().id(), new ReportEvidenceCreateRequest(
                null, "ds1", "query-1", Map.of("field", "sales"), List.of(), Map.of("label", "2026"),
                Map.of("name", "元"), Map.of(), "digest-1", Map.of("rowCount", 1), List.of(Map.of("month", "1月", "sales", 100))));
        ReportArtifactVO artifact = service.appendArtifact(created.run().id(), new ReportArtifactCreateRequest(
                null, "final_md", "sales.md", "text/markdown",
                "# 销售分析\n\n## 报告摘要\n\n销售额为 100 元。\n\n## 结论与建议\n\n持续观察。\n\n## 附录：证据\n\nds1。",
                1, null, null));
        service.appendArtifact(created.run().id(), new ReportArtifactCreateRequest(
                artifact.artifactVersion(), "final_html", "sales.html", "text/html",
                "<h1>销售分析</h1><h2>报告摘要</h2><p>销售额为 100 元。</p><h2>结论与建议</h2><p>持续观察。</p><h2>附录：证据</h2>",
                1, null, null));
        ReportRunDetailVO ready = service.updateQuality(created.run().id(), new ReportQualityUpdateRequest(
                Map.of("blockers", 0, "checks", Map.of("unit", true, "timeRange", true)),
                List.of(new ReportClaimCreateRequest(artifact.artifactVersion(), "summary", "fact", "销售额为 100 元",
                        List.of(evidence.id()), "high", null, null))));
        assertEquals("ready", ready.run().status());
        assertEquals("pass", ready.claims().getFirst().validationStatus());
        assertTrue(service.packageBytes(conversationId, created.run().id()).length > 100);
        assertNotNull(service.saveAsReport(conversationId, created.run().id()).reportId());

        AuthContext.set(new AuthPrincipal("u2", "User 2", Set.of("*"), "ws1"));
        assertThrows(IllegalArgumentException.class, () -> service.get(conversationId, created.run().id()));
    }

    @Test
    void blocksUngroundedClaims() {
        AuthContext.set(new AuthPrincipal("u1", "User 1", Set.of("*"), "ws1"));
        InMemoryConversationStore conversations = new InMemoryConversationStore();
        String conversationId = conversations.create("u1", new ConversationCreateRequest("报告", List.of(), null)).id();
        ReportRunAppService service = new ReportRunAppService(new InMemoryReportRunStore(), conversations, new InMemoryReportStore());
        ReportRunDetailVO created = service.create(conversationId,
                new ReportRunCreateRequest(brief("检查证据", "证据检查"), Map.of(), null, null));
        ReportRunDetailVO blocked = service.updateQuality(created.run().id(), new ReportQualityUpdateRequest(
                Map.of("blockers", 0), List.of(new ReportClaimCreateRequest(1, "summary", "fact", "无来源结论",
                        List.of("missing"), "low", "待补证据", null))));
        assertEquals("needs_action", blocked.run().status());
        assertTrue(((Number) blocked.run().quality().get("blockers")).intValue() >= 1);
    }

    @Test
    void cancelPreventsLateEvidenceArtifactsAndQualityWrites() {
        AuthContext.set(new AuthPrincipal("u1", "User 1", Set.of("*"), "ws1"));
        InMemoryConversationStore conversations = new InMemoryConversationStore();
        String conversationId = conversations.create("u1", new ConversationCreateRequest("报告", List.of("ds1"), null)).id();
        ReportRunAppService service = new ReportRunAppService(new InMemoryReportRunStore(), conversations, new InMemoryReportStore());
        ReportRunDetailVO created = service.create(conversationId,
                new ReportRunCreateRequest(brief("取消报告", "取消报告"), Map.of(), null, null));
        service.updatePlan(conversationId, created.run().id(), new ReportPlanUpdateRequest(0, Map.of(),
                List.of(Map.of("taskId", "one", "title", "任务", "task", "取数")), null, null));
        service.confirmPlan(conversationId, created.run().id(),
                new ReportRunActionRequest("confirm_plan", null, 1, null, Map.of(), null, null, null));
        ReportRunDetailVO cancelled = service.action(conversationId, created.run().id(),
                new ReportRunActionRequest("cancel", null, 1, "用户取消", Map.of(), "cancel-1", null, null));
        assertEquals("cancelled", cancelled.run().status());
        assertThrows(IllegalStateException.class, () -> service.appendEvidence(created.run().id(),
                new ReportEvidenceCreateRequest(null, "ds1", "late", Map.of(), List.of(), Map.of(), Map.of(), Map.of(),
                        "late", Map.of(), List.of())));
        assertThrows(IllegalStateException.class, () -> service.appendArtifact(created.run().id(),
                new ReportArtifactCreateRequest(null, "final_md", "late.md", "text/markdown", "late", 1, null, null)));
        assertThrows(IllegalStateException.class, () -> service.updateQuality(created.run().id(),
                new ReportQualityUpdateRequest(Map.of(), List.of())));
    }

    @Test
    void requiresCompleteBriefAndVersionsPlanWhenBriefChanges() {
        AuthContext.set(new AuthPrincipal("u1", "User 1", Set.of("*"), "ws1"));
        InMemoryConversationStore conversations = new InMemoryConversationStore();
        String conversationId = conversations.create("u1", new ConversationCreateRequest("报告", List.of("ds1"), null)).id();
        ReportRunAppService service = new ReportRunAppService(new InMemoryReportRunStore(), conversations, new InMemoryReportStore());

        ReportRunDetailVO incomplete = service.create(conversationId,
                new ReportRunCreateRequest(Map.of("goal", "分析销售"), Map.of(), null, null));
        assertTrue(((List<?>) incomplete.run().brief().get("missing")).contains("audience"));
        ReportRunDetailVO draftPlan = service.updatePlan(conversationId, incomplete.run().id(),
                new ReportPlanUpdateRequest(0, Map.of(), List.of(Map.of("taskId", "trend")), null, null));
        assertThrows(IllegalStateException.class, () -> service.confirmPlan(conversationId, incomplete.run().id(),
                new ReportRunActionRequest("confirm_plan", null, draftPlan.run().planVersion(), null, Map.of(), null, null, null)));

        ReportRunDetailVO confirmed = service.updateBrief(conversationId, incomplete.run().id(),
                new ReportBriefUpdateRequest(1, brief("分析销售", "销售分析"), null, null));
        Map<String, Object> revisedBrief = new java.util.LinkedHashMap<>(brief("分析销售与利润", "销售利润分析"));
        ReportRunDetailVO revised = service.updateBrief(conversationId, incomplete.run().id(),
                new ReportBriefUpdateRequest(confirmed.run().briefVersion(), revisedBrief, null, null));
        assertEquals(3, revised.run().briefVersion());
        assertEquals(draftPlan.run().planVersion() + 2, revised.run().planVersion());
        assertEquals("awaiting_plan_approval", revised.run().status());
        assertEquals("trend", revised.tasks().getFirst().taskKey());
    }

    @Test
    void partialRewriteCreatesNewArtifactVersionWithoutNewEvidenceAndRevalidates() {
        AuthContext.set(new AuthPrincipal("u1", "User 1", Set.of("*"), "ws1"));
        InMemoryConversationStore conversations = new InMemoryConversationStore();
        String conversationId = conversations.create("u1", new ConversationCreateRequest("报告", List.of("ds1"), null)).id();
        ReportRunAppService service = new ReportRunAppService(new InMemoryReportRunStore(), conversations, new InMemoryReportStore());
        ReportRunDetailVO created = service.create(conversationId,
                new ReportRunCreateRequest(brief("分析销售", "销售分析"), Map.of(), null, null));
        ReportEvidenceVO evidence = service.appendEvidence(created.run().id(), new ReportEvidenceCreateRequest(
                null, "ds1", "query-1", Map.of("field", "sales"), List.of(), Map.of("label", "2026"),
                Map.of("name", "元"), Map.of(), "digest-1", Map.of("total", 100), List.of(Map.of("sales", 100))));
        String source = "# 销售分析\n\n## 报告摘要\n\n销售额为 100 元。\n\n## 行动建议\n\n持续跟踪销售额变化。\n\n## 附录：证据\n\nds1。";
        ReportArtifactVO artifact = service.appendArtifact(created.run().id(), new ReportArtifactCreateRequest(
                null, "final_md", "sales.md", "text/markdown", source, 7, null, null));
        service.appendArtifact(created.run().id(), new ReportArtifactCreateRequest(artifact.artifactVersion(),
                "final_html", "sales.html", "text/html", "<h1>销售分析</h1>", 7, null, null));
        ReportRunDetailVO ready = service.updateQuality(created.run().id(), new ReportQualityUpdateRequest(Map.of(),
                List.of(new ReportClaimCreateRequest(artifact.artifactVersion(), "summary", "fact", "销售额为 100 元",
                        List.of(evidence.id()), "high", null, null))));
        assertEquals("ready", ready.run().status());

        String rewritten = "# 销售分析\n\n## 报告摘要\n\n销售额为 100 元，整体表现稳定。\n\n## 行动建议\n\n每周跟踪销售额变化并由经营负责人复盘。\n\n## 附录：证据\n\nds1。";
        ReportRunDetailVO next = service.rewrite(conversationId, created.run().id(),
                new ReportRewriteRequest(artifact.artifactVersion(), "summary", "精简摘要", rewritten, null, null));
        assertEquals("ready", next.run().status());
        assertEquals(1, next.evidence().size());
        assertEquals(artifact.artifactVersion() + 1, next.run().activeArtifactVersion());
        List<ReportArtifactVO> rewrittenArtifacts = next.artifacts().stream()
                .filter(row -> row.artifactVersion().equals(next.run().activeArtifactVersion())).toList();
        assertEquals(Set.of("final_md", "final_html"), rewrittenArtifacts.stream().map(ReportArtifactVO::kind).collect(java.util.stream.Collectors.toSet()));
        assertTrue(rewrittenArtifacts.stream().allMatch(row -> row.evidenceSetVersion() == 7 && row.parentVersion().equals(artifact.artifactVersion())));
        assertEquals(1, ((Number) next.run().quality().get("repairAttempt")).intValue());
        assertThrows(IllegalStateException.class, () -> service.rewrite(conversationId, created.run().id(),
                new ReportRewriteRequest(next.run().activeArtifactVersion(), "summary", "新增指标并重新取数", rewritten, null, null)));
    }

    private static Map<String, Object> brief(String goal, String title) {
        return Map.of("goal", goal, "title", title, "audience", "经营负责人", "datasets", List.of("ds1"),
                "timeRange", Map.of("from", "2026-01-01", "to", "2026-01-31"),
                "metrics", List.of(Map.of("field", "sales", "agg", "sum", "unit", "元")),
                "comparison", Map.of("type", "previous_period"),
                "output", Map.of("tone", "business", "formats", List.of("html", "markdown")),
                "ambiguities", List.of(), "confirmed", true);
    }
}
