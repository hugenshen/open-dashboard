package io.opendashboard.adapter.web;

import io.opendashboard.adapter.security.RequireAuth;
import io.opendashboard.adapter.security.RequirePermission;
import io.opendashboard.application.report.ReportRunAppService;
import io.opendashboard.domain.ReportRunDtos.*;
import io.opendashboard.domain.context.AuthContext;
import io.opendashboard.domain.context.AuthPrincipal;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@RestController
@RequestMapping("/api/conversations/{conversationId}/report-runs")
@RequireAuth
@RequirePermission("conversation:use")
public class ReportRunController {
    private final ReportRunAppService service;
    private final ExecutorService streamExecutor = Executors.newVirtualThreadPerTaskExecutor();

    public ReportRunController(ReportRunAppService service) { this.service = service; }

    @PostMapping
    public ReportRunDetailVO create(@PathVariable String conversationId,
            @RequestBody(required = false) ReportRunCreateRequest request) {
        return service.create(conversationId, request);
    }

    @GetMapping("/latest")
    public ReportRunDetailVO latest(@PathVariable String conversationId) {
        return service.latest(conversationId);
    }

    @GetMapping("/{runId}")
    public ReportRunDetailVO get(@PathVariable String conversationId, @PathVariable String runId) {
        return service.get(conversationId, runId);
    }

    @PatchMapping("/{runId}/brief")
    public ReportRunDetailVO updateBrief(@PathVariable String conversationId, @PathVariable String runId,
            @RequestBody ReportBriefUpdateRequest request) {
        return service.updateBrief(conversationId, runId, request);
    }

    @PutMapping("/{runId}/plan")
    public ReportRunDetailVO updatePlan(@PathVariable String conversationId, @PathVariable String runId,
            @RequestBody ReportPlanUpdateRequest request) {
        return service.updatePlan(conversationId, runId, request);
    }

    @PostMapping("/{runId}/confirm-plan")
    public ReportRunDetailVO confirmPlan(@PathVariable String conversationId, @PathVariable String runId,
            @RequestBody(required = false) ReportRunActionRequest request) {
        return service.confirmPlan(conversationId, runId, request);
    }

    @PostMapping("/{runId}/actions")
    public ReportRunDetailVO action(@PathVariable String conversationId, @PathVariable String runId,
            @RequestBody ReportRunActionRequest request) {
        return service.action(conversationId, runId, request);
    }

    @GetMapping(value = "/{runId}/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter events(@PathVariable String conversationId, @PathVariable String runId,
            @RequestHeader(name = "Last-Event-ID", required = false) String lastEventId) {
        long cursor = parseCursor(lastEventId);
        service.events(conversationId, runId, cursor);
        AuthPrincipal principal = AuthContext.require();
        SseEmitter emitter = new SseEmitter(300_000L);
        streamExecutor.execute(() -> stream(principal, conversationId, runId, cursor, emitter));
        emitter.onTimeout(emitter::complete);
        return emitter;
    }

    @GetMapping("/{runId}/claims")
    public List<ReportClaimVO> claims(@PathVariable String conversationId, @PathVariable String runId) {
        return service.claims(conversationId, runId);
    }

    @GetMapping("/{runId}/artifacts")
    public List<ReportArtifactVO> artifacts(@PathVariable String conversationId, @PathVariable String runId) {
        return service.artifacts(conversationId, runId);
    }

    @PostMapping("/{runId}/rewrites")
    public ReportRunDetailVO rewrite(@PathVariable String conversationId, @PathVariable String runId,
            @RequestBody ReportRewriteRequest request) {
        return service.rewrite(conversationId, runId, request);
    }

    @GetMapping(value = "/{runId}/package", produces = "application/zip")
    public ResponseEntity<byte[]> packageFile(@PathVariable String conversationId, @PathVariable String runId) {
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=report-run-" + runId + ".zip")
                .body(service.packageBytes(conversationId, runId));
    }

    @PostMapping("/{runId}/save-as-report")
    @RequirePermission("report:manage")
    public SaveAsReportVO saveAsReport(@PathVariable String conversationId, @PathVariable String runId) {
        return service.saveAsReport(conversationId, runId);
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, String>> invalid(IllegalArgumentException error) {
        String message = error.getMessage() == null ? "INVALID_REQUEST" : error.getMessage();
        HttpStatus status = message.contains("NOT_FOUND") ? HttpStatus.NOT_FOUND : HttpStatus.UNPROCESSABLE_ENTITY;
        return ResponseEntity.status(status).body(Map.of("code", message));
    }

    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<Map<String, String>> conflict(IllegalStateException error) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(Map.of("code", error.getMessage() == null ? "CONFLICT" : error.getMessage()));
    }

    private void stream(AuthPrincipal principal, String conversationId, String runId, long initialCursor, SseEmitter emitter) {
        long cursor = initialCursor;
        try {
            AuthContext.set(principal);
            for (int idle = 0; idle < 600; idle++) {
                List<ReportEventVO> rows = service.events(conversationId, runId, cursor);
                if (!rows.isEmpty()) idle = 0;
                for (ReportEventVO row : rows) {
                    emitter.send(SseEmitter.event().id(row.id()).name(row.eventType()).data(row, MediaType.APPLICATION_JSON));
                    cursor = Long.parseLong(row.id());
                }
                if (service.terminal(runId) && rows.isEmpty()) break;
                Thread.sleep(500L);
            }
            safeComplete(emitter);
        } catch (IOException ignored) {
            // The client already disconnected; dispatching another completion can race Tomcat's onError.
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            safeComplete(emitter);
        } catch (Exception error) {
            try { emitter.completeWithError(error); } catch (Exception ignored) { /* async context already closed */ }
        } finally {
            AuthContext.clear();
        }
    }

    private static void safeComplete(SseEmitter emitter) {
        try { emitter.complete(); } catch (Exception ignored) { /* async context already closed */ }
    }

    private static long parseCursor(String value) {
        if (value == null || value.isBlank()) return 0L;
        try { return Long.parseLong(value); } catch (NumberFormatException ignored) { return 0L; }
    }
}
