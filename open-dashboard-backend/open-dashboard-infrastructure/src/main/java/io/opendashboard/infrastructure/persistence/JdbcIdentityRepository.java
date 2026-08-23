package io.opendashboard.infrastructure.persistence;

import io.opendashboard.domain.gateway.IdentityRepository;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
@Profile("!stub")
public class JdbcIdentityRepository implements IdentityRepository {

    private final JdbcTemplate jdbc;

    public JdbcIdentityRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Optional<UserAccount> findUserByUsername(String username) {
        return jdbc.query("""
                SELECT id, username, display_name, email, status
                FROM od_user_account
                WHERE username = ?
                """, (rs, i) -> new UserAccount(
                rs.getString("id"),
                rs.getString("username"),
                rs.getString("display_name"),
                rs.getString("email"),
                rs.getString("status")
        ), username).stream().findFirst();
    }

    @Override
    public Optional<UserAccount> findUserById(String userId) {
        return jdbc.query("""
                SELECT id, username, display_name, email, status
                FROM od_user_account
                WHERE id = ?
                """, (rs, i) -> new UserAccount(
                rs.getString("id"),
                rs.getString("username"),
                rs.getString("display_name"),
                rs.getString("email"),
                rs.getString("status")
        ), userId).stream().findFirst();
    }

    @Override
    public Optional<UserAccount> findUserByEmail(String email) {
        return jdbc.query("""
                SELECT id, username, display_name, email, status
                FROM od_user_account
                WHERE lower(email) = lower(?)
                """, (rs, i) -> new UserAccount(
                rs.getString("id"),
                rs.getString("username"),
                rs.getString("display_name"),
                rs.getString("email"),
                rs.getString("status")
        ), email).stream().findFirst();
    }

    @Override
    public Optional<UserAccount> findUserByExternalIdentity(String provider, String subject) {
        return jdbc.query("""
                SELECT u.id, u.username, u.display_name, u.email, u.status
                FROM od_external_identity ei
                JOIN od_user_account u ON u.id = ei.user_id
                WHERE ei.provider = ?
                  AND ei.subject = ?
                """, (rs, i) -> new UserAccount(
                rs.getString("id"),
                rs.getString("username"),
                rs.getString("display_name"),
                rs.getString("email"),
                rs.getString("status")
        ), provider, subject).stream().findFirst();
    }

    @Override
    public Optional<PasswordCredential> passwordByUserId(String userId) {
        return jdbc.query("""
                SELECT user_id, algorithm, iterations, salt, password_hash
                FROM od_password_credential
                WHERE user_id = ?
                """, (rs, i) -> new PasswordCredential(
                rs.getString("user_id"),
                rs.getString("algorithm"),
                rs.getInt("iterations"),
                rs.getString("salt"),
                rs.getString("password_hash")
        ), userId).stream().findFirst();
    }

