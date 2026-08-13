package io.opendashboard.application.conversation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** OpenAI-compatible chat completions client for structured DashboardPatch JSON. */
@Component
public class OpenAiCompatibleLlmClient {

    private static final Logger log = LoggerFactory.getLogger(OpenAiCompatibleLlmClient.class);

    private final ConversationProperties props;
    private final ObjectMapper mapper;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build();

    public OpenAiCompatibleLlmClient(ConversationProperties props, ObjectMapper mapper) {
        this.props = props;
        this.mapper = mapper;
    }

    public boolean isEnabled() {
        ConversationProperties.Llm llm = props.getLlm();
        return llm.isEnabled() && llm.getApiKey() != null && !llm.getApiKey().isBlank();
    }

    public Optional<DashboardPatch.Patch> proposePatch(
            String dashboardId,
            String styleId,
            String message,
            SchemaGuard.SchemaBundle schema
    ) {
        if (!isEnabled()) return Optional.empty();
        try {
            String body = buildRequestBody(dashboardId, styleId, message, schema);
            ConversationProperties.Llm llm = props.getLlm();
            String base = llm.getBaseUrl().endsWith("/")
                    ? llm.getBaseUrl().substring(0, llm.getBaseUrl().length() - 1)
                    : llm.getBaseUrl();
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(base + "/chat/completions"))
                    .timeout(Duration.ofMillis(Math.max(5_000L, llm.getTimeoutMs())))
                    .header("Authorization", "Bearer " + llm.getApiKey())
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() >= 300) {
                log.warn("LLM HTTP {}: {}", res.statusCode(), truncate(res.body(), 200));
                return Optional.empty();
            }
            JsonNode root = mapper.readTree(res.body());
            String content = root.path("choices").path(0).path("message").path("content").asText("");
            Map<String, Object> patchMap = extractJsonObject(content);
            if (patchMap.isEmpty()) return Optional.empty();
            DashboardPatch.Patch patch = DashboardPatch.Patch.fromMap(patchMap);
            if (patch.dashboardId() == null || patch.dashboardId().isBlank()) {
                patch = new DashboardPatch.Patch(dashboardId, patch.ops());
            }
            List<String> errors = SchemaGuard.validateOps(patch.ops(), schema);
            if (!errors.isEmpty()) {
                log.warn("LLM patch failed Schema Guard: {}", errors);
                return Optional.empty();
            }
            return Optional.of(patch);
        } catch (Exception e) {
            log.warn("LLM proposePatch failed: {}", e.toString());
            return Optional.empty();
        }
    }

    private String buildRequestBody(
            String dashboardId,
            String styleId,
            String message,
            SchemaGuard.SchemaBundle schema
    ) throws Exception {
        Map<String, Object> schemaBrief = new LinkedHashMap<>();
        schema.byId().forEach((id, detail) -> {
            List<Map<String, String>> fields = new ArrayList<>();
            detail.fields().forEach(f -> fields.add(Map.of(
                    "name", f.name() == null ? "" : f.name(),
                    "group", f.group() == null ? "" : f.group(),
                    "label", f.label() == null ? "" : f.label()
            )));
            schemaBrief.put(id, fields);
        });
        String system = """
                You are Open Dashboard conversation planner. Reply with ONLY a JSON object:
                {"dashboardId":"...","ops":[{"op":"upsert_chart|upsert_component|set_layout|set_theme",...}]}
                Rules: use only provided datasetIds/field names; never include query result rows;
                prefer kpi + bar + line; chartId must be numeric strings.
                """;
        Map<String, Object> user = new LinkedHashMap<>();
        user.put("dashboardId", dashboardId);
        user.put("styleId", styleId);
        user.put("message", message);
        user.put("schemas", schemaBrief);

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", props.getLlm().getModel());
        payload.put("temperature", 0.2);
        payload.put("messages", List.of(
                Map.of("role", "system", "content", system),
                Map.of("role", "user", "content", mapper.writeValueAsString(user))
        ));
        return mapper.writeValueAsString(payload);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> extractJsonObject(String content) throws Exception {
        if (content == null || content.isBlank()) return Map.of();
        String trimmed = content.trim();
        if (trimmed.startsWith("```")) {
            int start = trimmed.indexOf('{');
            int end = trimmed.lastIndexOf('}');
            if (start >= 0 && end > start) trimmed = trimmed.substring(start, end + 1);
        }
        int start = trimmed.indexOf('{');
        int end = trimmed.lastIndexOf('}');
        if (start < 0 || end <= start) return Map.of();
        return mapper.readValue(trimmed.substring(start, end + 1), Map.class);
    }

    private static String truncate(String s, int n) {
        if (s == null) return "";
        return s.length() <= n ? s : s.substring(0, n);
    }
}
