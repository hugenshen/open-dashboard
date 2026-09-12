package io.opendashboard.application.report;

import io.opendashboard.domain.ConversationDtos.ConversationVO;
import io.opendashboard.domain.ReportDtos.ReportCreateRequest;
import io.opendashboard.domain.ReportDtos.ReportDetailVO;
import io.opendashboard.domain.ReportDtos.ReportDocUpdateRequest;
import io.opendashboard.domain.ReportRunDtos.*;
import io.opendashboard.domain.context.AuthContext;
import io.opendashboard.domain.context.AuthPrincipal;
import io.opendashboard.domain.gateway.ConversationGateway;
import io.opendashboard.domain.gateway.ReportGateway;
import io.opendashboard.domain.gateway.ReportRunGateway;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

@Service
public class ReportRunAppService {
    private static final Set<String> TERMINAL = Set.of("ready", "cancelled", "failed");
    private static final ObjectMapper JSON = new ObjectMapper();
    private final ReportRunGateway runs;
    private final ConversationGateway conversations;
    private final ReportGateway reports;
    private static final Pattern NUMBER = Pattern.compile("(?<![\\w.-])-?\\d+(?:,\\d{3})*(?:\\.\\d+)?%?");
    private static final Pattern TIME_TOKEN = Pattern.compile("(?:20\\d{2}(?:[-/.年]\\d{1,2}(?:[-/.月]\\d{1,2}日?)?)?|\\d{1,2}月)");

    public ReportRunAppService(ReportRunGateway runs, ConversationGateway conversations, ReportGateway reports) {
        this.runs = runs;
        this.conversations = conversations;
        this.reports = reports;
    }

    public ReportRunDetailVO create(String conversationId, ReportRunCreateRequest request) {
        ConversationVO conversation = ownedConversation(conversationId);
        ReportRunCreateRequest req = request == null
                ? new ReportRunCreateRequest(Map.of(), Map.of(), null, null) : request;
        requireBriefGoal(req.brief());
        AuthPrincipal principal = AuthContext.require();
        Map<String, Object> brief = normalizedBrief(req.brief());
        ReportRunVO run = runs.create(conversation.id(), principal.workspaceId(), principal.userId(), brief, normalizedBudget(req.budget()));
        event(run.id(), null, "business", "brief_ready", Map.of("briefVersion", run.briefVersion(), "missing", brief.get("missing")));
        return detail(run);
    }

    public ReportRunDetailVO get(String conversationId, String runId) { return detail(scoped(conversationId, runId)); }

    public ReportRunDetailVO latest(String conversationId) {
        ownedConversation(conversationId);
        AuthPrincipal principal = AuthContext.require();
        return runs.findLatest(conversationId, principal.workspaceId(), principal.userId()).map(this::detail)
                .orElseThrow(() -> new IllegalArgumentException("REPORT_RUN_NOT_FOUND"));
    }

    public ReportRunDetailVO updateBrief(String conversationId, String runId, ReportBriefUpdateRequest request) {
        ReportRunVO run = scoped(conversationId, runId);
        if (request == null || request.expectedVersion() == null || !request.expectedVersion().equals(run.briefVersion())) {
            throw new IllegalStateException("BRIEF_VERSION_CONFLICT");
        }
        if (!("briefing".equals(run.status()) || "awaiting_plan_approval".equals(run.status()))) {
            throw new IllegalStateException("BRIEF_LOCKED_AFTER_EXECUTION");
        }
        requireBriefGoal(request.brief());
        Map<String, Object> brief = normalizedBrief(request.brief());
        List<ReportTaskVO> currentTasks = runs.listTasks(runId).stream()
                .filter(task -> task.planVersion().equals(run.planVersion())).toList();
        boolean preservePlan = "awaiting_plan_approval".equals(run.status()) && !currentTasks.isEmpty();
        int nextPlanVersion = preservePlan ? run.planVersion() + 1 : run.planVersion();
        if (preservePlan) runs.replaceTasks(runId, nextPlanVersion, currentTasks.stream().map(ReportTaskVO::spec).toList());
        ReportRunVO next = runs.updateRun(runId, preservePlan ? "awaiting_plan_approval" : "briefing",
                brief, run.briefVersion() + 1, preservePlan ? null : Map.of(), nextPlanVersion,
                null, null, null).orElseThrow();
        event(runId, null, "business", "brief_updated", Map.of("briefVersion", next.briefVersion(),
                "planVersion", next.planVersion(), "missing", brief.get("missing")));
        return detail(next);
    }