    @Override
    public void createUser(UserAccount user, PasswordHash passwordHash, String workspaceId, String roleCode) {
        long now = System.currentTimeMillis();
        jdbc.update("""
                INSERT INTO od_user_account (id, username, display_name, email, status, password_changed_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, user.id(), user.username(), user.displayName(), user.email(), user.status(), now, now, now);
        jdbc.update("""
                INSERT INTO od_password_credential (user_id, algorithm, iterations, salt, password_hash, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """, user.id(), passwordHash.algorithm(), passwordHash.iterations(), passwordHash.salt(), passwordHash.hash(), now, now);
        jdbc.update("""
                INSERT INTO od_workspace_member (user_id, workspace_id, role_code, status, created_at)
                VALUES (?, ?, ?, 'active', ?)
                ON CONFLICT DO NOTHING
                """, user.id(), workspaceId, roleCode, now);
    }

    @Override
    public void createFederatedUser(UserAccount user, String workspaceId, String roleCode) {
        long now = System.currentTimeMillis();
        jdbc.update("""
                INSERT INTO od_user_account (id, username, display_name, email, status, password_changed_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
                """, user.id(), user.username(), user.displayName(), user.email(), user.status(), now, now);
        jdbc.update("""
                INSERT INTO od_workspace_member (user_id, workspace_id, role_code, status, created_at)
                VALUES (?, ?, ?, 'active', ?)
                ON CONFLICT DO NOTHING
                """, user.id(), workspaceId, roleCode, now);
    }

    @Override
    public void upsertExternalIdentity(String provider, String subject, String userId, String email, String displayName, String rawProfile, long now) {
        jdbc.update("""
                INSERT INTO od_external_identity (provider, subject, user_id, email, display_name, raw_profile, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (provider, subject) DO UPDATE
                SET user_id = EXCLUDED.user_id,
                    email = EXCLUDED.email,
                    display_name = EXCLUDED.display_name,
                    raw_profile = EXCLUDED.raw_profile,
                    updated_at = EXCLUDED.updated_at
                """, provider, subject, userId, email, displayName, rawProfile, now, now);
    }

    @Override
    public void updatePassword(String userId, PasswordHash passwordHash) {
        long now = System.currentTimeMillis();
        jdbc.update("""
                UPDATE od_password_credential
                SET algorithm = ?, iterations = ?, salt = ?, password_hash = ?, updated_at = ?
                WHERE user_id = ?
                """, passwordHash.algorithm(), passwordHash.iterations(), passwordHash.salt(), passwordHash.hash(), now, userId);
        jdbc.update("UPDATE od_user_account SET password_changed_at = ?, updated_at = ? WHERE id = ?", now, now, userId);
    }

    @Override
    public List<String> permissionsForUser(String userId, String workspaceId) {
        return jdbc.query("""
                SELECT DISTINCT rp.permission_code
                FROM od_workspace_member wm
                JOIN od_role_permission rp ON rp.role_code = wm.role_code
                WHERE wm.user_id = ?
                  AND wm.workspace_id = ?
                  AND wm.status = 'active'
                ORDER BY rp.permission_code
                """, (rs, i) -> rs.getString("permission_code"), userId, workspaceId);
    }

    @Override
    public List<String> workspacesForUser(String userId) {
        return jdbc.query("""
                SELECT DISTINCT workspace_id
                FROM od_workspace_member
                WHERE user_id = ?
                  AND status = 'active'
                ORDER BY workspace_id
                """, (rs, i) -> rs.getString("workspace_id"), userId);
    }

    @Override
    public List<String> rolesForUser(String userId, String workspaceId) {
        return jdbc.query("""
                SELECT role_code
                FROM od_workspace_member
                WHERE user_id = ?
                  AND workspace_id = ?
                  AND status = 'active'
                ORDER BY role_code
                """, (rs, i) -> rs.getString("role_code"), userId, workspaceId);
    }

    @Override
    public List<MemberRow> listMembers(String workspaceId) {
        return jdbc.query("""
                SELECT u.id, u.username, u.display_name, wm.role_code, wm.status
                FROM od_workspace_member wm
                JOIN od_user_account u ON u.id = wm.user_id
                WHERE wm.workspace_id = ?
                ORDER BY u.display_name, u.username
                """, (rs, i) -> new MemberRow(
                rs.getString("id"),
                rs.getString("username"),
                rs.getString("display_name"),
                rs.getString("role_code"),
                rs.getString("status")
        ), workspaceId);
    }

    @Override
    public Optional<AuthSession> sessionByHash(String tokenHash) {
        return jdbc.query("""
                SELECT id_hash, user_id, workspace_id, created_at, expires_at, last_seen_at, revoked_at, user_agent
                FROM od_auth_session
                WHERE id_hash = ?
                """, (rs, i) -> new AuthSession(
                rs.getString("id_hash"),
                rs.getString("user_id"),
                rs.getString("workspace_id"),
                rs.getLong("created_at"),
                rs.getLong("expires_at"),
                rs.getLong("last_seen_at"),
                rs.getObject("revoked_at", Long.class),
                rs.getString("user_agent")
        ), tokenHash).stream().findFirst();
    }

    @Override
    public void createSession(AuthSession session) {
        jdbc.update("""
                INSERT INTO od_auth_session (id_hash, user_id, workspace_id, created_at, expires_at, last_seen_at, revoked_at, user_agent)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, session.tokenHash(), session.userId(), session.workspaceId(), session.createdAt(), session.expiresAt(),
                session.lastSeenAt(), session.revokedAt(), session.userAgent());
    }

    @Override
    public void touchSession(String tokenHash, long now) {
        jdbc.update("UPDATE od_auth_session SET last_seen_at = ? WHERE id_hash = ? AND revoked_at IS NULL", now, tokenHash);
    }

    @Override
    public void revokeSession(String tokenHash, long now) {
        jdbc.update("UPDATE od_auth_session SET revoked_at = ? WHERE id_hash = ? AND revoked_at IS NULL", now, tokenHash);
    }

    @Override
    public void updateSessionWorkspace(String tokenHash, String workspaceId, long now) {
        jdbc.update("""
                UPDATE od_auth_session
                SET workspace_id = ?, last_seen_at = ?
                WHERE id_hash = ?
                  AND revoked_at IS NULL
                """, workspaceId, now, tokenHash);
    }

    @Override
    public void saveSsoState(SsoState state) {
        jdbc.update("""
                INSERT INTO od_sso_state (state_hash, provider, nonce, code_verifier, post_login_redirect, created_at, expires_at, consumed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, state.stateHash(), state.provider(), state.nonce(), state.codeVerifier(), state.postLoginRedirect(),
                state.createdAt(), state.expiresAt(), state.consumedAt());
    }

    @Override
    public Optional<SsoState> consumeSsoState(String stateHash, long now) {
        List<SsoState> states = jdbc.query("""
                SELECT state_hash, provider, nonce, code_verifier, post_login_redirect, created_at, expires_at, consumed_at
                FROM od_sso_state
                WHERE state_hash = ?
                """, (rs, i) -> new SsoState(
                rs.getString("state_hash"),
                rs.getString("provider"),
                rs.getString("nonce"),
                rs.getString("code_verifier"),
                rs.getString("post_login_redirect"),
                rs.getLong("created_at"),
                rs.getLong("expires_at"),
                rs.getObject("consumed_at", Long.class)
        ), stateHash);
        if (states.isEmpty() || !states.get(0).activeAt(now)) return Optional.empty();
        jdbc.update("UPDATE od_sso_state SET consumed_at = ? WHERE state_hash = ? AND consumed_at IS NULL", now, stateHash);
        return Optional.of(states.get(0));
    }

    @Override
    public void ensureSeedUser(String username, String displayName, String workspaceId, String roleCode, PasswordHash passwordHash) {
        if (findUserByUsername(username).isPresent()) return;
        String id = "u_" + username;
        createUser(new UserAccount(id, username, displayName, null, "active"), passwordHash, workspaceId, roleCode);
    }

    @Override
    public void ensureSeedMembership(String username, String workspaceId, String roleCode) {
        findUserByUsername(username).ifPresent(user -> jdbc.update("""
                INSERT INTO od_workspace_member (user_id, workspace_id, role_code, status, created_at)
                VALUES (?, ?, ?, 'active', ?)
                ON CONFLICT DO NOTHING
                """, user.id(), workspaceId, roleCode, System.currentTimeMillis()));
    }
}
