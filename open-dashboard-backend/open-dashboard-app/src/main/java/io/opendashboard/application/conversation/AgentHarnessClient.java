package io.opendashboard.application.conversation;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;

/** Proxies conversation runs to opendashboard-harness / DeerFlow-style agent. */
@Component
public class AgentHarnessClient {

    private final ConversationProperties props;
    private final ObjectMapper mapper;
    private final HttpClient http = HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();

    public AgentHarnessClient(ConversationProperties props, ObjectMapper mapper) {
        this.props = props;
        this.mapper = mapper;
    }

    public boolean available() {
        try {
            String url = trimSlash(props.getHarness().getBaseUrl()) + "/health";
            HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(3))
                    .GET()
                    .build();
            HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            return resp.statusCode() >= 200 && resp.statusCode() < 300;
        } catch (Exception e) {
            return false;
        }
    }

    public void proxyRun(Map<String, Object> payload, ConversationHarness.Emitter emitter) throws Exception {
        String url = trimSlash(props.getHarness().getBaseUrl()) + "/v1/runs";
        byte[] body = mapper.writeValueAsBytes(payload);
        HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofMillis(Math.max(30_000L, props.getHarness().getTimeoutMs())))
                .header("Content-Type", "application/json")
                .header("Accept", "text/event-stream")
                .header("X-OD-Internal-Token", props.getHarness().getInternalToken())
                .POST(HttpRequest.BodyPublishers.ofByteArray(body))
                .build();

        HttpResponse<java.io.InputStream> resp = http.send(req, HttpResponse.BodyHandlers.ofInputStream());
        if (resp.statusCode() >= 400) {
            String err = new String(resp.body().readAllBytes(), StandardCharsets.UTF_8);
            emitter.emit("error", Map.of(
                    "code", "HARNESS_HTTP",
                    "message", "harness HTTP " + resp.statusCode() + ": " + err
            ));
            emitter.emit("finish", Map.of("reason", "error", "detail", "harness_http"));
            return;
        }

        try (BufferedReader reader = new BufferedReader(new InputStreamReader(resp.body(), StandardCharsets.UTF_8))) {
            String event = null;
            StringBuilder data = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                if (line.isEmpty()) {
                    if (event != null && !data.isEmpty()) {
                        dispatch(event, data.toString(), emitter);
                    }
                    event = null;
                    data.setLength(0);
                    continue;
                }
                if (line.startsWith("event:")) {
                    event = line.substring(6).trim();
                } else if (line.startsWith("data:")) {
                    if (!data.isEmpty()) data.append('\n');
                    data.append(line.substring(5).trim());
                }
            }
            if (event != null && !data.isEmpty()) {
                dispatch(event, data.toString(), emitter);
            }
        }
    }

    private void dispatch(String event, String dataJson, ConversationHarness.Emitter emitter) {
        try {
            Map<String, Object> data = mapper.readValue(dataJson, new TypeReference<>() {});
            emitter.emit(event, data);
        } catch (Exception e) {
            Map<String, Object> wrap = new LinkedHashMap<>();
            wrap.put("raw", dataJson);
            emitter.emit(event, wrap);
        }
    }

    private static String trimSlash(String s) {
        if (s == null || s.isBlank()) return "http://127.0.0.1:8091";
        return s.endsWith("/") ? s.substring(0, s.length() - 1) : s;
    }
}
