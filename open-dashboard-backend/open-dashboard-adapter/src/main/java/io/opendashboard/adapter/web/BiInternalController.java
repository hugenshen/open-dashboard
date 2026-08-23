package io.opendashboard.adapter.web;

import io.opendashboard.application.conversation.BiPlatformService;
import io.opendashboard.application.conversation.ConversationAppService;
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

import java.util.List;
import java.util.Map;

/**
 * Internal BI APIs for opendashboard-harness. No LLM here.
 * Auth: {@code X-OD-Internal-Token} (service-to-service) plus Auth SPI headers
 * {@code X-User-Id} / {@code X-User-Perms} so askable gates cannot be skipped
 * with the internal token alone. No {@code @RequireAuth} — the interceptor still
 * binds {@code AuthContext} from those headers.
 */
@RestController
@RequestMapping("/api/internal/bi")
public class BiInternalController {

    private final BiPlatformService bi;
    private final ConversationProperties props;
    private final ConversationAppService conversations;

    public BiInternalController(
            BiPlatformService bi,
            ConversationProperties props,
            ConversationAppService conversations
    ) {
        this.bi = bi;
        this.props = props;
        this.conversations = conversations;
    }

    private boolean authed(String token) {
        String expected = props.getHarness().getInternalToken();
        return expected != null && !expected.isBlank() && expected.equals(token);
    }

