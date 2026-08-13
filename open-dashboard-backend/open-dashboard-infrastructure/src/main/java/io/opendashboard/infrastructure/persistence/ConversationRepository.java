package io.opendashboard.infrastructure.persistence;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.opendashboard.domain.ConversationDtos.ConversationCreateRequest;
import io.opendashboard.domain.ConversationDtos.ConversationMessageVO;
import io.opendashboard.domain.ConversationDtos.ConversationRevisionVO;
import io.opendashboard.domain.ConversationDtos.ConversationRunVO;
import io.opendashboard.domain.ConversationDtos.ConversationUpdateRequest;
import io.opendashboard.domain.ConversationDtos.ConversationVO;
import io.opendashboard.domain.gateway.ConversationGateway;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Repository
@Profile("!stub")
public class ConversationRepository implements ConversationGateway {

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public ConversationRepository(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    @Override
    public List<ConversationVO> listByOwner(String ownerId) {
        return jdbc.query(
                """
                SELECT id, title, owner_id, layout_prefs_json, dataset_ids_json, linked_dashboard_id, create_time, update_time
                FROM de_conversation WHERE owner_id = ? ORDER BY update_time DESC NULLS LAST, id DESC
                """,
                (rs, i) -> mapConversation(rs),
                ownerId
        );
    }

    @Override
    public Optional<ConversationVO> find(String id) {
        long numeric = parseId(id);
        if (numeric < 0) return Optional.empty();
        List<ConversationVO> rows = jdbc.query(
                """
                SELECT id, title, owner_id, layout_prefs_json, dataset_ids_json, linked_dashboard_id, create_time, update_time
                FROM de_conversation WHERE id = ?
                """,
                (rs, i) -> mapConversation(rs),
                numeric
        );
        return rows.stream().findFirst();
    }

    @Override
    public ConversationVO create(String ownerId, ConversationCreateRequest request) {
        long id = nextId("de_conversation");
        long now = System.currentTimeMillis();
        String title = request.title() == null || request.title().isBlank() ? "新对话" : request.title().trim();
        List<String> datasetIds = request.datasetIds() == null ? List.of() : request.datasetIds();
        jdbc.update(
                """
                INSERT INTO de_conversation
                (id, title, owner_id, layout_prefs_json, dataset_ids_json, linked_dashboard_id, create_time, update_time)
                VALUES (?, ?, ?, '{}'::jsonb, ?::jsonb, ?, ?, ?)
                """,
                id, title, ownerId, writeJson(datasetIds), request.linkedDashboardId(), now, now
        );
        return new ConversationVO(String.valueOf(id), title, ownerId, Map.of(), List.copyOf(datasetIds),
                request.linkedDashboardId(), now, now);
    }

    @Override
    public Optional<ConversationVO> update(String id, ConversationUpdateRequest request) {
        Optional<ConversationVO> curOpt = find(id);
        if (curOpt.isEmpty()) return Optional.empty();
        ConversationVO cur = curOpt.get();
        String title = request.title() == null ? cur.title() : request.title().trim();
        Map<String, Object> layout = request.layoutPrefs() == null ? cur.layoutPrefs() : request.layoutPrefs();
        List<String> datasetIds = request.datasetIds() == null ? cur.datasetIds() : request.datasetIds();
        String linked = request.linkedDashboardId() == null ? cur.linkedDashboardId() : request.linkedDashboardId();
        long now = System.currentTimeMillis();
        jdbc.update(
                """
                UPDATE de_conversation
                SET title = ?, layout_prefs_json = ?::jsonb, dataset_ids_json = ?::jsonb,
                    linked_dashboard_id = ?, update_time = ?
                WHERE id = ?
                """,
                title, writeJson(layout), writeJson(datasetIds), linked, now, parseId(id)
        );
        return Optional.of(new ConversationVO(cur.id(), title, cur.ownerId(), layout, List.copyOf(datasetIds), linked,
                cur.createTime(), now));
    }

    @Override
    public boolean delete(String id) {
        long numeric = parseId(id);
        if (numeric < 0) return false;
        jdbc.update("DELETE FROM de_conversation_revision WHERE conversation_id = ?", numeric);
        jdbc.update("DELETE FROM de_conversation_run WHERE conversation_id = ?", numeric);
        jdbc.update("DELETE FROM de_conversation_message WHERE conversation_id = ?", numeric);
        return jdbc.update("DELETE FROM de_conversation WHERE id = ?", numeric) > 0;
    }

    @Override
    public List<ConversationMessageVO> listMessages(String conversationId) {
        long cid = parseId(conversationId);
        if (cid < 0) return List.of();
        return jdbc.query(
                """
                SELECT id, conversation_id, role, content, attachments_json, create_time
                FROM de_conversation_message WHERE conversation_id = ? ORDER BY id
                """,
                (rs, i) -> new ConversationMessageVO(
                        String.valueOf(rs.getLong("id")),
                        String.valueOf(rs.getLong("conversation_id")),
                        rs.getString("role"),
                        rs.getString("content"),
                        readList(rs.getString("attachments_json")),
                        rs.getObject("create_time") == null ? null : rs.getLong("create_time")
                ),
                cid
        );
    }

    @Override
    public ConversationMessageVO appendMessage(
            String conversationId,
            String role,
            String content,
            List<Map<String, Object>> attachments
    ) {
        long cid = parseId(conversationId);
        long id = nextId("de_conversation_message");
        long now = System.currentTimeMillis();
        List<Map<String, Object>> atts = attachments == null ? List.of() : attachments;
        jdbc.update(
                """
                INSERT INTO de_conversation_message (id, conversation_id, role, content, attachments_json, create_time)
                VALUES (?, ?, ?, ?, ?::jsonb, ?)
                """,
                id, cid, role, content == null ? "" : content, writeJson(atts), now
        );
        jdbc.update("UPDATE de_conversation SET update_time = ? WHERE id = ?", now, cid);
        return new ConversationMessageVO(String.valueOf(id), conversationId, role,
                content == null ? "" : content, List.copyOf(atts), now);
    }

    @Override
    public ConversationRunVO createRun(String conversationId, String mode, String styleId) {
        long cid = parseId(conversationId);
        long id = nextId("de_conversation_run");
        long now = System.currentTimeMillis();
        String m = mode == null || mode.isBlank() ? "auto" : mode.toLowerCase();
        jdbc.update(
                """
                INSERT INTO de_conversation_run
                (id, conversation_id, status, mode, style_id, plan_json, create_time, update_time)
                VALUES (?, ?, 'streaming', ?, ?, NULL, ?, ?)
                """,
                id, cid, m, styleId, now, now
        );
        return new ConversationRunVO(String.valueOf(id), conversationId, "streaming", m, styleId,
                null, null, null, now, now);
    }

    @Override
    public Optional<ConversationRunVO> findRun(String runId) {
        long id = parseId(runId);
        if (id < 0) return Optional.empty();
        List<ConversationRunVO> rows = jdbc.query(
                """
                SELECT id, conversation_id, status, mode, style_id, plan_json, finish_reason, finish_detail, create_time, update_time
                FROM de_conversation_run WHERE id = ?
                """,
                (rs, i) -> mapRun(rs),
                id
        );
        return rows.stream().findFirst();
    }

    @Override
    public Optional<ConversationRunVO> updateRun(
            String runId,
            String status,
            Map<String, Object> plan,
            String finishReason,
            String finishDetail
    ) {
        Optional<ConversationRunVO> curOpt = findRun(runId);
        if (curOpt.isEmpty()) return Optional.empty();
        ConversationRunVO cur = curOpt.get();
        String nextStatus = status == null ? cur.status() : status;
        Map<String, Object> nextPlan = plan == null ? cur.plan() : plan;
        String reason = finishReason == null ? cur.finishReason() : finishReason;
        String detail = finishDetail == null ? cur.finishDetail() : finishDetail;
        long now = System.currentTimeMillis();
        jdbc.update(
                """
                UPDATE de_conversation_run
                SET status = ?, plan_json = ?::jsonb, finish_reason = ?, finish_detail = ?, update_time = ?
                WHERE id = ?
                """,
                nextStatus, writeJson(nextPlan), reason, detail, now, parseId(runId)
        );
        return Optional.of(new ConversationRunVO(
                cur.id(), cur.conversationId(), nextStatus, cur.mode(), cur.styleId(),
                nextPlan, reason, detail, cur.createTime(), now
        ));
    }

    @Override
    public List<ConversationRevisionVO> listRevisions(String conversationId) {
        long cid = parseId(conversationId);
        if (cid < 0) return List.of();
        return jdbc.query(
                """
                SELECT id, conversation_id, run_id, dashboard_id, patch_json, snapshot_json, label, create_time
                FROM de_conversation_revision WHERE conversation_id = ? ORDER BY id DESC
                """,
                (rs, i) -> mapRevision(rs),
                cid
        );
    }

    @Override
    public ConversationRevisionVO createRevision(
            String conversationId,
            String runId,
            String dashboardId,
            Map<String, Object> patch,
            Map<String, Object> snapshot,
            String label
    ) {
        long id = nextId("de_conversation_revision");
        long now = System.currentTimeMillis();
        Long runNumeric = parseId(runId) < 0 ? null : parseId(runId);
        jdbc.update(
                """
                INSERT INTO de_conversation_revision
                (id, conversation_id, run_id, dashboard_id, patch_json, snapshot_json, label, create_time)
                VALUES (?, ?, ?, ?, ?::jsonb, ?::jsonb, ?, ?)
                """,
                id, parseId(conversationId), runNumeric, dashboardId,
                writeJson(patch == null ? Map.of() : patch),
                writeJson(snapshot == null ? Map.of() : snapshot),
                label, now
        );
        return new ConversationRevisionVO(
                String.valueOf(id), conversationId, runId, dashboardId,
                patch == null ? Map.of() : patch,
                snapshot == null ? Map.of() : snapshot,
                label, now
        );
    }

    @Override
    public Optional<ConversationRevisionVO> findRevision(String revisionId) {
        long id = parseId(revisionId);
        if (id < 0) return Optional.empty();
        List<ConversationRevisionVO> rows = jdbc.query(
                """
                SELECT id, conversation_id, run_id, dashboard_id, patch_json, snapshot_json, label, create_time
                FROM de_conversation_revision WHERE id = ?
                """,
                (rs, i) -> mapRevision(rs),
                id
        );
        return rows.stream().findFirst();
    }

    private ConversationVO mapConversation(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new ConversationVO(
                String.valueOf(rs.getLong("id")),
                rs.getString("title"),
                rs.getString("owner_id"),
                readMap(rs.getString("layout_prefs_json")),
                readStringList(rs.getString("dataset_ids_json")),
                rs.getString("linked_dashboard_id"),
                rs.getObject("create_time") == null ? null : rs.getLong("create_time"),
                rs.getObject("update_time") == null ? null : rs.getLong("update_time")
        );
    }

    private ConversationRunVO mapRun(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new ConversationRunVO(
                String.valueOf(rs.getLong("id")),
                String.valueOf(rs.getLong("conversation_id")),
                rs.getString("status"),
                rs.getString("mode"),
                rs.getString("style_id"),
                readMap(rs.getString("plan_json")),
                rs.getString("finish_reason"),
                rs.getString("finish_detail"),
                rs.getObject("create_time") == null ? null : rs.getLong("create_time"),
                rs.getObject("update_time") == null ? null : rs.getLong("update_time")
        );
    }

    private ConversationRevisionVO mapRevision(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new ConversationRevisionVO(
                String.valueOf(rs.getLong("id")),
                String.valueOf(rs.getLong("conversation_id")),
                rs.getObject("run_id") == null ? null : String.valueOf(rs.getLong("run_id")),
                rs.getString("dashboard_id"),
                readMap(rs.getString("patch_json")),
                readMap(rs.getString("snapshot_json")),
                rs.getString("label"),
                rs.getObject("create_time") == null ? null : rs.getLong("create_time")
        );
    }

    private long nextId(String table) {
        Long id = jdbc.queryForObject("SELECT COALESCE(MAX(id), 0) + 1 FROM " + table, Long.class);
        return id == null ? 1L : id;
    }

    private long parseId(String id) {
        try {
            return Long.parseLong(id);
        } catch (Exception e) {
            return -1;
        }
    }

    private Map<String, Object> readMap(String json) {
        if (json == null || json.isBlank()) return Map.of();
        try {
            return mapper.readValue(json, new TypeReference<>() {});
        } catch (Exception e) {
            return Map.of();
        }
    }

    private List<Map<String, Object>> readList(String json) {
        if (json == null || json.isBlank()) return List.of();
        try {
            return mapper.readValue(json, new TypeReference<>() {});
        } catch (Exception e) {
            return List.of();
        }
    }

    private List<String> readStringList(String json) {
        if (json == null || json.isBlank()) return List.of();
        try {
            return mapper.readValue(json, new TypeReference<>() {});
        } catch (Exception e) {
            return List.of();
        }
    }

    private String writeJson(Object value) {
        try {
            return mapper.writeValueAsString(value == null ? Map.of() : value);
        } catch (Exception e) {
            return "{}";
        }
    }
}
