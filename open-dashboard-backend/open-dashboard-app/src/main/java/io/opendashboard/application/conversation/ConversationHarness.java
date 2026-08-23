package io.opendashboard.application.conversation;

import io.opendashboard.domain.ConversationDtos.ConversationRunRequest;
import io.opendashboard.domain.ConversationDtos.ConversationRunVO;
import io.opendashboard.domain.ConversationDtos.ConversationVO;
import io.opendashboard.domain.gateway.ConversationGateway;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * Public conversation runs are gone (P011). Java keeps this stub so leftover
 * /runs callers get a clear error; Agent lives in opendashboard-dsh-harness.
 */
@Component
public class ConversationHarness {

    public interface Emitter {
        void emit(String event, Map<String, Object> data);
    }

    private final ConversationGateway store;

    public ConversationHarness(ConversationGateway store) {
        this.store = store;
    }

    public void startRun(
            ConversationVO conversation,
            ConversationRunVO run,
            ConversationRunRequest request,
            Emitter emitter
    ) {
        reject(run.id(), emitter);
    }

    public void confirmPlan(ConversationVO conversation, ConversationRunVO run, Emitter emitter) {
        reject(run.id(), emitter);
    }

    private void reject(String runId, Emitter emitter) {
        emitter.emit("error", Map.of(
                "code", "HARNESS_DIRECT",
                "message", "Conversation runs 已迁到 opendashboard-dsh-harness。"
                        + " 请打开产品「对话」入口，不要再调用 /api/conversations/*/runs。"
        ));
        store.updateRun(runId, "error", null, "error", "use_dsh");
        emitter.emit("finish", Map.of("reason", "error", "detail", "use_dsh"));
    }
}
