package io.opendashboard.domain.gateway;

import java.util.List;

public interface ResourceAccessPort {

    List<AclGrant> listByResource(String workspaceId, String resourceType, String resourceId);

    List<AclGrant> listByWorkspace(String workspaceId, String resourceType);

    void upsertGrant(AclGrant grant);

    void deleteGrant(String id);

    List<DataPolicy> listPolicies(String workspaceId, String datasetId);

    List<DataPolicy> listPolicies(String workspaceId);

    void upsertPolicy(DataPolicy policy);

    void deletePolicy(String id);

    List<DatasetRequest> listRequests(String workspaceId);

    void upsertRequest(DatasetRequest request);

    record AclGrant(
            String id,
            String workspaceId,
            String resourceType,
            String resourceId,
            String subjectType,
            String subjectId,
            String action,
            long createdAt,
            String createdBy
    ) {}

    record DataPolicy(
            String id,
            String workspaceId,
            String datasetId,
            String kind,
            String subjectType,
            String subjectId,
            String effect,
            String predicateJson,
            boolean enabled,
            long createdAt,
            long updatedAt
    ) {}

    record DatasetRequest(
            String id,
            String workspaceId,
            String datasetId,
            String applicantId,
            String purpose,
            String requestedActions,
            String status,
            long createdAt,
            String decidedBy,
            Long decidedAt
    ) {}
}