    private ResponseEntity<?> deny(IllegalArgumentException e) {
        String msg = e.getMessage() == null ? "forbidden" : e.getMessage();
        if (msg.startsWith("DATASET_UNAVAILABLE")) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", msg));
        }
        return ResponseEntity.badRequest().body(Map.of("error", msg));
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
        try {
            return bi.schema(id).<ResponseEntity<?>>map(ResponseEntity::ok)
                    .orElseGet(() -> ResponseEntity.notFound().build());
        } catch (IllegalArgumentException e) {
            return deny(e);
        }
    }

    @PostMapping("/query/dataset")
    public ResponseEntity<?> datasetQuery(
            @RequestBody DatasetQueryRequest request,
            @RequestHeader(value = "X-OD-Internal-Token", required = false) String token
    ) {
        if (!authed(token)) return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        try {
            return ResponseEntity.ok(bi.datasetQuery(request));
        } catch (IllegalArgumentException e) {
            return deny(e);
        }
    }

    @PostMapping("/query/chart")
    public ResponseEntity<?> chartQuery(
            @RequestBody ChartQueryRequest request,
            @RequestHeader(value = "X-OD-Internal-Token", required = false) String token
    ) {
        if (!authed(token)) return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        try {
            return ResponseEntity.ok(bi.chartQuery(request));
        } catch (IllegalArgumentException e) {
            return deny(e);
        }
    }

    @PostMapping("/query/sql")
    public ResponseEntity<?> executeSql(
            @RequestBody Map<String, Object> body,
            @RequestHeader(value = "X-OD-Internal-Token", required = false) String token
    ) {
        if (!authed(token)) return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        try {
            return ResponseEntity.ok(bi.executeReadSql(body == null ? Map.of() : body));
        } catch (IllegalArgumentException e) {
            return deny(e);
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("error", e.getMessage() == null ? "sql failed" : e.getMessage()));
        }
    }

    @GetMapping("/board-summary")
    public ResponseEntity<?> boardSummary(
            @RequestParam(required = false) String dashboardId,
            @RequestHeader(value = "X-OD-Internal-Token", required = false) String token
    ) {
        if (!authed(token)) return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        return ResponseEntity.ok(bi.boardSummary(dashboardId));
    }

    @PostMapping("/query/cancel")
    public ResponseEntity<?> cancelQueries(
            @RequestBody(required = false) Map<String, Object> body,
            @RequestHeader(value = "X-OD-Internal-Token", required = false) String token,
            @RequestHeader(value = "X-User-Id", required = false) String userId
    ) {
        if (!authed(token)) return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        String owner = userId;
        if (body != null && body.get("owner") != null && !String.valueOf(body.get("owner")).isBlank()) {
            owner = String.valueOf(body.get("owner"));
        }
        if (body != null && Boolean.TRUE.equals(body.get("all"))) {
            owner = "";
        }
        return ResponseEntity.ok(bi.cancelLiveQueries(owner == null ? "" : owner));
    }

    @GetMapping("/query/stats")
    public ResponseEntity<?> queryStats(
            @RequestHeader(value = "X-OD-Internal-Token", required = false) String token
    ) {
        if (!authed(token)) return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        return ResponseEntity.ok(bi.liveQueryStats());
    }

    @PostMapping("/profile-dataset")
    public ResponseEntity<?> profileDataset(
            @RequestBody Map<String, Object> body,
            @RequestHeader(value = "X-OD-Internal-Token", required = false) String token
    ) {
        if (!authed(token)) return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        String datasetId = body == null || body.get("datasetId") == null ? "" : String.valueOf(body.get("datasetId"));
        try {
            return ResponseEntity.ok(bi.profileDataset(datasetId));
        } catch (IllegalArgumentException e) {
            return deny(e);
        }
    }

    @PostMapping("/learn-dataset")
    public ResponseEntity<?> learnDataset(
            @RequestBody Map<String, Object> body,
            @RequestHeader(value = "X-OD-Internal-Token", required = false) String token
    ) {
        if (!authed(token)) return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        String datasetId = body == null || body.get("datasetId") == null ? "" : String.valueOf(body.get("datasetId"));
        return ResponseEntity.ok(bi.learnDataset(datasetId));
    }

    @PostMapping("/resolve-intent")
    public ResponseEntity<?> resolveIntent(
            @RequestBody Map<String, Object> body,
            @RequestHeader(value = "X-OD-Internal-Token", required = false) String token
    ) {
        if (!authed(token)) return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        return ResponseEntity.ok(bi.resolveIntent(body == null ? Map.of() : body));
    }

    @GetMapping("/knowledge")
    public ResponseEntity<?> knowledge(
            @RequestParam(required = false) List<String> datasetIds,
            @RequestHeader(value = "X-OD-Internal-Token", required = false) String token
    ) {
        if (!authed(token)) return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        return ResponseEntity.ok(bi.knowledgeFor(datasetIds == null ? List.of() : datasetIds));
    }

    @GetMapping("/datasets/{id}/questions")
    public ResponseEntity<?> questions(
            @PathVariable String id,
            @RequestParam(required = false) Integer limit,
            @RequestHeader(value = "X-OD-Internal-Token", required = false) String token
    ) {
        if (!authed(token)) return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        return ResponseEntity.ok(bi.questionsFor(id, limit == null ? 8 : limit));
    }

    @PostMapping("/questions/{qid}/hit")
    public ResponseEntity<?> bumpQuestionHit(
            @PathVariable Long qid,
            @RequestHeader(value = "X-OD-Internal-Token", required = false) String token
    ) {
        if (!authed(token)) return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        return ResponseEntity.ok(Map.of("ok", bi.bumpQuestionHit(qid)));
    }

    @PostMapping("/interpret-fields")
    public ResponseEntity<?> interpretFields(
            @RequestBody Map<String, Object> body,
            @RequestHeader(value = "X-OD-Internal-Token", required = false) String token
    ) {
        if (!authed(token)) return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        return ResponseEntity.ok(bi.interpretFields(body == null ? Map.of() : body));
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

    @PostMapping("/record-revision")
    public ResponseEntity<?> recordRevision(
            @RequestBody Map<String, Object> body,
            @RequestHeader(value = "X-OD-Internal-Token", required = false) String token
    ) {
        if (!authed(token)) return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        String conversationId = body == null ? "" : String.valueOf(body.getOrDefault("conversationId", ""));
        String runId = body == null ? "" : String.valueOf(body.getOrDefault("runId", ""));
        String dashboardId = body == null ? "" : String.valueOf(body.getOrDefault("dashboardId", ""));
        Object patchObj = body == null ? null : body.get("patch");
        @SuppressWarnings("unchecked")
        Map<String, Object> patch = patchObj instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of();
        String label = body == null ? null : body.get("label") == null ? null : String.valueOf(body.get("label"));
        return conversations.recordRevision(conversationId, runId, dashboardId, patch, label)
                .<ResponseEntity<?>>map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }
}
