package io.opendashboard.domain;

import java.util.List;
import java.util.Map;

public final class ConversationDtos {

    private ConversationDtos() {}

    public record ConversationVO(
            String id,
            String title,
            String ownerId,
            Map<String, Object> layoutPrefs,
            List<String> datasetIds,
            String linkedDashboardId,
            Long createTime,
            Long updateTime
    ) {}

    public record ConversationMessageVO(
            String id,
            String conversationId,
            String role,
            String content,
            List<Map<String, Object>> attachments,
            Long createTime
    ) {}

    public record ConversationRunVO(
            String id,
            String conversationId,
            String status,
            String mode,
            String styleId,
            Map<String, Object> plan,
            String finishReason,
            String finishDetail,
            Long createTime,
            Long updateTime
    ) {}

    public record ConversationRevisionVO(
            String id,
            String conversationId,
            String runId,
            String dashboardId,
            Map<String, Object> patch,
            Map<String, Object> snapshot,
            String label,
            Long createTime
    ) {}

    public record ConversationMessageCreateRequest(
            String role,
            String content,
            List<Map<String, Object>> attachments
    ) {
        public ConversationMessageCreateRequest {
            attachments = attachments == null ? List.of() : attachments;
        }
    }

    public record ConversationUpdateRequest(
            String title,
            Map<String, Object> layoutPrefs,
            List<String> datasetIds,
            String linkedDashboardId,
            String userId,
            String ownerId
    ) {
        public ConversationUpdateRequest {
            rejectClientUserId(userId, ownerId);
        }

        public ConversationUpdateRequest(
                String title,
                Map<String, Object> layoutPrefs,
                List<String> datasetIds,
                String linkedDashboardId
        ) {
            this(title, layoutPrefs, datasetIds, linkedDashboardId, null, null);
        }
    }

    public record ConversationCreateRequest(
            String title,
            List<String> datasetIds,
            String linkedDashboardId,
            String userId,
            String ownerId
    ) {
        public ConversationCreateRequest {
            rejectClientUserId(userId, ownerId);
        }

        public ConversationCreateRequest(String title, List<String> datasetIds, String linkedDashboardId) {
            this(title, datasetIds, linkedDashboardId, null, null);
        }
    }

    public record ConversationRunRequest(
            String message,
            String intent,
            String mode,
            String styleId,
            List<String> datasetIds,
            String selectedChartId,
            Map<String, Object> selectedEncode,
            String userId,
            String ownerId
    ) {
        public ConversationRunRequest {
            rejectClientUserId(userId, ownerId);
        }

        public ConversationRunRequest(
                String message,
                String intent,
                String mode,
                String styleId,
                List<String> datasetIds,
                String selectedChartId,
                Map<String, Object> selectedEncode
        ) {
            this(message, intent, mode, styleId, datasetIds, selectedChartId, selectedEncode, null, null);
        }
    }

    static void rejectClientUserId(String userId, String ownerId) {
        if ((userId != null && !userId.isBlank()) || (ownerId != null && !ownerId.isBlank())) {
            throw new IllegalArgumentException("CLIENT_USER_ID_FORBIDDEN");
        }
    }

    public record StylePresetVO(
            String id,
            String name,
            String description,
            Map<String, Object> tokens
    ) {}

    public record FeatureStatusVO(boolean enabled) {}
}
