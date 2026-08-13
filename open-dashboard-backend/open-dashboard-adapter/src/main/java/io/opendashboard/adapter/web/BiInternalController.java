package io.opendashboard.adapter.web;

import io.opendashboard.application.conversation.BiPlatformService;
import io.opendashboard.application.conversation.ConversationProperties;
import io.opendashboard.domain.QueryDtos.ChartQueryRequest;
import io.opendashboard.domain.QueryDtos.DatasetQueryRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * Internal BI APIs for DeerFlow / opendashboard-harness. No LLM here.
 * Auth: header X-OD-Internal-Token (no @RequireAuth — service-to-service).
 */
@RestController
@RequestMapping("/api/internal/bi")
public class BiInternalController {

    private final BiPlatformService bi;
    private final ConversationProperties props;

    public BiInternalController(BiPlatformService bi, ConversationProperties props) {
        this.bi = bi;
        this.props = props;
    }

    private boolean authed(String token) {
        String expected = props.getHarness().getInternalToken();
        return expected != null && !expected.isBlank() && expected.equals(token);
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        return Map.of("ok", true, "role", "bi-platform");
    }

    @GetMapping("/datasets")
    public ResponseEntity<?> datasets(@RequestHeader(value = "X-OD-Internal-Token", required = false) String token) {
        if (!authed(token)) return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        return ResponseEntity.ok(bi.listDatasets());
    }

    @GetMapping("/datasets/{id}/schema")
    public ResponseEntity<?> schema(
            @PathVariable String id,
            @RequestHeader(value = "X-OD-Internal-Token", required = false) String token
    ) {
        if (!authed(token)) return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        return bi.schema(id).<ResponseEntity<?>>map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PostMapping("/query/dataset")
    public ResponseEntity<?> datasetQuery(
            @RequestBody DatasetQueryRequest request,
            @RequestHeader(value = "X-OD-Internal-Token", required = false) String token
    ) {
        if (!authed(token)) return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        return ResponseEntity.ok(bi.datasetQuery(request));
    }

    @PostMapping("/query/chart")
    public ResponseEntity<?> chartQuery(
            @RequestBody ChartQueryRequest request,
            @RequestHeader(value = "X-OD-Internal-Token", required = false) String token
    ) {
        if (!authed(token)) return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        return ResponseEntity.ok(bi.chartQuery(request));
    }

    @GetMapping("/board-summary")
    public ResponseEntity<?> boardSummary(
            @RequestParam(required = false) String dashboardId,
            @RequestHeader(value = "X-OD-Internal-Token", required = false) String token
    ) {
        if (!authed(token)) return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        return ResponseEntity.ok(bi.boardSummary(dashboardId));
    }

    @PostMapping("/compose-board")
    public ResponseEntity<?> composeBoard(
            @RequestBody Map<String, Object> body,
            @RequestHeader(value = "X-OD-Internal-Token", required = false) String token
    ) {
        if (!authed(token)) return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        return ResponseEntity.ok(bi.composeBoard(body));
    }

    @PostMapping("/apply-patch")
    public ResponseEntity<?> applyPatch(
            @RequestBody Map<String, Object> body,
            @RequestHeader(value = "X-OD-Internal-Token", required = false) String token
    ) {
        if (!authed(token)) return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        return ResponseEntity.ok(bi.applyPatch(body));
    }
}
