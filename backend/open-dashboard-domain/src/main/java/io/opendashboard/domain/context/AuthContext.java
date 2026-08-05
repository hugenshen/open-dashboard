package io.opendashboard.domain.context;

import io.opendashboard.domain.exception.UnauthorizedException;

/**
 * Request-scoped identity holder. Cleared by AuthInterceptor after each request.
 */
public final class AuthContext {

    private static final ThreadLocal<AuthPrincipal> HOLDER = new ThreadLocal<>();

    private AuthContext() {}

    public static void set(AuthPrincipal principal) {
        HOLDER.set(principal);
    }

    public static AuthPrincipal get() {
        return HOLDER.get();
    }

    public static AuthPrincipal require() {
        AuthPrincipal p = HOLDER.get();
        if (p == null) {
            throw new UnauthorizedException("Not authenticated");
        }
        return p;
    }

    /** Prefer userId for audit columns (create_by / update_by). */
    public static String userIdOr(String fallback) {
        AuthPrincipal p = HOLDER.get();
        if (p == null || p.userId() == null || p.userId().isBlank()) return fallback;
        return p.userId();
    }

    public static void clear() {
        HOLDER.remove();
    }
}
