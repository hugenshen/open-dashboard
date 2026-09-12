package io.opendashboard.adapter.web;

import io.opendashboard.adapter.security.RequireAuth;
import io.opendashboard.application.conversation.ConversationProperties;
import io.opendashboard.application.report.ReportRunAppService;
import io.opendashboard.domain.ReportRunDtos.*;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/internal/report-runs")
@RequireAuth
public class InternalReportRunController {
    private final ReportRunAppService service;
    private final ConversationProperties props;

    public InternalReportRunController(ReportRunAppService service, ConversationProperties props) {
        this.service = service;
        this.props = props;
    }

    @PostMapping("/{runId}/events")
    public ReportEventVO event(@PathVariable String runId, @RequestBody ReportEventCreateRequest request,
            @RequestHeader(value = "X-OD-Internal-Token", required = false) String token) {
        requireInternal(token);
        return service.appendEvent(runId, request);
    }

    @PostMapping("/{runId}/evidence")
    public ReportEvidenceVO evidence(@PathVariable String runId, @RequestBody ReportEvidenceCreateRequest request,
            @RequestHeader(value = "X-OD-Internal-Token", required = false) String token) {
        requireInternal(token);
        return service.appendEvidence(runId, request);
    }

    @PostMapping("/{runId}/artifacts")
    public ReportArtifactVO artifact(@PathVariable String runId, @RequestBody ReportArtifactCreateRequest request,
            @RequestHeader(value = "X-OD-Internal-Token", required = false) String token) {
        requireInternal(token);
        return service.appendArtifact(runId, request);
    }

    @PostMapping("/{runId}/quality-results")
    public ReportRunDetailVO quality(@PathVariable String runId, @RequestBody ReportQualityUpdateRequest request,
            @RequestHeader(value = "X-OD-Internal-Token", required = false) String token) {
        requireInternal(token);
        return service.updateQuality(runId, request);
    }

    private void requireInternal(String token) {
        String expected = props.getHarness().getInternalToken();
        if (expected == null || expected.isBlank() || !expected.equals(token)) {
            throw new org.springframework.web.server.ResponseStatusException(HttpStatus.UNAUTHORIZED, "INVALID_INTERNAL_TOKEN");
        }
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
}
