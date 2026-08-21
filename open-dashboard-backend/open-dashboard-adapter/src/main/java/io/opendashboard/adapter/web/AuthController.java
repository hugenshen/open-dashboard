package io.opendashboard.adapter.web;

import io.opendashboard.application.auth.IdentityService;
import io.opendashboard.application.auth.OidcSsoService;
import io.opendashboard.application.auth.SsoProperties;
import io.opendashboard.application.WorkspaceGovernanceService;
import io.opendashboard.adapter.security.RequireAuth;
import io.opendashboard.domain.context.AuthContext;
import io.opendashboard.domain.context.AuthPrincipal;
import io.opendashboard.adapter.security.MenuProvider;
import io.opendashboard.domain.exception.UnauthorizedException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final MenuProvider menuProvider;
    private final WorkspaceGovernanceService workspaceGovernanceService;
    private final IdentityService identityService;
    private final OidcSsoService oidcSsoService;
    private final SsoProperties ssoProperties;
    private final String sessionCookieName;
    private final boolean secureCookie;
    private final long sessionTtlSeconds;

    public AuthController(
            MenuProvider menuProvider,
            WorkspaceGovernanceService workspaceGovernanceService,
            IdentityService identityService,
            OidcSsoService oidcSsoService,
            SsoProperties ssoProperties,
            @Value("${opendashboard.auth.session-cookie-name:OD_SESSION}") String sessionCookieName,
            @Value("${opendashboard.auth.secure-cookie:false}") boolean secureCookie,
            @Value("${opendashboard.auth.session-ttl-seconds:28800}") long sessionTtlSeconds
    ) {
        this.menuProvider = menuProvider;
        this.workspaceGovernanceService = workspaceGovernanceService;
        this.identityService = identityService;
        this.oidcSsoService = oidcSsoService;
        this.ssoProperties = ssoProperties;
        this.sessionCookieName = sessionCookieName;
        this.secureCookie = secureCookie;
        this.sessionTtlSeconds = sessionTtlSeconds;
    }

    @PostMapping("/login")
    public ResponseEntity<WorkspaceGovernanceService.AuthMeVO> login(
            @RequestBody IdentityService.LoginRequest req,
            HttpServletRequest request
    ) {
        IdentityService.LoginResult result = identityService.login(req, request.getHeader("User-Agent"));
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, sessionCookie(result.sessionToken(), Duration.ofSeconds(sessionTtlSeconds)).toString())
                .body(workspaceGovernanceService.me(result.principal()));
    }

    @PostMapping("/register")
    public ResponseEntity<WorkspaceGovernanceService.AuthMeVO> register(
            @RequestBody IdentityService.RegisterRequest req,
            HttpServletRequest request
    ) {
        IdentityService.LoginResult result = identityService.register(req, request.getHeader("User-Agent"));
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, sessionCookie(result.sessionToken(), Duration.ofSeconds(sessionTtlSeconds)).toString())
                .body(workspaceGovernanceService.me(result.principal()));
    }

    @GetMapping("/sso/providers")
    public List<OidcSsoService.ProviderSummary> ssoProviders() {
        return oidcSsoService.providers();
    }

    @GetMapping("/sso/{provider}/start")
    public ResponseEntity<Void> startSso(
            @PathVariable String provider,
            @RequestParam(value = "redirect", required = false) String redirect
    ) {
        OidcSsoService.AuthorizationStart start = oidcSsoService.start(provider, redirect);
        return ResponseEntity.status(302)
                .header(HttpHeaders.LOCATION, start.authorizationUrl())
                .header(HttpHeaders.SET_COOKIE, ssoStateCookie(start.state(), Duration.ofSeconds(start.maxAgeSeconds())).toString())
                .build();
    }

    @GetMapping("/sso/{provider}/callback")
    public ResponseEntity<Void> completeSso(
            @PathVariable String provider,
            @RequestParam(value = "code", required = false) String code,
            @RequestParam(value = "state", required = false) String state,
            @RequestParam(value = "error", required = false) String error,
            HttpServletRequest request
    ) {
        if (error != null && !error.isBlank()) {
            return ResponseEntity.status(302)
                    .header(HttpHeaders.LOCATION, "/login?sso_error=1")
                    .header(HttpHeaders.SET_COOKIE, ssoStateCookie("", Duration.ZERO).toString())
                    .build();
        }
        OidcSsoService.SsoLoginResult result = oidcSsoService.complete(
                provider,
                state,
                readNamedCookie(request, ssoProperties.getStateCookieName()),
                code,
                request.getHeader("User-Agent")
        );
        return ResponseEntity.status(302)
                .header(HttpHeaders.LOCATION, oidcSsoService.safeRedirect(result.postLoginRedirect()))
                .header(HttpHeaders.SET_COOKIE, sessionCookie(result.session().sessionToken(), Duration.ofSeconds(sessionTtlSeconds)).toString())
                .header(HttpHeaders.SET_COOKIE, ssoStateCookie("", Duration.ZERO).toString())
                .build();
    }

    @GetMapping("/me")
    @RequireAuth
    public WorkspaceGovernanceService.AuthMeVO me() {
        AuthPrincipal p = AuthContext.get();
        if (p == null) {
            throw new UnauthorizedException("Not authenticated");
        }
        return workspaceGovernanceService.me(p);
    }

    @GetMapping("/menus")
    @RequireAuth
    public List<MenuProvider.MenuItem> menus() {
        AuthPrincipal p = AuthContext.get();
        if (p == null) {
            throw new UnauthorizedException("Not authenticated");
        }
        return menuProvider.menus(p);
    }

    @PostMapping("/workspace")
    @RequireAuth
    public WorkspaceGovernanceService.AuthMeVO switchWorkspace(
            @RequestBody IdentityService.SwitchWorkspaceRequest req,
            HttpServletRequest request
    ) {
        AuthPrincipal p = AuthContext.require();
        AuthPrincipal next = identityService.switchWorkspace(p, readCookie(request), req);
        return workspaceGovernanceService.me(next);
    }

    @PostMapping("/password")
    @RequireAuth
    public Map<String, Object> changePassword(@RequestBody IdentityService.ChangePasswordRequest req) {
        identityService.changePassword(AuthContext.require(), req);
        return Map.of("ok", true);
    }

    @PostMapping("/logout")
    public ResponseEntity<Map<String, Object>> logout(HttpServletRequest request) {
        identityService.logout(readCookie(request));
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, sessionCookie("", Duration.ZERO).toString())
                .body(Map.of("ok", true));
    }

    private ResponseCookie sessionCookie(String token, Duration maxAge) {
        return ResponseCookie.from(sessionCookieName, token == null ? "" : token)
                .httpOnly(true)
                .secure(secureCookie)
                .sameSite("Lax")
                .path("/")
                .maxAge(maxAge)
                .build();
    }

    private ResponseCookie ssoStateCookie(String token, Duration maxAge) {
        return ResponseCookie.from(ssoProperties.getStateCookieName(), token == null ? "" : token)
                .httpOnly(true)
                .secure(secureCookie)
                .sameSite("Lax")
                .path("/")
                .maxAge(maxAge)
                .build();
    }

    private String readCookie(HttpServletRequest request) {
        return readNamedCookie(request, sessionCookieName);
    }

    private String readNamedCookie(HttpServletRequest request, String name) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) return null;
        for (Cookie c : cookies) {
            if (name.equals(c.getName())) return c.getValue();
        }
        return null;
    }

}
