package io.opendashboard.adapter.security;

import io.opendashboard.domain.exception.UnauthorizedException;

import io.opendashboard.domain.exception.ForbiddenException;

import io.opendashboard.domain.context.AuthPrincipal;

import io.opendashboard.domain.context.AuthContext;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.stream.Collectors;

@Component
public class AuthInterceptor implements HandlerInterceptor {

    private final AuthProvider authProvider;
    private final AuthProperties properties;

    public AuthInterceptor(AuthProvider authProvider, AuthProperties properties) {
        this.authProvider = authProvider;
        this.properties = properties;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        AuthPrincipal principal = authProvider.resolve(request).orElse(null);
        if (principal == null && properties.isDevFallback()) {
            principal = fallbackPrincipal();
        }
        if (principal != null) {
            AuthContext.set(principal);
        }

        if (!(handler instanceof HandlerMethod hm)) {
            return true;
        }

        RequirePermission permAnn = hm.getMethodAnnotation(RequirePermission.class);
        if (permAnn == null) {
            permAnn = hm.getBeanType().getAnnotation(RequirePermission.class);
        }
        RequireAuth authAnn = hm.getMethodAnnotation(RequireAuth.class);
        if (authAnn == null) {
            authAnn = hm.getBeanType().getAnnotation(RequireAuth.class);
        }

        boolean needAuth = authAnn != null || permAnn != null;
        if (!needAuth) {
            return true;
        }

        AuthPrincipal current = AuthContext.get();
        if (current == null) {
            throw new UnauthorizedException("Authentication required");
        }
        if (permAnn != null) {
            boolean ok = Arrays.stream(permAnn.value()).anyMatch(current::hasPermission);
            if (!ok) {
                throw new ForbiddenException("Missing permission: " + String.join(",", permAnn.value()));
            }
        }
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler, Exception ex) {
        AuthContext.clear();
    }

    private AuthPrincipal fallbackPrincipal() {
        Set<String> perms = Arrays.stream(properties.getFallbackPermissions().split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .collect(Collectors.toCollection(LinkedHashSet::new));
        return new AuthPrincipal(
                properties.getFallbackUserId(),
                properties.getFallbackDisplayName(),
                perms
        );
    }
}
