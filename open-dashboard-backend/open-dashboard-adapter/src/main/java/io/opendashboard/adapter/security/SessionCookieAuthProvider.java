package io.opendashboard.adapter.security;

import io.opendashboard.application.auth.IdentityService;
import io.opendashboard.application.conversation.ConversationProperties;
import io.opendashboard.domain.context.AuthPrincipal;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;

import java.util.Optional;

public class SessionCookieAuthProvider implements AuthProvider {

    private final IdentityService identityService;
    private final ConversationProperties conversationProperties;
    private final HeaderAuthProvider internalHeaderProvider = new HeaderAuthProvider();
    private final String cookieName;

    public SessionCookieAuthProvider(
            IdentityService identityService,
            ConversationProperties conversationProperties,
            String cookieName
    ) {
        this.identityService = identityService;
        this.conversationProperties = conversationProperties;
        this.cookieName = cookieName;
    }

    @Override
    public Optional<AuthPrincipal> resolve(HttpServletRequest request) {
        if (isInternal(request)) {
            return internalHeaderProvider.resolve(request);
        }
        return identityService.resolveSession(readCookie(request, cookieName));
    }

    private boolean isInternal(HttpServletRequest request) {
        String supplied = request.getHeader("X-OD-Internal-Token");
        String expected = conversationProperties.getHarness().getInternalToken();
        return supplied != null && !supplied.isBlank() && expected != null && expected.equals(supplied);
    }

    private static String readCookie(HttpServletRequest request, String name) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) return null;
        for (Cookie c : cookies) {
            if (name.equals(c.getName())) return c.getValue();
        }
        return null;
    }
}
