package io.opendashboard.infrastructure.persistence;

import io.opendashboard.domain.gateway.IdentityRepository;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
@ConditionalOnBean(JdbcTemplate.class)
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
    public void ensureSeedUser(String username, String displayName, String workspaceId, String roleCode, PasswordHash passwordHash) {
        if (findUserByUsername(username).isPresent()) return;
        String id = "u_" + username;
        createUser(new UserAccount(id, username, displayName, null, "active"), passwordHash, workspaceId, roleCode);
    }
}
