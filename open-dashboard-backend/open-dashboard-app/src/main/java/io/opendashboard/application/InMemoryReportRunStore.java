package io.opendashboard.application;

import io.opendashboard.domain.ReportRunDtos.*;
import io.opendashboard.domain.gateway.ReportRunGateway;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

@Service
@Profile("stub")
public class InMemoryReportRunStore implements ReportRunGateway {
    private final AtomicLong seq = new AtomicLong(1000);
    private final Map<String, ReportRunVO> runs = new ConcurrentHashMap<>();
    private final Map<String, ReportTaskVO> tasks = new ConcurrentHashMap<>();
    private final Map<String, List<ReportEventVO>> events = new ConcurrentHashMap<>();
    private final Map<String, List<ReportEvidenceVO>> evidence = new ConcurrentHashMap<>();
    private final Map<String, List<ReportArtifactVO>> artifacts = new ConcurrentHashMap<>();
    private final Map<String, List<ReportClaimVO>> claims = new ConcurrentHashMap<>();

    @Override
    public ReportRunVO create(String conversationId, String workspaceId, String ownerId,
                              Map<String, Object> brief, Map<String, Object> budget) {
        String id = id();
        long now = System.currentTimeMillis();
        ReportRunVO run = new ReportRunVO(id, conversationId, workspaceId, ownerId, "briefing",
                copy(brief), 1, Map.of(), 0, null, copy(budget), Map.of(), 0, now, now);
        runs.put(id, run);
        events.put(id, new ArrayList<>());
        evidence.put(id, new ArrayList<>());
        artifacts.put(id, new ArrayList<>());
        claims.put(id, new ArrayList<>());
        return run;
    }

    @Override public Optional<ReportRunVO> find(String runId) { return Optional.ofNullable(runs.get(runId)); }

    @Override
    public Optional<ReportRunVO> findLatest(String conversationId, String workspaceId, String ownerId) {
        return runs.values().stream()
                .filter(r -> conversationId.equals(r.conversationId()) && workspaceId.equals(r.workspaceId()) && ownerId.equals(r.ownerId()))
                .max(Comparator.comparing(ReportRunVO::createTime).thenComparing(ReportRunVO::id));
    }

    @Override
    public Optional<ReportRunVO> updateRun(String runId, String status, Map<String, Object> brief,
            Integer briefVersion, Map<String, Object> plan, Integer planVersion,
            Integer approvedPlanVersion, Map<String, Object> quality, Integer activeArtifactVersion) {
        ReportRunVO cur = runs.get(runId);
        if (cur == null) return Optional.empty();
        ReportRunVO next = new ReportRunVO(cur.id(), cur.conversationId(), cur.workspaceId(), cur.ownerId(),
                status == null ? cur.status() : status,
                brief == null ? cur.brief() : copy(brief), briefVersion == null ? cur.briefVersion() : briefVersion,
                plan == null ? cur.plan() : copy(plan), planVersion == null ? cur.planVersion() : planVersion,
                approvedPlanVersion == null ? cur.approvedPlanVersion() : approvedPlanVersion,
                cur.budget(), quality == null ? cur.quality() : copy(quality),
                activeArtifactVersion == null ? cur.activeArtifactVersion() : activeArtifactVersion,
                cur.createTime(), System.currentTimeMillis());
        runs.put(runId, next);
        return Optional.of(next);
    }

    @Override
    public List<ReportTaskVO> replaceTasks(String runId, int planVersion, List<Map<String, Object>> rows) {
        tasks.entrySet().removeIf(e -> runId.equals(e.getValue().runId()) && e.getValue().planVersion() == planVersion);
        int ordinal = 0;
        for (Map<String, Object> row : rows) {
            String taskId = id();
            String key = text(row.get("taskId"), "task-" + (++ordinal));
            long now = System.currentTimeMillis();
            tasks.put(taskId, new ReportTaskVO(taskId, runId, planVersion, key, "pending", 1,
                    strings(row.get("dependsOn")), copy(row), map(row.get("budget")), null, now, now));
        }
        return listTasks(runId);
    }

    @Override
    public List<ReportTaskVO> listTasks(String runId) {
        return tasks.values().stream().filter(t -> runId.equals(t.runId()))
                .sorted(Comparator.comparing(ReportTaskVO::planVersion).thenComparing(ReportTaskVO::id)).toList();
    }

    @Override public Optional<ReportTaskVO> findTask(String taskId) { return Optional.ofNullable(tasks.get(taskId)); }

    @Override
    public Optional<ReportTaskVO> updateTask(String taskId, String status, Integer attempt,
            Map<String, Object> spec, String skipReason) {
        ReportTaskVO cur = tasks.get(taskId);
        if (cur == null) return Optional.empty();
        ReportTaskVO next = new ReportTaskVO(cur.id(), cur.runId(), cur.planVersion(), cur.taskKey(),
                status == null ? cur.status() : status, attempt == null ? cur.attempt() : attempt,
                cur.dependsOn(), spec == null ? cur.spec() : copy(spec), cur.budget(),
                skipReason == null ? cur.skipReason() : skipReason, cur.createTime(), System.currentTimeMillis());
        tasks.put(taskId, next);
        return Optional.of(next);
    }

