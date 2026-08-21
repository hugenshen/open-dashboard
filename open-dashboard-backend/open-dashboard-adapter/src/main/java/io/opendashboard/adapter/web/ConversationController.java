package io.opendashboard.adapter.web;

import io.opendashboard.adapter.security.RequireAuth;
import io.opendashboard.adapter.security.RequirePermission;
import io.opendashboard.application.conversation.ConversationAppService;
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
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/conversations")
@RequireAuth
public class ConversationController {

    private final ConversationAppService service;

    public ConversationController(ConversationAppService service) {
        this.service = service;
    }

    @GetMapping("/feature")
    public FeatureStatusVO feature() {
        return service.feature();
    }

    @GetMapping("/styles")
    public ResponseEntity<List<StylePresetVO>> styles() {
        if (!service.enabled()) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(service.styles());
    }

    @GetMapping
    @RequirePermission("conversation:use")
    public ResponseEntity<List<ConversationVO>> list(
            @RequestParam(required = false) Integer limit
    ) {
        if (!service.enabled()) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(service.list(limit));
    }

    @PostMapping
    @RequirePermission("conversation:use")
    public ResponseEntity<ConversationVO> create(@RequestBody(required = false) ConversationCreateRequest request) {
        if (!service.enabled()) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(service.create(request));
    }

    @GetMapping("/{id}")
    @RequirePermission("conversation:use")
    public ResponseEntity<ConversationVO> get(@PathVariable String id) {
        if (!service.enabled()) return ResponseEntity.notFound().build();
        return service.get(id).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PatchMapping("/{id}")
    @RequirePermission("conversation:use")
    public ResponseEntity<ConversationVO> update(
            @PathVariable String id,
            @RequestBody ConversationUpdateRequest request
    ) {
        if (!service.enabled()) return ResponseEntity.notFound().build();
        return service.update(id, request).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
    }

    @DeleteMapping("/{id}")
    @RequirePermission("conversation:use")
    public ResponseEntity<Void> delete(@PathVariable String id) {
        if (!service.enabled()) return ResponseEntity.notFound().build();
        return service.delete(id) ? ResponseEntity.noContent().build() : ResponseEntity.notFound().build();
    }

    @GetMapping("/{id}/messages")
    @RequirePermission("conversation:use")
    public ResponseEntity<List<ConversationMessageVO>> messages(@PathVariable String id) {
        if (!service.enabled()) return ResponseEntity.notFound().build();
        if (service.get(id).isEmpty()) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(service.messages(id));
    }

    @PostMapping("/{id}/messages")
    @RequirePermission("conversation:use")
    public ResponseEntity<ConversationMessageVO> appendMessage(
            @PathVariable String id,
            @RequestBody(required = false) ConversationMessageCreateRequest request
    ) {
        if (!service.enabled()) return ResponseEntity.notFound().build();
        if (service.get(id).isEmpty()) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(service.appendMessage(id, request));
    }

    @PostMapping(value = "/{id}/runs", produces = MediaType.APPLICATION_JSON_VALUE)
    @RequirePermission("conversation:use")
    public ResponseEntity<Map<String, String>> startRun(
            @PathVariable String id,
            @RequestBody(required = false) ConversationRunRequest request
    ) {
        // Deprecated: FE must call opendashboard-harness directly (/harness/v1/conversations/*/runs).
        return ResponseEntity.status(HttpStatus.GONE).body(Map.of(
                "code", "HARNESS_DIRECT",
                "message", "请直连 opendashboard-harness：POST /harness/v1/conversations/" + id + "/runs"
        ));
    }

    @PostMapping("/{id}/runs/{runId}/cancel")
    @RequirePermission("conversation:use")
    public ResponseEntity<ConversationRunVO> cancel(@PathVariable String id, @PathVariable String runId) {
        if (!service.enabled()) return ResponseEntity.notFound().build();
        return service.cancel(id, runId).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PostMapping(value = "/{id}/runs/{runId}/confirm-plan", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    @RequirePermission("conversation:use")
    public ResponseEntity<SseEmitter> confirmPlan(@PathVariable String id, @PathVariable String runId) {
        if (!service.enabled()) return ResponseEntity.notFound().build();
        SseEmitter emitter = new SseEmitter(300_000L);
        try {
            service.confirmPlanAsync(id, runId, (event, data) -> send(emitter, event, data));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT).build();
        }
        emitter.onTimeout(emitter::complete);
        return ResponseEntity.ok(emitter);
    }

    @GetMapping("/{id}/revisions")
    @RequirePermission("conversation:use")
    public ResponseEntity<List<ConversationRevisionVO>> revisions(@PathVariable String id) {
        if (!service.enabled()) return ResponseEntity.notFound().build();
        if (service.get(id).isEmpty()) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(service.revisions(id));
    }

    @PostMapping("/{id}/revisions/{rev}/restore")
    @RequirePermission("conversation:use")
    public ResponseEntity<ConversationRevisionVO> restore(@PathVariable String id, @PathVariable String rev) {
        if (!service.enabled()) return ResponseEntity.notFound().build();
        return service.restore(id, rev).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
    }

    private void send(SseEmitter emitter, String event, Map<String, Object> data) {
        try {
            emitter.send(SseEmitter.event().name(event).data(data, MediaType.APPLICATION_JSON));
            if ("finish".equals(event)) {
                emitter.complete();
            }
        } catch (IOException e) {
            try {
                emitter.completeWithError(e);
            } catch (Exception ignored) {
                /* ignore */
            }
        }
    }
}
