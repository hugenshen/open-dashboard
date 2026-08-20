package io.opendashboard.application.auth;

import io.opendashboard.domain.context.AuthPrincipal;
import io.opendashboard.domain.exception.ForbiddenException;
import io.opendashboard.domain.exception.UnauthorizedException;
import io.opendashboard.domain.gateway.IdentityRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import jakarta.annotation.PostConstruct;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

@Service
public class IdentityService {

    private final IdentityRepository repo;
    private final PasswordHasher passwordHasher;
    private final SecureRandom random = new SecureRandom();
    private final long sessionTtlMillis;
    private final boolean seedDemoUsers;

    public IdentityService(
            IdentityRepository repo,
            PasswordHasher passwordHasher,
            @Value("${opendashboard.auth.session-ttl-seconds:28800}") long sessionTtlSeconds,
            @Value("${opendashboard.auth.seed-demo-users:true}") boolean seedDemoUsers
    ) {
        this.repo = repo;
        this.passwordHasher = passwordHasher;
        this.sessionTtlMillis = Math.max(300, sessionTtlSeconds) * 1000L;
        this.seedDemoUsers = seedDemoUsers;
    }

    @PostConstruct
    public void seed() {
        if (!seedDemoUsers) return;
        seedUser("demo", "演示管理员", "workspace_admin", "demo123456");
        seedUser("analyst", "分析师", "analyst", "analyst123456");
    }

    public LoginResult login(LoginRequest req, String userAgent) {
        String username = normalize(req.username());
        if (username == null || req.password() == null) {
            throw new UnauthorizedException("账号或密码错误");
        }
        IdentityRepository.UserAccount user = repo.findUserByUsername(username)
                .filter(u -> "active".equalsIgnoreCase(u.status()))
                .orElseThrow(() -> new UnauthorizedException("账号或密码错误"));
        IdentityRepository.PasswordCredential credential = repo.passwordByUserId(user.id())
                .orElseThrow(() -> new UnauthorizedException("账号或密码错误"));
        boolean ok = passwordHasher.verify(
                req.password(),
                new IdentityRepository.PasswordHash(
                        credential.algorithm(),
                        credential.iterations(),
                        credential.salt(),
                        credential.passwordHash()
                )
        );
        if (!ok) {
            throw new UnauthorizedException("账号或密码错误");
        }
        String workspaceId = chooseWorkspace(user.id(), req.workspaceId());
        return createSession(user, workspaceId, userAgent);
    }

    public LoginResult register(RegisterRequest req, String userAgent) {
        String username = normalize(req.username());
        if (username == null) throw new IllegalArgumentException("请输入账号");
        if (repo.findUserByUsername(username).isPresent()) {
            throw new IllegalArgumentException("账号已存在");
        }
        String workspaceId = req.workspaceId() == null || req.workspaceId().isBlank()
                ? AuthPrincipal.DEFAULT_WORKSPACE_ID
                : req.workspaceId().trim();
        IdentityRepository.UserAccount user = new IdentityRepository.UserAccount(
                "u_" + UUID.randomUUID().toString().replace("-", ""),
                username,
                req.displayName() == null || req.displayName().isBlank() ? username : req.displayName().trim(),
                req.email() == null || req.email().isBlank() ? null : req.email().trim(),
                "active"
        );
        repo.createUser(user, passwordHasher.hash(req.password()), workspaceId, "analyst");
        return createSession(user, workspaceId, userAgent);
    }

    public void changePassword(AuthPrincipal principal, ChangePasswordRequest req) {
        IdentityRepository.PasswordCredential credential = repo.passwordByUserId(principal.userId())
                .orElseThrow(() -> new UnauthorizedException("未找到密码凭证"));
        boolean ok = passwordHasher.verify(
                req.oldPassword(),
                new IdentityRepository.PasswordHash(
                        credential.algorithm(),
                        credential.iterations(),
                        credential.salt(),
                        credential.passwordHash()
                )
        );
        if (!ok) {
            throw new ForbiddenException("原密码错误");
        }
        repo.updatePassword(principal.userId(), passwordHasher.hash(req.newPassword()));
    }

