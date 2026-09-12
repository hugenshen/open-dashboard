package io.opendashboard.domain;

import java.util.List;
import java.util.Map;

public final class ReportRunDtos {
    private ReportRunDtos() {}

    public record ReportRunVO(
            String id,
            String conversationId,
            String workspaceId,
            String ownerId,
            String status,
            Map<String, Object> brief,
            Integer briefVersion,
            Map<String, Object> plan,
            Integer planVersion,
            Integer approvedPlanVersion,
            Map<String, Object> budget,
            Map<String, Object> quality,
            Integer activeArtifactVersion,
            Long createTime,
            Long updateTime
    ) {}

    public record ReportTaskVO(
            String id,
            String runId,
            Integer planVersion,
            String taskKey,
            String status,
            Integer attempt,
            List<String> dependsOn,
            Map<String, Object> spec,
            Map<String, Object> budget,
            String skipReason,
            Long createTime,
            Long updateTime
    ) {}

    public record ReportEventVO(
            String id,
            String runId,
            String taskId,
            String audience,
            String eventType,
            Map<String, Object> payload,
            Long createTime
    ) {}

    public record ReportEvidenceVO(
            String id,
            String runId,
            String taskId,
            String datasetId,
            String queryFingerprint,
            Map<String, Object> metric,
            List<Map<String, Object>> filters,
            Map<String, Object> timeRange,
            Map<String, Object> unit,
            Map<String, Object> denominator,
            String resultDigest,
            Map<String, Object> resultSummary,
            List<Map<String, Object>> sampleRows,
            Long createTime
    ) {}

    public record ReportClaimVO(
            String id,
            String runId,
            Integer artifactVersion,
            String sectionId,
            String claimType,
            String statement,
            List<String> evidenceRefs,
            String confidence,
            String caveat,
            String validationStatus,
            Long createTime
    ) {}

    public record ReportArtifactVO(
            String id,
            String runId,
            Integer artifactVersion,
            String kind,
            String filename,
            String contentType,
            String content,
            Integer evidenceSetVersion,
            Integer parentVersion,
            String changeScope,
            Long createTime
    ) {}

    public record ReportRunCreateRequest(
            Map<String, Object> brief,
            Map<String, Object> budget,
            String userId,
            String ownerId
    ) {
        public ReportRunCreateRequest {
            rejectClientIdentity(userId, ownerId);
            brief = brief == null ? Map.of() : brief;
            budget = budget == null ? Map.of() : budget;
        }
    }

    public record ReportBriefUpdateRequest(
            Integer expectedVersion,
            Map<String, Object> brief,
            String userId,
            String ownerId
    ) {
        public ReportBriefUpdateRequest {
            rejectClientIdentity(userId, ownerId);
            brief = brief == null ? Map.of() : brief;
        }
    }

    public record ReportPlanUpdateRequest(
            Integer expectedVersion,
            Map<String, Object> plan,
            List<Map<String, Object>> tasks,
            String userId,
            String ownerId
    ) {
        public ReportPlanUpdateRequest {
            rejectClientIdentity(userId, ownerId);
            plan = plan == null ? Map.of() : plan;
            tasks = tasks == null ? List.of() : tasks;
        }
    }

    public record ReportRunActionRequest(
            String action,
            String taskId,
            Integer expectedPlanVersion,
            String reason,
            Map<String, Object> patch,
            String idempotencyKey,
            String userId,
            String ownerId
    ) {
        public ReportRunActionRequest {
            rejectClientIdentity(userId, ownerId);
            patch = patch == null ? Map.of() : patch;
        }
    }

    public record ReportEventCreateRequest(
            String taskId,
            String audience,
            String eventType,
            Map<String, Object> payload
    ) {
        public ReportEventCreateRequest {
            payload = payload == null ? Map.of() : payload;
        }
    }

    public record ReportEvidenceCreateRequest(
            String taskId,
            String datasetId,
            String queryFingerprint,
            Map<String, Object> metric,
            List<Map<String, Object>> filters,
            Map<String, Object> timeRange,
            Map<String, Object> unit,
            Map<String, Object> denominator,
            String resultDigest,
            Map<String, Object> resultSummary,
            List<Map<String, Object>> sampleRows
    ) {}

    public record ReportClaimCreateRequest(
            Integer artifactVersion,
            String sectionId,
            String claimType,
            String statement,
            List<String> evidenceRefs,
            String confidence,
            String caveat,
            String validationStatus
    ) {}

    public record ReportArtifactCreateRequest(
            Integer artifactVersion,
            String kind,
            String filename,
            String contentType,
            String content,
            Integer evidenceSetVersion,
            Integer parentVersion,
            String changeScope
    ) {}

    public record ReportQualityUpdateRequest(
            Map<String, Object> quality,
            List<ReportClaimCreateRequest> claims
    ) {
        public ReportQualityUpdateRequest {
            quality = quality == null ? Map.of() : quality;
            claims = claims == null ? List.of() : claims;
        }
    }

    public record ReportRewriteRequest(
            Integer sourceArtifactVersion,
            String scope,
            String instruction,
            String content,
            String userId,
            String ownerId
    ) {
        public ReportRewriteRequest {
            rejectClientIdentity(userId, ownerId);
        }
    }

    public record ReportRunDetailVO(
            ReportRunVO run,
            List<ReportTaskVO> tasks,
            List<ReportEvidenceVO> evidence,
            List<ReportArtifactVO> artifacts,
            List<ReportClaimVO> claims
    ) {}

    public record SaveAsReportVO(String reportId, String editPath) {}

    static void rejectClientIdentity(String userId, String ownerId) {
        if ((userId != null && !userId.isBlank()) || (ownerId != null && !ownerId.isBlank())) {
            throw new IllegalArgumentException("CLIENT_USER_ID_FORBIDDEN");
        }
    }
}