    public ReportRunDetailVO updatePlan(String conversationId, String runId, ReportPlanUpdateRequest request) {
        ReportRunVO run = scoped(conversationId, runId);
        if (request == null || request.expectedVersion() == null || !request.expectedVersion().equals(run.planVersion())) {
            throw new IllegalStateException("PLAN_VERSION_CONFLICT");
        }
        if (TERMINAL.contains(run.status()) || "running".equals(run.status()) || "quality_check".equals(run.status())) {
            throw new IllegalStateException("PLAN_LOCKED_IN_CURRENT_STATE");
        }
        if (request.tasks().isEmpty()) throw new IllegalArgumentException("PLAN_TASKS_REQUIRED");
        if (request.tasks().size() > number(run.budget().get("maxTasks"), 4)) throw new IllegalArgumentException("REPORT_TASK_BUDGET_EXCEEDED");
        validateTaskGraph(request.tasks());
        int nextVersion = run.planVersion() + 1;
        runs.replaceTasks(runId, nextVersion, request.tasks());
        ReportRunVO next = runs.updateRun(runId, "awaiting_plan_approval", null, null,
                request.plan(), nextVersion, null, null, null).orElseThrow();
        event(runId, null, "business", "plan_ready", Map.of("planVersion", nextVersion, "taskCount", request.tasks().size()));
        return detail(next);
    }

    public ReportRunDetailVO confirmPlan(String conversationId, String runId, ReportRunActionRequest request) {
        ReportRunVO run = scoped(conversationId, runId);
        if (!"awaiting_plan_approval".equals(run.status())) throw new IllegalStateException("RUN_NOT_AWAITING_PLAN");
        requireConfirmedBrief(run.brief());
        Integer expected = request == null ? null : request.expectedPlanVersion();
        if (expected == null || !expected.equals(run.planVersion())) throw new IllegalStateException("PLAN_VERSION_CONFLICT");
        ReportRunVO next = runs.updateRun(runId, "running", null, null, null, null,
                run.planVersion(), null, null).orElseThrow();
        event(runId, null, "business", "plan_confirmed", Map.of("planVersion", run.planVersion()));
        return detail(next);
    }

