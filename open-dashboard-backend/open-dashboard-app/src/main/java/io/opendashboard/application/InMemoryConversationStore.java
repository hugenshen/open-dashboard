package io.opendashboard.application;

import io.opendashboard.domain.ConversationDtos.ConversationCreateRequest;
import io.opendashboard.domain.ConversationDtos.ConversationMessageVO;
import io.opendashboard.domain.ConversationDtos.ConversationRevisionVO;
import io.opendashboard.domain.ConversationDtos.ConversationRunVO;
import io.opendashboard.domain.ConversationDtos.ConversationUpdateRequest;
import io.opendashboard.domain.ConversationDtos.ConversationVO;
import io.opendashboard.domain.gateway.ConversationGateway;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

@Service
@Profile("stub")
public class InMemoryConversationStore implements ConversationGateway {

    private final AtomicLong seq = new AtomicLong(1);
    private final ConcurrentHashMap<String, ConversationVO> conversations = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, List<ConversationMessageVO>> messages = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, ConversationRunVO> runs = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, List<ConversationRevisionVO>> revisions = new ConcurrentHashMap<>();

    @Override
    public List<ConversationVO> listByOwner(String ownerId) {
        return conversations.values().stream()
                .filter(c -> ownerId == null || ownerId.equals(c.ownerId()))
                .sorted(Comparator.comparing(ConversationVO::updateTime, Comparator.nullsLast(Comparator.reverseOrder())))
                .toList();
    }

    @Override
    public Optional<ConversationVO> find(String id) {
        return Optional.ofNullable(conversations.get(id));
    }

    @Override
    public ConversationVO create(String ownerId, ConversationCreateRequest request) {
        String id = String.valueOf(seq.incrementAndGet());
        long now = System.currentTimeMillis();
        String title = request.title() == null || request.title().isBlank() ? "新对话" : request.title().trim();
        ConversationVO vo = new ConversationVO(
                id,
                title,
                ownerId,
                Map.of(),
                request.datasetIds() == null ? List.of() : List.copyOf(request.datasetIds()),
                request.linkedDashboardId(),
                now,
                now
        );
        conversations.put(id, vo);
        messages.put(id, new ArrayList<>());
        revisions.put(id, new ArrayList<>());
        return vo;
    }

    @Override
    public Optional<ConversationVO> update(String id, ConversationUpdateRequest request) {
        ConversationVO cur = conversations.get(id);
        if (cur == null) return Optional.empty();
        ConversationVO next = new ConversationVO(
                cur.id(),
                request.title() == null ? cur.title() : request.title().trim(),
                cur.ownerId(),
                request.layoutPrefs() == null ? cur.layoutPrefs() : request.layoutPrefs(),
                request.datasetIds() == null ? cur.datasetIds() : List.copyOf(request.datasetIds()),
                request.linkedDashboardId() == null ? cur.linkedDashboardId() : request.linkedDashboardId(),
                cur.createTime(),
                System.currentTimeMillis()
        );
        conversations.put(id, next);
        return Optional.of(next);
    }

    @Override
    public boolean delete(String id) {
        messages.remove(id);
        revisions.remove(id);
        return conversations.remove(id) != null;
    }

    @Override
    public List<ConversationMessageVO> listMessages(String conversationId) {
        return List.copyOf(messages.getOrDefault(conversationId, List.of()));
    }

    @Override
    public ConversationMessageVO appendMessage(
            String conversationId,
            String role,
            String content,
            List<Map<String, Object>> attachments
    ) {
        String id = String.valueOf(seq.incrementAndGet());
        ConversationMessageVO msg = new ConversationMessageVO(
                id,
                conversationId,
                role,
                content == null ? "" : content,
                attachments == null ? List.of() : List.copyOf(attachments),
                System.currentTimeMillis()
        );
        messages.computeIfAbsent(conversationId, k -> new ArrayList<>()).add(msg);
        find(conversationId).ifPresent(c -> conversations.put(conversationId, new ConversationVO(
                c.id(), c.title(), c.ownerId(), c.layoutPrefs(), c.datasetIds(), c.linkedDashboardId(),
                c.createTime(), System.currentTimeMillis()
        )));
        return msg;
    }

    @Override
    public ConversationRunVO createRun(String conversationId, String mode, String styleId) {
        String id = String.valueOf(seq.incrementAndGet());
        long now = System.currentTimeMillis();
        ConversationRunVO run = new ConversationRunVO(
                id, conversationId, "streaming",
                mode == null || mode.isBlank() ? "auto" : mode.toLowerCase(),
                styleId, null, null, null, now, now
        );
        runs.put(id, run);
        return run;
    }

    @Override
    public Optional<ConversationRunVO> findRun(String runId) {
        return Optional.ofNullable(runs.get(runId));
    }

    @Override
    public Optional<ConversationRunVO> updateRun(
            String runId,
            String status,
            Map<String, Object> plan,
            String finishReason,
            String finishDetail
    ) {
        ConversationRunVO cur = runs.get(runId);
        if (cur == null) return Optional.empty();
        ConversationRunVO next = new ConversationRunVO(
                cur.id(),
                cur.conversationId(),
                status == null ? cur.status() : status,
                cur.mode(),
                cur.styleId(),
                plan == null ? cur.plan() : plan,
                finishReason == null ? cur.finishReason() : finishReason,
                finishDetail == null ? cur.finishDetail() : finishDetail,
                cur.createTime(),
                System.currentTimeMillis()
        );
        runs.put(runId, next);
        return Optional.of(next);
    }

    @Override
    public List<ConversationRevisionVO> listRevisions(String conversationId) {
        return List.copyOf(revisions.getOrDefault(conversationId, List.of()));
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
        String id = String.valueOf(seq.incrementAndGet());
        ConversationRevisionVO rev = new ConversationRevisionVO(
                id, conversationId, runId, dashboardId,
                patch == null ? Map.of() : patch,
                snapshot == null ? Map.of() : snapshot,
                label,
                System.currentTimeMillis()
        );
        revisions.computeIfAbsent(conversationId, k -> new ArrayList<>()).add(0, rev);
        return rev;
    }

    @Override
    public Optional<ConversationRevisionVO> findRevision(String revisionId) {
        return revisions.values().stream()
                .flatMap(List::stream)
                .filter(r -> r.id().equals(revisionId))
                .findFirst();
    }
}