    public Optional<AuthPrincipal> resolveSession(String token) {
        String hash = hashToken(token);
        if (hash == null) return Optional.empty();
        long now = System.currentTimeMillis();
        Optional<IdentityRepository.AuthSession> session = repo.sessionByHash(hash);
        if (session.isEmpty() || !session.get().activeAt(now)) return Optional.empty();
        IdentityRepository.AuthSession s = session.get();
        Optional<IdentityRepository.UserAccount> user = repo.findUserById(s.userId());
        if (user.isEmpty()) return Optional.empty();
        repo.touchSession(hash, now);
        return Optional.of(principal(user.get(), s.workspaceId()));
    }

    public void logout(String token) {
        String hash = hashToken(token);
        if (hash != null) repo.revokeSession(hash, System.currentTimeMillis());
    }

    public AuthPrincipal switchWorkspace(AuthPrincipal principal, String token, SwitchWorkspaceRequest req) {
        String workspaceId = req.workspaceId() == null ? "" : req.workspaceId().trim();
        if (workspaceId.isBlank()) throw new IllegalArgumentException("workspaceId required");
        List<String> workspaces = repo.workspacesForUser(principal.userId());
        if (!workspaces.contains(workspaceId)) {
            throw new ForbiddenException("无权切换到该工作区");
        }
        String hash = hashToken(token);
        if (hash != null) repo.updateSessionWorkspace(hash, workspaceId, System.currentTimeMillis());
        IdentityRepository.UserAccount user = repo.findUserById(principal.userId())
                .orElseThrow(() -> new UnauthorizedException("Not authenticated"));
        return principal(user, workspaceId);
    }

    private LoginResult createSession(IdentityRepository.UserAccount user, String workspaceId, String userAgent) {
        long now = System.currentTimeMillis();
        String token = newToken();
        String hash = hashToken(token);
        repo.createSession(new IdentityRepository.AuthSession(
                hash,
                user.id(),
                workspaceId,
                now,
                now + sessionTtlMillis,
                now,
                null,
                userAgent == null ? null : userAgent.substring(0, Math.min(512, userAgent.length()))
        ));
        return new LoginResult(token, principal(user, workspaceId), now + sessionTtlMillis);
    }

    private AuthPrincipal principal(IdentityRepository.UserAccount user, String workspaceId) {
        Set<String> permissions = new LinkedHashSet<>(repo.permissionsForUser(user.id(), workspaceId));
        return new AuthPrincipal(user.id(), user.displayName(), permissions, workspaceId);
    }

    private String chooseWorkspace(String userId, String requested) {
        List<String> workspaces = repo.workspacesForUser(userId);
        if (workspaces.isEmpty()) return AuthPrincipal.DEFAULT_WORKSPACE_ID;
        if (requested != null && !requested.isBlank()) {
            String trimmed = requested.trim();
            if (!workspaces.contains(trimmed)) throw new ForbiddenException("无权进入该工作区");
            return trimmed;
        }
        return workspaces.get(0);
    }

    private String newToken() {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    public static String hashToken(String token) {
        if (token == null || token.isBlank()) return null;
        try {
            byte[] out = MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(out);
        } catch (Exception e) {
            throw new IllegalStateException("Session token hashing failed", e);
        }
    }

    private static String normalize(String username) {
        if (username == null) return null;
        String s = username.trim().toLowerCase(Locale.ROOT);
        return s.isBlank() ? null : s;
    }

    private void seedUser(String username, String displayName, String roleCode, String password) {
        if (repo.findUserByUsername(username).isPresent()) return;
        repo.ensureSeedUser(username, displayName, AuthPrincipal.DEFAULT_WORKSPACE_ID, roleCode, passwordHasher.hash(password));
    }

    public record LoginRequest(String username, String password, String workspaceId) {}

    public record RegisterRequest(String username, String password, String displayName, String email, String workspaceId) {}

    public record ChangePasswordRequest(String oldPassword, String newPassword) {}

    public record SwitchWorkspaceRequest(String workspaceId) {}

    public record LoginResult(String sessionToken, AuthPrincipal principal, long expiresAt) {}
}
