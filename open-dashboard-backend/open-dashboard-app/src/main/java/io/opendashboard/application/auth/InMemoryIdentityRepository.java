package io.opendashboard.application.auth;

import io.opendashboard.domain.gateway.IdentityRepository;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

@Component
@Profile("stub")
public class InMemoryIdentityRepository implements IdentityRepository {

    private final Map<String, UserAccount> usersById = new ConcurrentHashMap<>();
    private final Map<String, String> userIdByUsername = new ConcurrentHashMap<>();
    private final Map<String, PasswordCredential> credentials = new ConcurrentHashMap<>();
    private final Map<String, AuthSession> sessions = new ConcurrentHashMap<>();
    private final Map<String, Set<String>> workspaceRolesByUser = new ConcurrentHashMap<>();

    @Override
    public Optional<UserAccount> findUserByUsername(String username) {
        String id = userIdByUsername.get(username);
        return id == null ? Optional.empty() : findUserById(id);
    }

    @Override
    public Optional<UserAccount> findUserById(String userId) {
        return Optional.ofNullable(usersById.get(userId));
    }

    @Override
    public Optional<PasswordCredential> passwordByUserId(String userId) {
        return Optional.ofNullable(credentials.get(userId));
    }

    @Override
    public void createUser(UserAccount user, PasswordHash passwordHash, String workspaceId, String roleCode) {
        usersById.put(user.id(), user);
        userIdByUsername.put(user.username(), user.id());
        credentials.put(user.id(), credential(user.id(), passwordHash));
        workspaceRolesByUser.computeIfAbsent(user.id(), k -> new LinkedHashSet<>()).add(workspaceId + "|" + roleCode);
    }

    @Override
    public void updatePassword(String userId, PasswordHash passwordHash) {
        credentials.put(userId, credential(userId, passwordHash));
    }

    @Override
    public List<String> permissionsForUser(String userId, String workspaceId) {
        Set<String> out = new LinkedHashSet<>();
        for (String entry : workspaceRolesByUser.getOrDefault(userId, Set.of())) {
            String[] parts = entry.split("\\|", 2);
            if (parts.length != 2 || !workspaceId.equals(parts[0])) continue;
            out.addAll(rolePermissions(parts[1]));
        }
        return List.copyOf(out);
    }

    @Override
    public List<String> workspacesForUser(String userId) {
        Map<String, Boolean> seen = new LinkedHashMap<>();
        for (String entry : workspaceRolesByUser.getOrDefault(userId, Set.of())) {
            String[] parts = entry.split("\\|", 2);
            if (parts.length == 2) seen.put(parts[0], true);
        }
        return new ArrayList<>(seen.keySet());
    }

    @Override
    public Optional<AuthSession> sessionByHash(String tokenHash) {
        return Optional.ofNullable(sessions.get(tokenHash));
    }

    @Override
    public void createSession(AuthSession session) {
        sessions.put(session.tokenHash(), session);
    }

    @Override
    public void touchSession(String tokenHash, long now) {
        AuthSession old = sessions.get(tokenHash);
        if (old != null) {
            sessions.put(tokenHash, new AuthSession(
                    old.tokenHash(), old.userId(), old.workspaceId(), old.createdAt(),
                    old.expiresAt(), now, old.revokedAt(), old.userAgent()
            ));
        }
    }

    @Override
    public void revokeSession(String tokenHash, long now) {
        AuthSession old = sessions.get(tokenHash);
        if (old != null) {
            sessions.put(tokenHash, new AuthSession(
                    old.tokenHash(), old.userId(), old.workspaceId(), old.createdAt(),
                    old.expiresAt(), old.lastSeenAt(), now, old.userAgent()
            ));
        }
    }

    @Override
    public void updateSessionWorkspace(String tokenHash, String workspaceId, long now) {
        AuthSession old = sessions.get(tokenHash);
        if (old != null) {
            sessions.put(tokenHash, new AuthSession(
                    old.tokenHash(), old.userId(), workspaceId, old.createdAt(),
                    old.expiresAt(), now, old.revokedAt(), old.userAgent()
            ));
        }
    }

    @Override
    public void ensureSeedUser(String username, String displayName, String workspaceId, String roleCode, PasswordHash passwordHash) {
        if (findUserByUsername(username).isPresent()) return;
        createUser(new UserAccount("u_" + username, username, displayName, null, "active"), passwordHash, workspaceId, roleCode);
    }

    private PasswordCredential credential(String userId, PasswordHash h) {
        return new PasswordCredential(userId, h.algorithm(), h.iterations(), h.salt(), h.hash());
    }

    private List<String> rolePermissions(String roleCode) {
        if ("workspace_admin".equals(roleCode)) return List.of("*");
        if ("analyst".equals(roleCode)) {
            return List.of("dataset:use", "conversation:use", "dashboard:view", "report:view");
        }
        return List.of("dashboard:view", "report:view");
    }
}
