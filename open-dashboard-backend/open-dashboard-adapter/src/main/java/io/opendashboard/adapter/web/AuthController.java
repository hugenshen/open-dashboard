package io.opendashboard.adapter.web;

import io.opendashboard.application.auth.IdentityService;
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
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
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
    private final String sessionCookieName;
    private final boolean secureCookie;
    private final long sessionTtlSeconds;

    public AuthController(
            MenuProvider menuProvider,
            WorkspaceGovernanceService workspaceGovernanceService,
            IdentityService identityService,
            @Value("${opendashboard.auth.session-cookie-name:OD_SESSION}") String sessionCookieName,
            @Value("${opendashboard.auth.secure-cookie:false}") boolean secureCookie,
            @Value("${opendashboard.auth.session-ttl-seconds:28800}") long sessionTtlSeconds
    ) {
        this.menuProvider = menuProvider;
        this.workspaceGovernanceService = workspaceGovernanceService;
        this.identityService = identityService;
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

    private String readCookie(HttpServletRequest request) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) return null;
        for (Cookie c : cookies) {
            if (sessionCookieName.equals(c.getName())) return c.getValue();
        }
        return null;
    }
}
