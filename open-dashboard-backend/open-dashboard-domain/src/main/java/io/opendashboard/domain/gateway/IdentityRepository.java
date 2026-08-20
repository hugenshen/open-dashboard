package io.opendashboard.domain.gateway;

import java.util.List;
import java.util.Optional;

public interface IdentityRepository {

    Optional<UserAccount> findUserByUsername(String username);

    Optional<UserAccount> findUserById(String userId);

    Optional<PasswordCredential> passwordByUserId(String userId);

    void createUser(UserAccount user, PasswordHash passwordHash, String workspaceId, String roleCode);

    void updatePassword(String userId, PasswordHash passwordHash);

    List<String> permissionsForUser(String userId, String workspaceId);

    List<String> workspacesForUser(String userId);

    Optional<AuthSession> sessionByHash(String tokenHash);

    void createSession(AuthSession session);

    void touchSession(String tokenHash, long now);

    void revokeSession(String tokenHash, long now);

    void updateSessionWorkspace(String tokenHash, String workspaceId, long now);

    void ensureSeedUser(String username, String displayName, String workspaceId, String roleCode, PasswordHash passwordHash);

    record UserAccount(
            String id,
            String username,
            String displayName,
            String email,
            String status
    ) {}

    record PasswordHash(
            String algorithm,
            int iterations,
            String salt,
            String hash
    ) {}

    record PasswordCredential(
            String userId,
            String algorithm,
            int iterations,
            String salt,
            String passwordHash
    ) {}

    record AuthSession(
            String tokenHash,
            String userId,
            String workspaceId,
            long createdAt,
            long expiresAt,
            long lastSeenAt,
            Long revokedAt,
            String userAgent
    ) {
        public boolean activeAt(long now) {
            return revokedAt == null && expiresAt > now;
        }
    }
}
