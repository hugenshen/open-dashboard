package io.opendashboard.application.conversation;

import io.opendashboard.domain.ConversationDtos.ConversationAdoptRequest;
import io.opendashboard.domain.ConversationDtos.ConversationCreateRequest;
import io.opendashboard.domain.ConversationDtos.ConversationMessageCreateRequest;
import io.opendashboard.domain.ConversationDtos.ConversationMessageVO;
import io.opendashboard.domain.ConversationDtos.ConversationRevisionVO;
import io.opendashboard.domain.ConversationDtos.ConversationRunRequest;
import io.opendashboard.domain.ConversationDtos.ConversationRunVO;
import io.opendashboard.domain.ConversationDtos.ConversationUpdateRequest;
import io.opendashboard.domain.ConversationDtos.ConversationVO;
import io.opendashboard.domain.ConversationDtos.FeatureStatusVO;
import io.opendashboard.domain.ConversationDtos.StylePresetVO;
import io.opendashboard.domain.context.AuthContext;
import io.opendashboard.domain.context.AuthPrincipal;
import io.opendashboard.domain.gateway.ConversationGateway;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@Service
public class ConversationAppService {

    private final ConversationProperties props;
    private final ConversationGateway store;
    private final ConversationHarness harness;
    private final DashboardPatchApplier applier;
    private final ExecutorService executor = Executors.newCachedThreadPool(r -> {
        Thread t = new Thread(r, "conversation-sse");
        t.setDaemon(true);
        return t;
    });

    public ConversationAppService(
            ConversationProperties props,
            ConversationGateway store,
            ConversationHarness harness,
            DashboardPatchApplier applier
    ) {
        this.props = props;
        this.store = store;
        this.harness = harness;
        this.applier = applier;
    }

    public boolean enabled() {
        return props.isEnabled();
    }

    public FeatureStatusVO feature() {
        return new FeatureStatusVO(props.isEnabled());
    }

    public List<StylePresetVO> styles() {
        return ConversationStyleCatalog.list();
    }

    public List<ConversationVO> list(Integer limit) {
        List<ConversationVO> rows = store.listByOwner(AuthContext.userIdOr("demo"));
        if (limit == null || limit <= 0) return rows;
        int n = Math.min(limit, 50);
        return rows.size() <= n ? rows : rows.subList(0, n);
    }

    public ConversationVO create(ConversationCreateRequest request) {
        return store.create(
                AuthContext.userIdOr("demo"),
                request == null ? new ConversationCreateRequest(null, null, null) : request
        );
    }

    public Optional<ConversationVO> get(String id) {
        return store.find(id);
    }

    public Optional<ConversationVO> update(String id, ConversationUpdateRequest request) {
        return store.update(id, request == null
                ? new ConversationUpdateRequest(null, null, null, null)
                : request);
    }

    public boolean delete(String id) {
        return store.delete(id);
    }

    public List<ConversationMessageVO> messages(String id) {
        return store.listMessages(id);
    }

    public ConversationMessageVO appendMessage(String id, ConversationMessageCreateRequest request) {
        String role = request == null || request.role() == null || request.role().isBlank() ? "user" : request.role().trim();
        String content = request == null || request.content() == null ? "" : request.content();
        List<Map<String, Object>> atts = request == null ? List.of() : request.attachments();
        return store.appendMessage(id, role, content, atts == null ? List.of() : atts);
    }

    public List<ConversationRevisionVO> revisions(String id) {
        return store.listRevisions(id);
    }

    public Optional<ConversationRevisionVO> restore(String conversationId, String revId) {
        Optional<ConversationRevisionVO> rev = store.findRevision(revId);
        if (rev.isEmpty()) return Optional.empty();
        if (!conversationId.equals(rev.get().conversationId())) return Optional.empty();
        applier.restoreSnapshot(rev.get().dashboardId(), rev.get().snapshot());
        store.update(conversationId, new ConversationUpdateRequest(
                null, null, null, rev.get().dashboardId()
        ));
        return rev;
    }

    /** 生成落盘后记录一个版本：把 dashboard 的权威快照 + patch 存为 revision，支持历史回滚/回溯。 */
    public Optional<ConversationRevisionVO> recordRevision(
            String conversationId,
            String runId,
            String dashboardId,
            Map<String, Object> patch,
            String label
    ) {
        Optional<ConversationVO> conv = store.find(conversationId);
        if (conv.isEmpty()) return Optional.empty();
        Map<String, Object> snapshot = applier.snapshotOf(dashboardId);
        ConversationRevisionVO rev = store.createRevision(
                conversationId, runId, dashboardId,
                patch == null ? Map.of() : patch,
                snapshot,
                label == null || label.isBlank() ? "ai-generated" : label
        );
        return Optional.of(rev);
    }

