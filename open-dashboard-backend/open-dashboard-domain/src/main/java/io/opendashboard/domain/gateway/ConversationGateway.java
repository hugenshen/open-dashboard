package io.opendashboard.domain.gateway;

import io.opendashboard.domain.ConversationDtos.ConversationCreateRequest;
import io.opendashboard.domain.ConversationDtos.ConversationMessageVO;
import io.opendashboard.domain.ConversationDtos.ConversationRevisionVO;
import io.opendashboard.domain.ConversationDtos.ConversationRunVO;
import io.opendashboard.domain.ConversationDtos.ConversationUpdateRequest;
import io.opendashboard.domain.ConversationDtos.ConversationVO;

import java.util.List;
import java.util.Map;
import java.util.Optional;

public interface ConversationGateway {

    List<ConversationVO> listByOwner(String ownerId);

    Optional<ConversationVO> find(String id);

    ConversationVO create(String ownerId, ConversationCreateRequest request);

    Optional<ConversationVO> update(String id, ConversationUpdateRequest request);

    boolean delete(String id);

    List<ConversationMessageVO> listMessages(String conversationId);

    ConversationMessageVO appendMessage(
            String conversationId,
            String role,
            String content,
            List<Map<String, Object>> attachments
    );

    ConversationRunVO createRun(String conversationId, String mode, String styleId);

    Optional<ConversationRunVO> findRun(String runId);

    Optional<ConversationRunVO> updateRun(
            String runId,
            String status,
            Map<String, Object> plan,
            String finishReason,
            String finishDetail
    );

    List<ConversationRevisionVO> listRevisions(String conversationId);

    ConversationRevisionVO createRevision(
            String conversationId,
            String runId,
            String dashboardId,
            Map<String, Object> patch,
            Map<String, Object> snapshot,
            String label
    );

    Optional<ConversationRevisionVO> findRevision(String revisionId);
}
