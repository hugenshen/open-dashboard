-- Resource ACL + dataset row/column policies (P008).

CREATE TABLE IF NOT EXISTS od_resource_acl (
    id              VARCHAR(64)  NOT NULL PRIMARY KEY,
    workspace_id    VARCHAR(64)  NOT NULL,
    resource_type   VARCHAR(32)  NOT NULL,
    resource_id     VARCHAR(64)  NOT NULL,
    subject_type    VARCHAR(16)  NOT NULL,
    subject_id      VARCHAR(64)  NOT NULL,
    action          VARCHAR(32)  NOT NULL,
    created_at      BIGINT       NOT NULL,
    created_by      VARCHAR(64)  NULL,
    UNIQUE (workspace_id, resource_type, resource_id, subject_type, subject_id, action)
);

CREATE INDEX IF NOT EXISTS idx_acl_resource
    ON od_resource_acl (workspace_id, resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_acl_subject
    ON od_resource_acl (workspace_id, subject_type, subject_id);

CREATE TABLE IF NOT EXISTS od_data_policy (
    id              VARCHAR(64)  NOT NULL PRIMARY KEY,
    workspace_id    VARCHAR(64)  NOT NULL,
    dataset_id      VARCHAR(64)  NOT NULL,
    kind            VARCHAR(16)  NOT NULL,
    subject_type    VARCHAR(16)  NOT NULL,
    subject_id      VARCHAR(64)  NOT NULL,
    effect          VARCHAR(16)  NOT NULL DEFAULT 'filter',
    predicate_json  JSONB        NOT NULL DEFAULT '{}'::jsonb,
    enabled         BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      BIGINT       NOT NULL,
    updated_at      BIGINT       NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_policy_dataset
    ON od_data_policy (workspace_id, dataset_id);

CREATE TABLE IF NOT EXISTS od_dataset_request (
    id                  VARCHAR(64)  NOT NULL PRIMARY KEY,
    workspace_id        VARCHAR(64)  NOT NULL,
    dataset_id          VARCHAR(64)  NOT NULL,
    applicant_id        VARCHAR(64)  NOT NULL,
    purpose             VARCHAR(512) NULL,
    requested_actions   VARCHAR(256) NULL,
    status              VARCHAR(16)  NOT NULL DEFAULT 'pending',
    created_at          BIGINT       NOT NULL,
    decided_by          VARCHAR(64)  NULL,
    decided_at          BIGINT       NULL
);

-- Analysts keep whole-table access until an admin adds a user-level policy.
INSERT INTO od_resource_acl (
    id, workspace_id, resource_type, resource_id, subject_type, subject_id, action, created_at, created_by
)
SELECT
    'acl-' || w.id || '-' || r.code || '-' || d.id,
    w.id,
    'dataset',
    d.id,
    'role',
    r.code,
    CASE WHEN r.code IN ('workspace_admin', 'platform_admin') THEN 'manage' ELSE 'use' END,
    0,
    'system'
FROM de_dataset d
CROSS JOIN (VALUES ('analyst'), ('workspace_admin'), ('platform_admin')) AS r(code)
CROSS JOIN (VALUES ('workspace-retail'), ('workspace-east'), ('workspace-finance')) AS w(id)
ON CONFLICT DO NOTHING;

INSERT INTO od_resource_acl (
    id, workspace_id, resource_type, resource_id, subject_type, subject_id, action, created_at, created_by
)
SELECT
    'acl-dash-' || w.id || '-' || r.code || '-' || d.id::text,
    w.id,
    'dashboard',
    d.id::text,
    'role',
    r.code,
    CASE WHEN r.code IN ('workspace_admin', 'platform_admin') THEN 'manage' ELSE 'edit' END,
    0,
    'system'
FROM de_dashboard d
CROSS JOIN (VALUES ('analyst'), ('workspace_admin'), ('platform_admin')) AS r(code)
CROSS JOIN (VALUES ('workspace-retail'), ('workspace-east'), ('workspace-finance')) AS w(id)
WHERE d.node_type = 'dashboard'
ON CONFLICT DO NOTHING;
