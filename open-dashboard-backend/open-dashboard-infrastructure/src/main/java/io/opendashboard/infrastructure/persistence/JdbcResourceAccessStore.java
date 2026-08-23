package io.opendashboard.infrastructure.persistence;

import io.opendashboard.domain.gateway.ResourceAccessPort;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
@Profile("!stub")
public class JdbcResourceAccessStore implements ResourceAccessPort {

    private final JdbcTemplate jdbc;

    public JdbcResourceAccessStore(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public List<AclGrant> listByResource(String workspaceId, String resourceType, String resourceId) {
        return jdbc.query("""
                SELECT id, workspace_id, resource_type, resource_id, subject_type, subject_id, action, created_at, created_by
                FROM od_resource_acl
                WHERE workspace_id = ? AND resource_type = ? AND resource_id = ?
                """, this::grant, workspaceId, resourceType, resourceId);
    }

    @Override
    public List<AclGrant> listByWorkspace(String workspaceId, String resourceType) {
        return jdbc.query("""
                SELECT id, workspace_id, resource_type, resource_id, subject_type, subject_id, action, created_at, created_by
                FROM od_resource_acl
                WHERE workspace_id = ? AND resource_type = ?
                """, this::grant, workspaceId, resourceType);
    }

    @Override
    public void upsertGrant(AclGrant grant) {
        jdbc.update("""
                INSERT INTO od_resource_acl (
                    id, workspace_id, resource_type, resource_id, subject_type, subject_id, action, created_at, created_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (workspace_id, resource_type, resource_id, subject_type, subject_id, action) DO NOTHING
                """, grant.id(), grant.workspaceId(), grant.resourceType(), grant.resourceId(),
                grant.subjectType(), grant.subjectId(), grant.action(), grant.createdAt(), grant.createdBy());
    }

    @Override
    public void deleteGrant(String id) {
        jdbc.update("DELETE FROM od_resource_acl WHERE id = ?", id);
    }

    @Override
    public List<DataPolicy> listPolicies(String workspaceId, String datasetId) {
        return jdbc.query("""
                SELECT id, workspace_id, dataset_id, kind, subject_type, subject_id, effect, predicate_json::text, enabled, created_at, updated_at
                FROM od_data_policy
                WHERE workspace_id = ? AND dataset_id = ?
                """, this::policy, workspaceId, datasetId);
    }

    @Override
    public List<DataPolicy> listPolicies(String workspaceId) {
        return jdbc.query("""
                SELECT id, workspace_id, dataset_id, kind, subject_type, subject_id, effect, predicate_json::text, enabled, created_at, updated_at
                FROM od_data_policy
                WHERE workspace_id = ?
                """, this::policy, workspaceId);
    }

    @Override
    public void upsertPolicy(DataPolicy policy) {
        jdbc.update("""
                INSERT INTO od_data_policy (
                    id, workspace_id, dataset_id, kind, subject_type, subject_id, effect, predicate_json, enabled, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?)
                ON CONFLICT (id) DO UPDATE SET
                    predicate_json = EXCLUDED.predicate_json,
                    effect = EXCLUDED.effect,
                    enabled = EXCLUDED.enabled,
                    updated_at = EXCLUDED.updated_at
                """, policy.id(), policy.workspaceId(), policy.datasetId(), policy.kind(), policy.subjectType(),
                policy.subjectId(), policy.effect(), policy.predicateJson(), policy.enabled(),
                policy.createdAt(), policy.updatedAt());
    }

    @Override
    public void deletePolicy(String id) {
        jdbc.update("DELETE FROM od_data_policy WHERE id = ?", id);
    }

    @Override
    public List<DatasetRequest> listRequests(String workspaceId) {
        return jdbc.query("""
                SELECT id, workspace_id, dataset_id, applicant_id, purpose, requested_actions, status, created_at, decided_by, decided_at
                FROM od_dataset_request
                WHERE workspace_id = ?
                ORDER BY created_at DESC
                """, this::request, workspaceId);
    }

    @Override
    public void upsertRequest(DatasetRequest request) {
        jdbc.update("""
                INSERT INTO od_dataset_request (
                    id, workspace_id, dataset_id, applicant_id, purpose, requested_actions, status, created_at, decided_by, decided_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (id) DO UPDATE SET
                    status = EXCLUDED.status,
                    decided_by = EXCLUDED.decided_by,
                    decided_at = EXCLUDED.decided_at
                """, request.id(), request.workspaceId(), request.datasetId(), request.applicantId(),
                request.purpose(), request.requestedActions(), request.status(), request.createdAt(),
                request.decidedBy(), request.decidedAt());
    }

    private AclGrant grant(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        return new AclGrant(
                rs.getString("id"),
                rs.getString("workspace_id"),
                rs.getString("resource_type"),
                rs.getString("resource_id"),
                rs.getString("subject_type"),
                rs.getString("subject_id"),
                rs.getString("action"),
                rs.getLong("created_at"),
                rs.getString("created_by")
        );
    }

    private DataPolicy policy(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        return new DataPolicy(
                rs.getString("id"),
                rs.getString("workspace_id"),
                rs.getString("dataset_id"),
                rs.getString("kind"),
                rs.getString("subject_type"),
                rs.getString("subject_id"),
                rs.getString("effect"),
                rs.getString("predicate_json"),
                rs.getBoolean("enabled"),
                rs.getLong("created_at"),
                rs.getLong("updated_at")
        );
    }

    private DatasetRequest request(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        Long decidedAt = rs.getObject("decided_at") == null ? null : rs.getLong("decided_at");
        return new DatasetRequest(
                rs.getString("id"),
                rs.getString("workspace_id"),
                rs.getString("dataset_id"),
                rs.getString("applicant_id"),
                rs.getString("purpose"),
                rs.getString("requested_actions"),
                rs.getString("status"),
                rs.getLong("created_at"),
                rs.getString("decided_by"),
                decidedAt
        );
    }
}
