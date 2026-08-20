package io.opendashboard.adapter.security;

import io.opendashboard.domain.context.AuthPrincipal;

import jakarta.servlet.http.HttpServletRequest;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Default AuthProvider: reads gateway-style headers.
 * Replace with a custom {@link AuthProvider} Bean for SSO/JWT.
 *
 * <ul>
 *   <li>{@code X-User-Id} — required for a resolved identity</li>
 *   <li>{@code X-User-Name} — display name (optional)</li>
 *   <li>{@code X-User-Perms} — comma-separated permission codes (optional; empty = none)</li>
 *   <li>{@code X-Workspace-Id} — active workspace id (optional; default workspace when omitted)</li>
 * </ul>
 */
public class HeaderAuthProvider implements AuthProvider {

    public static final String HEADER_USER_ID = "X-User-Id";
    public static final String HEADER_USER_NAME = "X-User-Name";
    public static final String HEADER_USER_PERMS = "X-User-Perms";
    public static final String HEADER_WORKSPACE_ID = "X-Workspace-Id";

    @Override
    public Optional<AuthPrincipal> resolve(HttpServletRequest request) {
        String userId = trim(request.getHeader(HEADER_USER_ID));
        if (userId == null) return Optional.empty();
        // Frontends may percent-encode non-ASCII names (HTTP headers are Latin-1).
        String name = decodeHeader(trim(request.getHeader(HEADER_USER_NAME)));
        Set<String> perms = parsePerms(request.getHeader(HEADER_USER_PERMS));
        String workspaceId = trim(request.getHeader(HEADER_WORKSPACE_ID));
        return Optional.of(new AuthPrincipal(userId, name, perms, workspaceId));
    }

    private static Set<String> parsePerms(String raw) {
        if (raw == null || raw.isBlank()) return Set.of();
        return Arrays.stream(raw.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .collect(Collectors.toCollection(LinkedHashSet::new));
    }

    private static String decodeHeader(String raw) {
        if (raw == null) return null;
        try {
            return URLDecoder.decode(raw, StandardCharsets.UTF_8);
        } catch (IllegalArgumentException e) {
            return raw;
        }
    }

    private static String trim(String s) {
        if (s == null) return null;
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }
}
