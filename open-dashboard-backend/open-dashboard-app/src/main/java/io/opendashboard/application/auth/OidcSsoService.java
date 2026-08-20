package io.opendashboard.application.auth;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.opendashboard.domain.exception.UnauthorizedException;
import io.opendashboard.domain.gateway.IdentityRepository;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class OidcSsoService {

    private final SsoProperties properties;
    private final IdentityRepository repo;
    private final IdentityService identityService;
    private final ObjectMapper objectMapper;
    private final SecureRandom random = new SecureRandom();
    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    public OidcSsoService(
            SsoProperties properties,
            IdentityRepository repo,
            IdentityService identityService,
            ObjectMapper objectMapper
    ) {
        this.properties = properties;
        this.repo = repo;
        this.identityService = identityService;
        this.objectMapper = objectMapper;
    }

    public List<ProviderSummary> providers() {
        return properties.getProviders().entrySet().stream()
                .map(e -> {
                    SsoProperties.Provider p = properties.provider(e.getKey());
                    return new ProviderSummary(e.getKey(), p.getLabel(), properties.isEnabled() && ready(p));
                })
                .sorted(Comparator.comparing(ProviderSummary::id))
                .toList();
    }

    public AuthorizationStart start(String providerId, String postLoginRedirect) {
        SsoProperties.Provider provider = requireProvider(providerId);
        String state = randomToken(32);
        String nonce = randomToken(24);
        String codeVerifier = randomToken(64);
        long now = System.currentTimeMillis();
        long ttlMillis = Math.max(60, properties.getStateTtlSeconds()) * 1000L;
        repo.saveSsoState(new IdentityRepository.SsoState(
                IdentityService.hashToken(state),
                providerId,
                nonce,
                codeVerifier,
                safeRedirect(postLoginRedirect),
                now,
                now + ttlMillis,
                null
        ));

        List<String> params = new ArrayList<>();
        add(params, "response_type", "code");
        add(params, "client_id", provider.getClientId());
        add(params, "redirect_uri", provider.getRedirectUri());
        add(params, "scope", String.join(" ", provider.getScopes()));
        add(params, "state", state);
        add(params, "nonce", nonce);
        add(params, "code_challenge", sha256Base64Url(codeVerifier));
        add(params, "code_challenge_method", "S256");
        String url = provider.getAuthorizationUri() + (provider.getAuthorizationUri().contains("?") ? "&" : "?") + String.join("&", params);
        return new AuthorizationStart(url, state, ttlMillis / 1000L);
    }

    public SsoLoginResult complete(String providerId, String state, String cookieState, String code, String userAgent) {
        if (state == null || state.isBlank() || !state.equals(cookieState)) {
            throw new UnauthorizedException("SSO state mismatch");
        }
        SsoProperties.Provider provider = requireProvider(providerId);
        long now = System.currentTimeMillis();
        IdentityRepository.SsoState saved = repo.consumeSsoState(IdentityService.hashToken(state), now)
                .orElseThrow(() -> new UnauthorizedException("SSO state expired"));
        if (!providerId.equals(saved.provider())) {
            throw new UnauthorizedException("SSO provider mismatch");
        }
        Map<String, Object> token = exchangeCode(provider, code, saved.codeVerifier());
        String accessToken = text(token.get("access_token"));
        if (accessToken == null || accessToken.isBlank()) {
            throw new UnauthorizedException("SSO token response missing access_token");
        }
        Map<String, Object> profile = loadUserInfo(provider, accessToken);
        String subject = text(profile.get("sub"));
        if (subject == null || subject.isBlank()) {
            throw new UnauthorizedException("SSO userinfo missing subject");
        }
        String email = text(profile.get("email"));
        String name = firstNonBlank(text(profile.get("name")), text(profile.get("preferred_username")), email, providerId + "_" + subject);
        String raw = writeJson(profile);
        IdentityService.LoginResult result = identityService.loginWithExternalIdentity(new IdentityService.ExternalIdentityRequest(
                providerId,
                subject,
                email,
                name,
                raw,
                properties.getDefaultWorkspaceId(),
                properties.getDefaultRoleCode()
        ), userAgent);
        return new SsoLoginResult(result, saved.postLoginRedirect());
    }

    public String safeRedirect(String raw) {
        if (raw == null || raw.isBlank()) return "/workbench";
        String trimmed = raw.trim();
        if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.contains("\n") || trimmed.contains("\r")) {
            return "/workbench";
        }
        return trimmed;
    }

    private SsoProperties.Provider requireProvider(String id) {
        if (!properties.isEnabled()) throw new UnauthorizedException("SSO disabled");
        SsoProperties.Provider p = properties.provider(id);
        if (p == null || !ready(p)) throw new UnauthorizedException("SSO provider not configured");
        return p;
    }

    private boolean ready(SsoProperties.Provider p) {
        return p != null
                && p.isEnabled()
                && present(p.getClientId())
                && present(p.getClientSecret())
                && present(p.getAuthorizationUri())
                && present(p.getTokenUri())
                && present(p.getUserInfoUri())
                && present(p.getRedirectUri());
    }

    private Map<String, Object> exchangeCode(SsoProperties.Provider provider, String code, String codeVerifier) {
        if (code == null || code.isBlank()) throw new UnauthorizedException("SSO authorization code missing");
        String body = form(Map.of(
                "grant_type", "authorization_code",
                "code", code,
                "redirect_uri", provider.getRedirectUri(),
                "client_id", provider.getClientId(),
                "client_secret", provider.getClientSecret(),
                "code_verifier", codeVerifier
        ));
        HttpRequest request = HttpRequest.newBuilder(URI.create(provider.getTokenUri()))
                .timeout(Duration.ofSeconds(20))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .header("Accept", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
        return sendJson(request, "SSO token exchange failed");
    }

    private Map<String, Object> loadUserInfo(SsoProperties.Provider provider, String accessToken) {
        HttpRequest request = HttpRequest.newBuilder(URI.create(provider.getUserInfoUri()))
                .timeout(Duration.ofSeconds(20))
                .header("Authorization", "Bearer " + accessToken)
                .header("Accept", "application/json")
                .GET()
                .build();
        return sendJson(request, "SSO userinfo request failed");
    }

    private Map<String, Object> sendJson(HttpRequest request, String error) {
        try {
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new UnauthorizedException(error);
            }
            return objectMapper.readValue(response.body(), new TypeReference<>() {});
        } catch (UnauthorizedException e) {
            throw e;
        } catch (Exception e) {
            throw new UnauthorizedException(error);
        }
    }

    private String randomToken(int bytes) {
        byte[] out = new byte[bytes];
        random.nextBytes(out);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(out);
    }

    private String sha256Base64Url(String value) {
        try {
            byte[] out = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.US_ASCII));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(out);
        } catch (Exception e) {
            throw new IllegalStateException("PKCE challenge failed", e);
        }
    }

    private void add(List<String> params, String key, String value) {
        params.add(url(key) + "=" + url(value));
    }

    private String form(Map<String, String> values) {
        return values.entrySet().stream()
                .map(e -> url(e.getKey()) + "=" + url(e.getValue()))
                .reduce((a, b) -> a + "&" + b)
                .orElse("");
    }

    private String url(String value) {
        return URLEncoder.encode(value == null ? "" : value, StandardCharsets.UTF_8);
    }

    private boolean present(String value) {
        return value != null && !value.isBlank();
    }

    private String text(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private String firstNonBlank(String... values) {
        for (String value : values) {
            if (value != null && !value.isBlank()) return value;
        }
        return "sso-user-" + UUID.randomUUID();
    }

    private String writeJson(Map<String, Object> value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception e) {
            return "{}";
        }
    }

    public record ProviderSummary(String id, String label, boolean ready) {}

    public record AuthorizationStart(String authorizationUrl, String state, long maxAgeSeconds) {}

    public record SsoLoginResult(IdentityService.LoginResult session, String postLoginRedirect) {}
}