    public Optional<ConversationRunVO> cancel(String conversationId, String runId) {
        Optional<ConversationRunVO> run = store.findRun(runId);
        if (run.isEmpty() || !conversationId.equals(run.get().conversationId())) {
            return Optional.empty();
        }
        return store.updateRun(runId, "cancelled", null, "cancelled", "user_cancel");
    }

    public void startRunAsync(
            String conversationId,
            ConversationRunRequest request,
            ConversationHarness.Emitter emitter
    ) {
        ConversationVO conversation = store.find(conversationId)
                .orElseThrow(() -> new IllegalArgumentException("conversation not found"));
        ConversationRunRequest req = request == null
                ? new ConversationRunRequest("", null, "auto", null, null, null, null)
                : request;
        if (req.message() == null || req.message().isBlank()) {
            throw new IllegalArgumentException("message required");
        }
        if (req.datasetIds() != null && !req.datasetIds().isEmpty()) {
            store.update(conversationId, new ConversationUpdateRequest(null, null, req.datasetIds(), null));
            conversation = store.find(conversationId).orElse(conversation);
        }
        String intent = AskAnswerPlanner.resolveIntent(req.intent(), req.message());
        store.appendMessage(conversationId, "user", req.message(), List.of());
        ConversationRunVO run = store.createRun(conversationId, req.mode(), req.styleId());
        AuthPrincipal principal = AuthContext.get();
        ConversationVO convFinal = conversation;
        executor.execute(() -> runWithPrincipal(principal, () -> {
            try {
                emitter.emit("run", Map.of(
                        "runId", run.id(),
                        "conversationId", conversationId,
                        "mode", run.mode() == null ? "auto" : run.mode(),
                        "intent", intent
                ));
                harness.startRun(convFinal, run, req, emitter);
            } catch (Exception e) {
                emitter.emit("error", Map.of("message", e.getMessage() == null ? e.toString() : e.getMessage()));
                emitter.emit("finish", Map.of("reason", "error", "detail", "exception"));
            }
        }));
    }

    public void adoptAsync(
            String conversationId,
            String runId,
            ConversationAdoptRequest request,
            ConversationHarness.Emitter emitter
    ) {
        ConversationVO conversation = store.find(conversationId)
                .orElseThrow(() -> new IllegalArgumentException("conversation not found"));
        ConversationRunVO run = store.findRun(runId)
                .orElseThrow(() -> new IllegalArgumentException("run not found"));
        if (!conversationId.equals(run.conversationId())) {
            throw new IllegalArgumentException("run mismatch");
        }
        if (!"answered".equals(run.status())) {
            throw new IllegalStateException("run has no answer to adopt");
        }
        if (run.plan() != null && "clarify".equals(String.valueOf(run.plan().get("intent")))) {
            throw new IllegalStateException("clarify answer cannot be adopted");
        }
        AuthPrincipal principal = AuthContext.get();
        executor.execute(() -> runWithPrincipal(principal, () -> {
            try {
                emitter.emit("run", Map.of(
                        "runId", run.id(),
                        "conversationId", conversationId,
                        "mode", "adopt",
                        "intent", "gen"
                ));
                harness.adoptAnswer(conversation, run, request, emitter);
            } catch (Exception e) {
                emitter.emit("error", Map.of("message", e.getMessage() == null ? e.toString() : e.getMessage()));
                emitter.emit("finish", Map.of("reason", "error", "detail", "exception"));
            }
        }));
    }

    public void confirmPlanAsync(String conversationId, String runId, ConversationHarness.Emitter emitter) {
        ConversationVO conversation = store.find(conversationId)
                .orElseThrow(() -> new IllegalArgumentException("conversation not found"));
        ConversationRunVO run = store.findRun(runId)
                .orElseThrow(() -> new IllegalArgumentException("run not found"));
        if (!conversationId.equals(run.conversationId())) {
            throw new IllegalArgumentException("run mismatch");
        }
        if (!"awaiting_confirm".equals(run.status())) {
            throw new IllegalStateException("run is not awaiting confirm");
        }
        AuthPrincipal principal = AuthContext.get();
        executor.execute(() -> runWithPrincipal(principal, () -> {
            try {
                harness.confirmPlan(conversation, run, emitter);
            } catch (Exception e) {
                emitter.emit("error", Map.of("message", e.getMessage() == null ? e.toString() : e.getMessage()));
                emitter.emit("finish", Map.of("reason", "error", "detail", "exception"));
            }
        }));
    }

    private void runWithPrincipal(AuthPrincipal principal, Runnable action) {
        try {
            if (principal != null) AuthContext.set(principal);
            action.run();
        } finally {
            AuthContext.clear();
        }
    }
}
