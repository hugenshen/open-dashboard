package io.opendashboard.infrastructure.persistence;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.opendashboard.domain.ReportRunDtos.*;
import io.opendashboard.domain.gateway.ReportRunGateway;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Repository
@Profile("!stub")
public class ReportRunRepository implements ReportRunGateway {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public ReportRunRepository(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    @Override
    public ReportRunVO create(String conversationId, String workspaceId, String ownerId,
                              Map<String, Object> brief, Map<String, Object> budget) {
        long id = nextId("de_conversation_run");
        long now = System.currentTimeMillis();
        jdbc.update("""
            INSERT INTO de_conversation_run
            (id, conversation_id, status, mode, run_type, workspace_id, owner_id,
             brief_json, brief_version, plan_json, plan_version, budget_json, quality_json,
             active_artifact_version, create_time, update_time)
            VALUES (?, ?, 'briefing', 'report', 'report', ?, ?, ?::jsonb, 1, '{}'::jsonb, 0,
                    ?::jsonb, '{}'::jsonb, 0, ?, ?)
            """, id, Long.parseLong(conversationId), workspaceId, ownerId,
                json(brief), json(budget), now, now);
        return find(String.valueOf(id)).orElseThrow();
    }

    @Override
    public Optional<ReportRunVO> find(String runId) {
        List<ReportRunVO> rows = jdbc.query("""
            SELECT id, conversation_id, workspace_id, owner_id, status, brief_json, brief_version,
                   plan_json, plan_version, approved_plan_version, budget_json, quality_json,
                   active_artifact_version, create_time, update_time
            FROM de_conversation_run WHERE id = ? AND run_type = 'report'
            """, (rs, i) -> mapRun(rs), Long.parseLong(runId));
        return rows.stream().findFirst();
    }

    @Override
    public Optional<ReportRunVO> findLatest(String conversationId, String workspaceId, String ownerId) {
        return jdbc.query("""
            SELECT id, conversation_id, workspace_id, owner_id, status, brief_json, brief_version,
                   plan_json, plan_version, approved_plan_version, budget_json, quality_json,
                   active_artifact_version, create_time, update_time
            FROM de_conversation_run
            WHERE conversation_id=? AND workspace_id=? AND owner_id=? AND run_type='report'
            ORDER BY create_time DESC, id DESC LIMIT 1
            """, (rs, i) -> mapRun(rs), Long.parseLong(conversationId), workspaceId, ownerId).stream().findFirst();
    }

    @Override
    public Optional<ReportRunVO> updateRun(String runId, String status,
                                           Map<String, Object> brief, Integer briefVersion,
                                           Map<String, Object> plan, Integer planVersion,
                                           Integer approvedPlanVersion,
                                           Map<String, Object> quality, Integer activeArtifactVersion) {
        ReportRunVO cur = find(runId).orElse(null);
        if (cur == null) return Optional.empty();
        long now = System.currentTimeMillis();
        jdbc.update("""
            UPDATE de_conversation_run SET status=?, brief_json=?::jsonb, brief_version=?,
              plan_json=?::jsonb, plan_version=?, approved_plan_version=?,
              quality_json=?::jsonb, active_artifact_version=?, update_time=? WHERE id=?
            """,
            status == null ? cur.status() : status,
            json(brief == null ? cur.brief() : brief),
            briefVersion == null ? cur.briefVersion() : briefVersion,
            json(plan == null ? cur.plan() : plan),
            planVersion == null ? cur.planVersion() : planVersion,
            approvedPlanVersion == null ? cur.approvedPlanVersion() : approvedPlanVersion,
            json(quality == null ? cur.quality() : quality),
            activeArtifactVersion == null ? cur.activeArtifactVersion() : activeArtifactVersion,
            now, Long.parseLong(runId));
        return find(runId);
    }

    @Override
    public List<ReportTaskVO> replaceTasks(String runId, int planVersion, List<Map<String, Object>> tasks) {
        jdbc.update("DELETE FROM de_report_task WHERE run_id = ? AND plan_version = ?", Long.parseLong(runId), planVersion);
        long now = System.currentTimeMillis();
        int index = 0;
        for (Map<String, Object> task : tasks) {
            long id = nextId("de_report_task");
            String key = text(task.get("taskId"), "task-" + (++index));
            Object deps = task.getOrDefault("dependsOn", List.of());
            Object budget = task.getOrDefault("budget", Map.of());
            jdbc.update("""
                INSERT INTO de_report_task
                (id, run_id, plan_version, task_key, status, attempt, depends_on_json,
                 spec_json, budget_json, create_time, update_time)
                VALUES (?, ?, ?, ?, 'pending', 1, ?::jsonb, ?::jsonb, ?::jsonb, ?, ?)
                """, id, Long.parseLong(runId), planVersion, key, json(deps), json(task), json(budget), now, now);
        }
        return listTasks(runId);
    }

    @Override
    public List<ReportTaskVO> listTasks(String runId) {
        return jdbc.query("""
            SELECT id, run_id, plan_version, task_key, status, attempt, depends_on_json,
                   spec_json, budget_json, skip_reason, create_time, update_time
            FROM de_report_task WHERE run_id=? ORDER BY plan_version, id
            """, (rs, i) -> mapTask(rs), Long.parseLong(runId));
    }

    @Override
    public Optional<ReportTaskVO> findTask(String taskId) {
        return jdbc.query("""
            SELECT id, run_id, plan_version, task_key, status, attempt, depends_on_json,
                   spec_json, budget_json, skip_reason, create_time, update_time
            FROM de_report_task WHERE id=?
            """, (rs, i) -> mapTask(rs), Long.parseLong(taskId)).stream().findFirst();
    }

    @Override
    public Optional<ReportTaskVO> updateTask(String taskId, String status, Integer attempt,
                                             Map<String, Object> spec, String skipReason) {
        ReportTaskVO cur = findTask(taskId).orElse(null);
        if (cur == null) return Optional.empty();
        jdbc.update("""
            UPDATE de_report_task SET status=?, attempt=?, spec_json=?::jsonb, skip_reason=?, update_time=? WHERE id=?
            """, status == null ? cur.status() : status,
            attempt == null ? cur.attempt() : attempt,
            json(spec == null ? cur.spec() : spec),
            skipReason == null ? cur.skipReason() : skipReason,
            System.currentTimeMillis(), Long.parseLong(taskId));
        return findTask(taskId);
    }

    @Override
    public ReportEventVO appendEvent(String runId, ReportEventCreateRequest req) {
        long id = nextId("de_report_event");
        long now = System.currentTimeMillis();
        Long taskId = numericOrNull(req.taskId());
        jdbc.update("""
            INSERT INTO de_report_event (id, run_id, task_id, audience, event_type, payload_json, create_time)
            VALUES (?, ?, ?, ?, ?, ?::jsonb, ?)
            """, id, Long.parseLong(runId), taskId, text(req.audience(), "business"),
            text(req.eventType(), "progress"), json(req.payload()), now);
        return new ReportEventVO(String.valueOf(id), runId, req.taskId(), text(req.audience(), "business"),
                text(req.eventType(), "progress"), req.payload(), now);
    }

    @Override
    public List<ReportEventVO> listEvents(String runId, Long afterId) {
        return jdbc.query("""
            SELECT id, run_id, task_id, audience, event_type, payload_json, create_time
            FROM de_report_event WHERE run_id=? AND id>? ORDER BY id
            """, (rs, i) -> new ReportEventVO(String.valueOf(rs.getLong("id")),
                String.valueOf(rs.getLong("run_id")),
                rs.getObject("task_id") == null ? null : String.valueOf(rs.getLong("task_id")),
                rs.getString("audience"), rs.getString("event_type"),
                map(rs.getString("payload_json")), rs.getLong("create_time")),
            Long.parseLong(runId), afterId == null ? 0L : afterId);
    }

    @Override
    public ReportEvidenceVO appendEvidence(String runId, ReportEvidenceCreateRequest req) {
        long id = nextId("de_report_evidence");
        long now = System.currentTimeMillis();
        jdbc.update("""
            INSERT INTO de_report_evidence
            (id, run_id, task_id, dataset_id, query_fingerprint, metric_json, filters_json,
             time_range_json, unit_json, denominator_json, result_digest, result_summary_json,
             sample_rows_json, create_time)
            VALUES (?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb, ?, ?::jsonb, ?::jsonb, ?)
            """, id, Long.parseLong(runId), numericOrNull(req.taskId()), text(req.datasetId(), "unknown"),
            text(req.queryFingerprint(), "unknown"), json(req.metric()), json(req.filters()),
            json(req.timeRange()), json(req.unit()), json(req.denominator()), text(req.resultDigest(), "unknown"),
            json(req.resultSummary()), json(req.sampleRows()), now);
        return jdbc.queryForObject("SELECT * FROM de_report_evidence WHERE id=?",
            (rs, i) -> mapEvidence(rs), id);
    }

    @Override
    public List<ReportEvidenceVO> listEvidence(String runId) {
        return jdbc.query("SELECT * FROM de_report_evidence WHERE run_id=? ORDER BY id",
            (rs, i) -> mapEvidence(rs), Long.parseLong(runId));
    }

    @Override
    public ReportArtifactVO appendArtifact(String runId, ReportArtifactCreateRequest req) {
        long id = nextId("de_report_artifact");
        long now = System.currentTimeMillis();
        int version = req.artifactVersion() == null ? nextArtifactVersion(runId) : req.artifactVersion();
        jdbc.update("""
            INSERT INTO de_report_artifact
            (id, run_id, artifact_version, kind, filename, content_type, content_text,
             evidence_set_version, parent_version, change_scope, create_time)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, id, Long.parseLong(runId), version, text(req.kind(), "final_md"),
            text(req.filename(), "analysis-report.md"), text(req.contentType(), "text/markdown"),
            req.content() == null ? "" : req.content(),
            req.evidenceSetVersion() == null ? 1 : req.evidenceSetVersion(),
            req.parentVersion(), req.changeScope(), now);
        return new ReportArtifactVO(String.valueOf(id), runId, version, text(req.kind(), "final_md"),
            text(req.filename(), "analysis-report.md"), text(req.contentType(), "text/markdown"),
            req.content() == null ? "" : req.content(), req.evidenceSetVersion() == null ? 1 : req.evidenceSetVersion(),
            req.parentVersion(), req.changeScope(), now);
    }

    @Override
    public List<ReportArtifactVO> listArtifacts(String runId) {
        return jdbc.query("SELECT * FROM de_report_artifact WHERE run_id=? ORDER BY artifact_version, id",
            (rs, i) -> new ReportArtifactVO(String.valueOf(rs.getLong("id")), String.valueOf(rs.getLong("run_id")),
                rs.getInt("artifact_version"), rs.getString("kind"), rs.getString("filename"),
                rs.getString("content_type"), rs.getString("content_text"), rs.getInt("evidence_set_version"),
                (Integer) rs.getObject("parent_version"), rs.getString("change_scope"), rs.getLong("create_time")),
            Long.parseLong(runId));
    }

    @Override
    public List<ReportClaimVO> replaceClaims(String runId, List<ReportClaimCreateRequest> claims) {
        jdbc.update("DELETE FROM de_report_claim WHERE run_id=?", Long.parseLong(runId));
        long now = System.currentTimeMillis();
        for (ReportClaimCreateRequest req : claims) {
            long id = nextId("de_report_claim");
            jdbc.update("""
                INSERT INTO de_report_claim
                (id, run_id, artifact_version, section_id, claim_type, statement, evidence_refs_json,
                 confidence, caveat, validation_status, create_time)
                VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?)
                """, id, Long.parseLong(runId), req.artifactVersion() == null ? 1 : req.artifactVersion(),
                req.sectionId(), text(req.claimType(), "fact"), text(req.statement(), ""),
                json(req.evidenceRefs()), req.confidence(), req.caveat(), text(req.validationStatus(), "pending"), now);
        }
        return listClaims(runId);
    }

    @Override
    public List<ReportClaimVO> listClaims(String runId) {
        return jdbc.query("SELECT * FROM de_report_claim WHERE run_id=? ORDER BY id",
            (rs, i) -> new ReportClaimVO(String.valueOf(rs.getLong("id")), String.valueOf(rs.getLong("run_id")),
                rs.getInt("artifact_version"), rs.getString("section_id"), rs.getString("claim_type"),
                rs.getString("statement"), strings(rs.getString("evidence_refs_json")),
                rs.getString("confidence"), rs.getString("caveat"), rs.getString("validation_status"),
                rs.getLong("create_time")), Long.parseLong(runId));
    }

    private ReportRunVO mapRun(ResultSet rs) throws SQLException {
        return new ReportRunVO(String.valueOf(rs.getLong("id")), String.valueOf(rs.getLong("conversation_id")),
            rs.getString("workspace_id"), rs.getString("owner_id"), rs.getString("status"),
            map(rs.getString("brief_json")), rs.getInt("brief_version"), map(rs.getString("plan_json")),
            rs.getInt("plan_version"), (Integer) rs.getObject("approved_plan_version"),
            map(rs.getString("budget_json")), map(rs.getString("quality_json")),
            rs.getInt("active_artifact_version"), rs.getLong("create_time"), rs.getLong("update_time"));
    }

    private ReportTaskVO mapTask(ResultSet rs) throws SQLException {
        return new ReportTaskVO(String.valueOf(rs.getLong("id")), String.valueOf(rs.getLong("run_id")),
            rs.getInt("plan_version"), rs.getString("task_key"), rs.getString("status"), rs.getInt("attempt"),
            strings(rs.getString("depends_on_json")), map(rs.getString("spec_json")),
            map(rs.getString("budget_json")), rs.getString("skip_reason"),
            rs.getLong("create_time"), rs.getLong("update_time"));
    }

    private ReportEvidenceVO mapEvidence(ResultSet rs) throws SQLException {
        return new ReportEvidenceVO(String.valueOf(rs.getLong("id")), String.valueOf(rs.getLong("run_id")),
            rs.getObject("task_id") == null ? null : String.valueOf(rs.getLong("task_id")),
            rs.getString("dataset_id"), rs.getString("query_fingerprint"), map(rs.getString("metric_json")),
            maps(rs.getString("filters_json")), map(rs.getString("time_range_json")), map(rs.getString("unit_json")),
            map(rs.getString("denominator_json")), rs.getString("result_digest"),
            map(rs.getString("result_summary_json")), maps(rs.getString("sample_rows_json")), rs.getLong("create_time"));
    }

    private long nextId(String table) {
        return jdbc.queryForObject("SELECT COALESCE(MAX(id), 0) + 1 FROM " + table, Long.class);
    }

    private int nextArtifactVersion(String runId) {
        return jdbc.queryForObject("SELECT COALESCE(MAX(artifact_version),0)+1 FROM de_report_artifact WHERE run_id=?",
            Integer.class, Long.parseLong(runId));
    }

    private String json(Object value) {
        try { return mapper.writeValueAsString(value == null ? Map.of() : value); }
        catch (Exception e) { throw new IllegalArgumentException("invalid json", e); }
    }
    private Map<String, Object> map(String raw) {
        try { return raw == null ? Map.of() : mapper.readValue(raw, new TypeReference<>() {}); }
        catch (Exception e) { return Map.of(); }
    }
    private List<Map<String, Object>> maps(String raw) {
        try { return raw == null ? List.of() : mapper.readValue(raw, new TypeReference<>() {}); }
        catch (Exception e) { return List.of(); }
    }
    private List<String> strings(String raw) {
        try { return raw == null ? List.of() : mapper.readValue(raw, new TypeReference<>() {}); }
        catch (Exception e) { return List.of(); }
    }
    private static String text(Object value, String fallback) {
        String s = value == null ? "" : String.valueOf(value).trim();
        return s.isEmpty() ? fallback : s;
    }
    private static Long numericOrNull(String value) {
        if (value == null || value.isBlank()) return null;
        try { return Long.parseLong(value); } catch (NumberFormatException e) { return null; }
    }
}
