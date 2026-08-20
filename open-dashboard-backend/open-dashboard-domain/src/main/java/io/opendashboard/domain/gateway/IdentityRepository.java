package io.opendashboard.domain.gateway;

import java.util.List;
import java.util.Optional;

public interface IdentityRepository {

    Optional<UserAccount> findUserByUsername(String username);

    Optional<UserAccount> findUserById(String userId);

    Optional<UserAccount> findUserByEmail(String email);

    Optional<UserAccount> findUserByExternalIdentity(String provider, String subject);

    Optional<PasswordCredential> passwordByUserId(String userId);

    void createUser(UserAccount user, PasswordHash passwordHash, String workspaceId, String roleCode);

    void createFederatedUser(UserAccount user, String workspaceId, String roleCode);

    void upsertExternalIdentity(String provider, String subject, String userId, String email, String displayName, String rawProfile, long now);

    void updatePassword(String userId, PasswordHash passwordHash);

    List<String> permissionsForUser(String userId, String workspaceId);

    List<String> workspacesForUser(String userId);

    Optional<AuthSession> sessionByHash(String tokenHash);

    void createSession(AuthSession session);

    void touchSession(String tokenHash, long now);

    void revokeSession(String tokenHash, long now);

    void updateSessionWorkspace(String tokenHash, String workspaceId, long now);

    void saveSsoState(SsoState state);

    Optional<SsoState> consumeSsoState(String stateHash, long now);

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

    record SsoState(
            String stateHash,
            String provider,
            String nonce,
            String codeVerifier,
            String postLoginRedirect,
            long createdAt,
            long expiresAt,
            Long consumedAt
    ) {
        public boolean activeAt(long now) {
            return consumedAt == null && expiresAt > now;
        }
    }
}
