-- Federated identity and SSO state for OIDC providers such as Google, Azure AD, Okta and Keycloak.

CREATE TABLE IF NOT EXISTS od_external_identity (
    provider     VARCHAR(64)  NOT NULL,
    subject      VARCHAR(256) NOT NULL,
    user_id      VARCHAR(64)  NOT NULL REFERENCES od_user_account(id) ON DELETE CASCADE,
    email        VARCHAR(256) NULL,
    display_name VARCHAR(128) NULL,
    raw_profile  TEXT         NULL,
    created_at   BIGINT       NOT NULL,
    updated_at   BIGINT       NOT NULL,
    PRIMARY KEY (provider, subject)
);

CREATE INDEX IF NOT EXISTS idx_external_identity_user ON od_external_identity (user_id);
CREATE INDEX IF NOT EXISTS idx_external_identity_email ON od_external_identity (lower(email));

CREATE TABLE IF NOT EXISTS od_sso_state (
    state_hash          VARCHAR(128) NOT NULL PRIMARY KEY,
    provider            VARCHAR(64)  NOT NULL,
    nonce               VARCHAR(128) NOT NULL,
    code_verifier       VARCHAR(256) NOT NULL,
    post_login_redirect VARCHAR(512) NOT NULL,
    created_at          BIGINT       NOT NULL,
    expires_at          BIGINT       NOT NULL,
    consumed_at         BIGINT       NULL
);

CREATE INDEX IF NOT EXISTS idx_sso_state_exp ON od_sso_state (expires_at);