    public ReportRunDetailVO action(String conversationId, String runId, ReportRunActionRequest request) {
        ReportRunVO run = scoped(conversationId, runId);
        if (request == null || request.action() == null || request.action().isBlank()) {
            throw new IllegalArgumentException("ACTION_REQUIRED");
        }
        if (request.idempotencyKey() != null && !request.idempotencyKey().isBlank()) {
            boolean seen = runs.listEvents(runId, 0L).stream().anyMatch(e -> request.idempotencyKey().equals(e.payload().get("idempotencyKey")));
            if (seen) return detail(run);
        }
        if (request.expectedPlanVersion() == null || !request.expectedPlanVersion().equals(run.planVersion())) {
            throw new IllegalStateException("PLAN_VERSION_CONFLICT");
        }
        switch (request.action()) {
            case "pause" -> run = transition(run, Set.of("running"), "paused");
            case "resume" -> run = transition(run, Set.of("paused", "needs_action"), "running");
            case "cancel" -> {
                if (TERMINAL.contains(run.status())) throw new IllegalStateException("RUN_ALREADY_TERMINAL");
                run = transition(run, Set.of("briefing", "awaiting_plan_approval", "running", "paused", "needs_action", "quality_check"), "cancelled");
            }
            case "retry_task" -> {
                ReportTaskVO task = taskForRun(runId, request.taskId());
                if (!Set.of("failed", "needs_action", "skipped").contains(task.status())) throw new IllegalStateException("TASK_NOT_RETRYABLE");
                runs.updateTask(task.id(), "pending", task.attempt() + 1, null, null);
                run = runs.updateRun(runId, "running", null, null, null, null, null, null, null).orElseThrow();
            }
            case "skip_task" -> {
                ReportTaskVO task = taskForRun(runId, request.taskId());
                if (!Set.of("pending", "failed", "needs_action").contains(task.status())) throw new IllegalStateException("TASK_NOT_SKIPPABLE");
                runs.updateTask(task.id(), "skipped", null, null, text(request.reason(), "user_skip"));
            }
            case "update_task" -> {
                ReportTaskVO task = taskForRun(runId, request.taskId());
                if (!Set.of("pending", "failed", "needs_action").contains(task.status())) throw new IllegalStateException("TASK_NOT_EDITABLE");
                Map<String, Object> spec = new LinkedHashMap<>(task.spec());
                spec.putAll(request.patch());
                runs.updateTask(task.id(), "pending", task.attempt(), spec, null);
            }
            default -> throw new IllegalArgumentException("UNKNOWN_ACTION");
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("action", request.action());
        if (request.taskId() != null) payload.put("taskId", request.taskId());
        if (request.reason() != null) payload.put("reason", request.reason());
        if (request.idempotencyKey() != null) payload.put("idempotencyKey", request.idempotencyKey());
        event(runId, request.taskId(), "business", "action_applied", payload);
        return detail(runs.find(runId).orElse(run));
    }

    public List<ReportEventVO> events(String conversationId, String runId, Long afterId) {
        scoped(conversationId, runId);
        return runs.listEvents(runId, afterId);
    }

    public List<ReportClaimVO> claims(String conversationId, String runId) { scoped(conversationId, runId); return runs.listClaims(runId); }
    public List<ReportArtifactVO> artifacts(String conversationId, String runId) { scoped(conversationId, runId); return runs.listArtifacts(runId); }

    public ReportEventVO appendEvent(String runId, ReportEventCreateRequest request) {
        internalScoped(runId);
        return runs.appendEvent(runId, request);
    }

    public ReportEvidenceVO appendEvidence(String runId, ReportEvidenceCreateRequest request) {
        ensureWritable(internalScoped(runId));
        ReportEvidenceVO row = runs.appendEvidence(runId, request);
        event(runId, request.taskId(), "technical", "evidence_captured", Map.of("evidenceId", row.id(), "datasetId", row.datasetId()));
        return row;
    }

    public ReportArtifactVO appendArtifact(String runId, ReportArtifactCreateRequest request) {
        ReportRunVO run = ensureWritable(internalScoped(runId));
        ReportArtifactVO artifact = runs.appendArtifact(runId, request);
        String status = request.kind() != null && request.kind().startsWith("final_") ? "quality_check" : run.status();
        runs.updateRun(runId, status, null, null, null, null, null, null, artifact.artifactVersion());
        event(runId, null, "business", "artifact_created", Map.of("artifactVersion", artifact.artifactVersion(), "kind", artifact.kind()));
        return artifact;
    }

    public ReportRunDetailVO updateQuality(String runId, ReportQualityUpdateRequest request) {
        ReportRunVO run = ensureWritable(internalScoped(runId));
        List<ReportEvidenceVO> evidence = runs.listEvidence(runId);
        ReportQualityValidator.Result result = ReportQualityValidator.validate(run,
                runs.listTasks(runId).stream().filter(t -> t.planVersion().equals(run.planVersion())).toList(),
                evidence, runs.listArtifacts(runId), request);
        runs.replaceClaims(runId, result.claims());
        String status = result.blockers() == 0 ? "ready" : "needs_action";
        ReportRunVO next = runs.updateRun(runId, status, null, null, null, null, null,
                result.quality(), run.activeArtifactVersion()).orElseThrow();
        event(runId, null, "business", "quality_completed", Map.of("status", result.quality().get("status"),
                "blockers", result.blockers(), "issues", result.quality().get("reviewer")));
        return detail(next);
    }

    public ReportRunDetailVO rewrite(String conversationId, String runId, ReportRewriteRequest request) {
        ReportRunVO run = scoped(conversationId, runId);
        if (!Set.of("ready", "needs_action").contains(run.status())) throw new IllegalStateException("REWRITE_NOT_AVAILABLE");
        ReportArtifactVO source = activeArtifact(runId, request.sourceArtifactVersion());
        if (request.content() == null || request.content().isBlank()) throw new IllegalArgumentException("REWRITE_CONTENT_REQUIRED");
        if (Pattern.compile("新增|新指标|换时间|改变时间|新筛选|重新取数").matcher(text(request.instruction(), "")).find())
            throw new IllegalStateException("REWRITE_REQUIRES_NEW_QUERY");
        ReportArtifactVO next = runs.appendArtifact(runId, new ReportArtifactCreateRequest(null, "final_md",
                replaceExtension(source.filename(), ".md"), "text/markdown", request.content(), source.evidenceSetVersion(),
                source.artifactVersion(), text(request.scope(), "partial_rewrite")));
        runs.appendArtifact(runId, new ReportArtifactCreateRequest(next.artifactVersion(), "final_html",
                replaceExtension(source.filename(), ".html"), "text/html", markdownHtml(request.content()),
                source.evidenceSetVersion(), source.artifactVersion(), text(request.scope(), "partial_rewrite")));
        runs.updateRun(runId, "quality_check", null, null, null, null, null, Map.of(), next.artifactVersion());
        event(runId, null, "business", "rewrite_created", Map.of("sourceVersion", source.artifactVersion(),
                "artifactVersion", next.artifactVersion(), "scope", text(request.scope(), "partial_rewrite"),
                "evidenceSetVersion", source.evidenceSetVersion()));
        List<ReportClaimCreateRequest> copied = runs.listClaims(runId).stream().map(claim ->
                new ReportClaimCreateRequest(next.artifactVersion(), claim.sectionId(), claim.claimType(),
                        claim.statement(), claim.evidenceRefs(), claim.confidence(), claim.caveat(), null)).toList();
        int attempt = number(run.quality().get("repairAttempt"), 0) + 1;
        return updateQuality(runId, new ReportQualityUpdateRequest(Map.of("repairAttempt", attempt), copied));
    }

    public byte[] packageBytes(String conversationId, String runId) {
        ReportRunVO run = scoped(conversationId, runId);
        try {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (ZipOutputStream zip = new ZipOutputStream(bytes, StandardCharsets.UTF_8)) {
                for (ReportArtifactVO artifact : runs.listArtifacts(runId)) {
                    addZip(zip, "artifacts/v" + artifact.artifactVersion() + "-" + artifact.filename(), artifact.content());
                }
                addZip(zip, "evidence.json", jsonLike(runs.listEvidence(runId)));
                addZip(zip, "claims.json", jsonLike(runs.listClaims(runId)));
                addZip(zip, "quality.json", jsonLike(run.quality()));
                addZip(zip, "brief.json", jsonLike(run.brief()));
                Map<String, Object> planPackage = new LinkedHashMap<>();
                planPackage.put("version", run.planVersion());
                planPackage.put("approvedVersion", run.approvedPlanVersion());
                planPackage.put("plan", run.plan());
                planPackage.put("tasks", runs.listTasks(runId));
                addZip(zip, "plan.json", jsonLike(planPackage));
                addZip(zip, "manifest.json", jsonLike(Map.of("runId", run.id(), "status", run.status(),
                        "artifactVersion", run.activeArtifactVersion(), "generatedAt", System.currentTimeMillis())));
            }
            return bytes.toByteArray();
        } catch (Exception e) { throw new IllegalStateException("PACKAGE_FAILED", e); }
    }

    public SaveAsReportVO saveAsReport(String conversationId, String runId) {
        ReportRunVO run = scoped(conversationId, runId);
        if (!"ready".equals(run.status())) throw new IllegalStateException("REPORT_NOT_QUALITY_READY");
        ReportArtifactVO artifact = activeArtifact(runId, run.activeArtifactVersion());
        String title = text(run.brief().get("title"), "AI 分析报告");
        ReportDetailVO report = reports.create(new ReportCreateRequest(title));
        Map<String, Object> textNode = Map.of("type", "text", "text", artifact.content());
        Map<String, Object> paragraph = Map.of("type", "paragraph", "content", List.of(textNode));
        reports.updateDoc(report.meta().id(), new ReportDocUpdateRequest(Map.of("type", "doc", "content", List.of(paragraph)), report.meta().contentId()));
        event(runId, null, "business", "saved_as_report", Map.of("reportId", report.meta().id()));
        return new SaveAsReportVO(report.meta().id(), "/reports/" + report.meta().id() + "/edit");
    }

    public boolean terminal(String runId) { return runs.find(runId).map(r -> TERMINAL.contains(r.status())).orElse(true); }

    private ReportRunVO transition(ReportRunVO run, Set<String> from, String to) {
        if (!from.contains(run.status())) throw new IllegalStateException("ILLEGAL_RUN_TRANSITION");
        return runs.updateRun(run.id(), to, null, null, null, null, null, null, null).orElseThrow();
    }
    private ReportTaskVO taskForRun(String runId, String taskId) {
        if (taskId == null || taskId.isBlank()) throw new IllegalArgumentException("TASK_ID_REQUIRED");
        return runs.findTask(taskId).filter(t -> runId.equals(t.runId())).orElseThrow(() -> new IllegalArgumentException("TASK_NOT_FOUND"));
    }
    private ConversationVO ownedConversation(String conversationId) {
        String owner = AuthContext.require().userId();
        return conversations.find(conversationId).filter(c -> owner.equals(c.ownerId()))
                .orElseThrow(() -> new IllegalArgumentException("CONVERSATION_NOT_FOUND"));
    }
    private ReportRunVO scoped(String conversationId, String runId) {
        ownedConversation(conversationId);
        AuthPrincipal p = AuthContext.require();
        return runs.find(runId).filter(r -> conversationId.equals(r.conversationId()))
                .filter(r -> p.userId().equals(r.ownerId()) && p.workspaceId().equals(r.workspaceId()))
                .orElseThrow(() -> new IllegalArgumentException("REPORT_RUN_NOT_FOUND"));
    }
    private ReportRunVO internalScoped(String runId) {
        AuthPrincipal p = AuthContext.require();
        return runs.find(runId).filter(r -> p.userId().equals(r.ownerId()) && p.workspaceId().equals(r.workspaceId()))
                .orElseThrow(() -> new IllegalArgumentException("REPORT_RUN_NOT_FOUND"));
    }
    private static ReportRunVO ensureWritable(ReportRunVO run) {
        if (TERMINAL.contains(run.status())) throw new IllegalStateException("REPORT_RUN_TERMINAL");
        return run;
    }
    private ReportRunDetailVO detail(ReportRunVO run) {
        List<ReportTaskVO> currentTasks = runs.listTasks(run.id()).stream()
                .filter(task -> task.planVersion().equals(run.planVersion())).toList();
        return new ReportRunDetailVO(run, currentTasks, runs.listEvidence(run.id()), runs.listArtifacts(run.id()), runs.listClaims(run.id()));
    }
    private ReportArtifactVO activeArtifact(String runId, Integer version) {
        int target = version == null || version <= 0
                ? runs.listArtifacts(runId).stream().mapToInt(ReportArtifactVO::artifactVersion).max().orElse(0) : version;
        return runs.listArtifacts(runId).stream().filter(a -> a.artifactVersion() == target && "final_md".equals(a.kind()))
                .findFirst().orElseGet(() -> runs.listArtifacts(runId).stream()
                        .filter(a -> a.artifactVersion() == target && a.kind().startsWith("final_"))
                        .findFirst().orElseThrow(() -> new IllegalStateException("ACTIVE_ARTIFACT_NOT_FOUND")));
    }
    private ReportEventVO event(String runId, String taskId, String audience, String type, Map<String, Object> payload) {
        return runs.appendEvent(runId, new ReportEventCreateRequest(taskId, audience, type, payload));
    }
    private static void requireBriefGoal(Map<String, Object> brief) {
        if (brief == null || text(brief.get("goal"), "").isBlank()) throw new IllegalArgumentException("BRIEF_GOAL_REQUIRED");
    }
    private static void requireConfirmedBrief(Map<String, Object> brief) {
        List<String> issues = briefIssues(brief);
        if (!issues.isEmpty()) throw new IllegalStateException("BRIEF_CONFIRMATION_REQUIRED:" + String.join(",", issues));
    }
    private static Map<String, Object> normalizedBrief(Map<String, Object> source) {
        Map<String, Object> brief = new LinkedHashMap<>(source == null ? Map.of() : source);
        brief.put("missing", briefIssuesWithoutConfirmation(brief));
        return Map.copyOf(brief);
    }
    private static List<String> briefIssues(Map<String, Object> brief) {
        List<String> issues = new ArrayList<>(briefIssuesWithoutConfirmation(brief));
        Object ambiguities = brief == null ? null : brief.get("ambiguities");
        if (ambiguities instanceof List<?> list && !list.isEmpty()) issues.add("ambiguities");
        if (!Boolean.TRUE.equals(brief == null ? null : brief.get("confirmed"))) issues.add("confirmed");
        return issues.stream().distinct().toList();
    }
    private static List<String> briefIssuesWithoutConfirmation(Map<String, Object> brief) {
        List<String> missing = new ArrayList<>();
        if (brief == null) return List.of("goal", "audience", "datasets", "timeRange", "metrics", "comparison", "output");
        if (text(brief.get("goal"), "").isBlank()) missing.add("goal");
        if (text(brief.get("audience"), "").isBlank()) missing.add("audience");
        Object datasets = brief.containsKey("datasetIds") ? brief.get("datasetIds") : brief.get("datasets");
        if (!(datasets instanceof List<?> list) || list.isEmpty()) missing.add("datasets");
        if (!(brief.get("timeRange") instanceof Map<?, ?> map) || map.isEmpty()) missing.add("timeRange");
        if (!(brief.get("metrics") instanceof List<?> list) || list.isEmpty()) missing.add("metrics");
        if (!(brief.get("comparison") instanceof Map<?, ?> map) || map.isEmpty()) missing.add("comparison");
        Object output = brief.get("output");
        if (!((output instanceof Map<?, ?> map && !map.isEmpty()) || (output instanceof List<?> list && !list.isEmpty()))) missing.add("output");
        return missing;
    }
    private static Map<String, Object> normalizedBudget(Map<String, Object> source) {
        Map<String, Object> budget = new LinkedHashMap<>();
        budget.put("maxTasks", clamp(number(source == null ? null : source.get("maxTasks"), 4), 1, 8));
        budget.put("concurrency", clamp(number(source == null ? null : source.get("concurrency"), 2), 1, 4));
        budget.put("maxQueries", clamp(number(source == null ? null : source.get("maxQueries"), 16), 1, 40));
        budget.put("maxPythonCalls", clamp(number(source == null ? null : source.get("maxPythonCalls"), 4), 0, 12));
        budget.put("maxRows", clamp(number(source == null ? null : source.get("maxRows"), 200), 1, 200));
        budget.put("queryTimeoutSeconds", clamp(number(source == null ? null : source.get("queryTimeoutSeconds"), 15), 1, 15));
        budget.put("totalTimeoutSeconds", clamp(number(source == null ? null : source.get("totalTimeoutSeconds"), 900), 30, 1800));
        return Map.copyOf(budget);
    }
    private static void validateTaskGraph(List<Map<String, Object>> tasks) {
        Set<String> ids = new HashSet<>();
        for (int i = 0; i < tasks.size(); i++) {
            String id = text(tasks.get(i).get("taskId"), "task-" + (i + 1));
            if (!ids.add(id)) throw new IllegalArgumentException("DUPLICATE_TASK_ID:" + id);
        }
        for (Map<String, Object> task : tasks) {
            Object deps = task.get("dependsOn");
            if (deps instanceof List<?> list) for (Object dep : list) {
                if (!ids.contains(String.valueOf(dep))) throw new IllegalArgumentException("UNKNOWN_TASK_DEPENDENCY:" + dep);
                if (String.valueOf(dep).equals(text(task.get("taskId"), ""))) throw new IllegalArgumentException("CYCLIC_TASK_DEPENDENCY");
            }
        }
        for (Map<String, Object> task : tasks) detectCycle(text(task.get("taskId"), ""), tasks, new HashSet<>(), new HashSet<>());
    }
    private static void detectCycle(String id, List<Map<String, Object>> tasks, Set<String> visiting, Set<String> visited) {
        if (visited.contains(id)) return;
        if (!visiting.add(id)) throw new IllegalArgumentException("CYCLIC_TASK_DEPENDENCY");
        tasks.stream().filter(t -> id.equals(text(t.get("taskId"), ""))).findFirst().ifPresent(task -> {
            if (task.get("dependsOn") instanceof List<?> deps) for (Object dep : deps) detectCycle(String.valueOf(dep), tasks, visiting, visited);
        });
        visiting.remove(id); visited.add(id);
    }
    private static int number(Object value, int fallback) {
        if (value instanceof Number n) return n.intValue();
        try { return value == null ? fallback : Integer.parseInt(String.valueOf(value)); }
        catch (Exception ignored) { return fallback; }
    }
    private static int number(Object value) { return number(value, 0); }
    private static int clamp(int value, int min, int max) { return Math.max(min, Math.min(max, value)); }
    private static String text(Object value, String fallback) {
        String out = value == null ? "" : String.valueOf(value).trim();
        return out.isEmpty() ? fallback : out;
    }
    private static void addZip(ZipOutputStream zip, String name, String content) throws Exception {
        zip.putNextEntry(new ZipEntry(name));
        zip.write((content == null ? "" : content).getBytes(StandardCharsets.UTF_8));
        zip.closeEntry();
    }
    private static String jsonLike(Object value) {
        try { return JSON.writeValueAsString(value); }
        catch (Exception error) { throw new IllegalArgumentException("PACKAGE_JSON_FAILED", error); }
    }
    private static String replaceExtension(String filename, String extension) {
        String name = text(filename, "analysis-report.md");
        return name.replaceFirst("(?i)\\.(?:html?|md|markdown)$", "") + extension;
    }
    private static String markdownHtml(String markdown) {
        String escaped = text(markdown, "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
        StringBuilder html = new StringBuilder("<article>");
        for (String line : escaped.split("\\R")) {
            if (line.startsWith("### ")) html.append("<h3>").append(line.substring(4)).append("</h3>");
            else if (line.startsWith("## ")) html.append("<h2>").append(line.substring(3)).append("</h2>");
            else if (line.startsWith("# ")) html.append("<h1>").append(line.substring(2)).append("</h1>");
            else if (!line.isBlank()) html.append("<p>").append(line).append("</p>");
        }
        return html.append("</article>").toString();
    }
}