    @Override
    public ReportEventVO appendEvent(String runId, ReportEventCreateRequest request) {
        ReportEventVO row = new ReportEventVO(id(), runId, request.taskId(),
                text(request.audience(), "business"), text(request.eventType(), "progress"),
                copy(request.payload()), System.currentTimeMillis());
        synchronized (events) { events.computeIfAbsent(runId, ignored -> new ArrayList<>()).add(row); }
        return row;
    }

    @Override
    public List<ReportEventVO> listEvents(String runId, Long afterId) {
        long cursor = afterId == null ? 0L : afterId;
        return List.copyOf(events.getOrDefault(runId, List.of())).stream()
                .filter(e -> Long.parseLong(e.id()) > cursor).toList();
    }

    @Override
    public ReportEvidenceVO appendEvidence(String runId, ReportEvidenceCreateRequest request) {
        ReportEvidenceVO row = new ReportEvidenceVO(id(), runId, request.taskId(),
                text(request.datasetId(), "unknown"), text(request.queryFingerprint(), "unknown"),
                copy(request.metric()), request.filters() == null ? List.of() : List.copyOf(request.filters()),
                copy(request.timeRange()), copy(request.unit()), copy(request.denominator()),
                text(request.resultDigest(), digest(String.valueOf(request.resultSummary()))),
                copy(request.resultSummary()), request.sampleRows() == null ? List.of() : List.copyOf(request.sampleRows()),
                System.currentTimeMillis());
        synchronized (evidence) { evidence.computeIfAbsent(runId, ignored -> new ArrayList<>()).add(row); }
        return row;
    }

    @Override public List<ReportEvidenceVO> listEvidence(String runId) { return List.copyOf(evidence.getOrDefault(runId, List.of())); }

    @Override
    public ReportArtifactVO appendArtifact(String runId, ReportArtifactCreateRequest request) {
        int version = request.artifactVersion() == null
                ? artifacts.getOrDefault(runId, List.of()).stream().mapToInt(ReportArtifactVO::artifactVersion).max().orElse(0) + 1
                : request.artifactVersion();
        ReportArtifactVO row = new ReportArtifactVO(id(), runId, version, text(request.kind(), "final_md"),
                text(request.filename(), "analysis-report.md"), text(request.contentType(), "text/markdown"),
                request.content() == null ? "" : request.content(),
                request.evidenceSetVersion() == null ? 1 : request.evidenceSetVersion(), request.parentVersion(),
                request.changeScope(), System.currentTimeMillis());
        synchronized (artifacts) { artifacts.computeIfAbsent(runId, ignored -> new ArrayList<>()).add(row); }
        return row;
    }

    @Override public List<ReportArtifactVO> listArtifacts(String runId) { return List.copyOf(artifacts.getOrDefault(runId, List.of())); }

    @Override
    public List<ReportClaimVO> replaceClaims(String runId, List<ReportClaimCreateRequest> rows) {
        List<ReportClaimVO> out = new ArrayList<>();
        for (ReportClaimCreateRequest row : rows) {
            out.add(new ReportClaimVO(id(), runId, row.artifactVersion() == null ? 1 : row.artifactVersion(),
                    row.sectionId(), text(row.claimType(), "fact"), text(row.statement(), ""),
                    row.evidenceRefs() == null ? List.of() : List.copyOf(row.evidenceRefs()),
                    row.confidence(), row.caveat(), text(row.validationStatus(), "pending"), System.currentTimeMillis()));
        }
        claims.put(runId, out);
        return List.copyOf(out);
    }

    @Override public List<ReportClaimVO> listClaims(String runId) { return List.copyOf(claims.getOrDefault(runId, List.of())); }

    private String id() { return String.valueOf(seq.incrementAndGet()); }
    private static Map<String, Object> copy(Map<String, Object> value) {
        return value == null ? Map.of() : java.util.Collections.unmodifiableMap(new LinkedHashMap<>(value));
    }
    @SuppressWarnings("unchecked")
    private static Map<String, Object> map(Object value) { return value instanceof Map<?, ?> m ? copy((Map<String, Object>) m) : Map.of(); }
    private static List<String> strings(Object value) {
        if (!(value instanceof List<?> list)) return List.of();
        return list.stream().map(String::valueOf).toList();
    }
    private static String text(Object value, String fallback) {
        String out = value == null ? "" : String.valueOf(value).trim();
        return out.isEmpty() ? fallback : out;
    }
    private static String digest(String value) {
        try {
            return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) { return Integer.toHexString(value.hashCode()); }
    }
}
