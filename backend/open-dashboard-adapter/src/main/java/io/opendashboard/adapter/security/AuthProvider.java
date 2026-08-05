package io.opendashboard.adapter.security;

import io.opendashboard.domain.context.AuthPrincipal;

import jakarta.servlet.http.HttpServletRequest;

import java.util.Optional;

/**
 * SPI: resolve identity from the inbound request (JWT, SSO session cookie, gateway headers, …).
 * Implement a {@code @Primary} or exclusive Bean to replace the default {@link HeaderAuthProvider}.
 */
public interface AuthProvider {

    Optional<AuthPrincipal> resolve(HttpServletRequest request);
}
