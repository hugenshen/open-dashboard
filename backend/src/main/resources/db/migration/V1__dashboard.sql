-- Open Dashboard config schema (PostgreSQL)
-- Dual-copy publish: draft | published via copy_type

CREATE TABLE IF NOT EXISTS de_dashboard (
    id              BIGINT       NOT NULL PRIMARY KEY,
    pid             BIGINT       NOT NULL DEFAULT 0,
    name            VARCHAR(128) NOT NULL,
    node_type       VARCHAR(16)  NOT NULL,
    status          VARCHAR(32)  NOT NULL DEFAULT 'draft',
    layout_mode     VARCHAR(16)  NOT NULL DEFAULT 'grid',
    content_id      BIGINT       NOT NULL DEFAULT 0,
    version         INT          NOT NULL DEFAULT 1,
    create_by       VARCHAR(64)  NULL,
    create_time     BIGINT       NULL,
    update_by       VARCHAR(64)  NULL,
    update_time     BIGINT       NULL
);

CREATE INDEX IF NOT EXISTS idx_dashboard_pid ON de_dashboard (pid);
CREATE INDEX IF NOT EXISTS idx_dashboard_status ON de_dashboard (status);

CREATE TABLE IF NOT EXISTS de_dashboard_layout (
    id              BIGINT       NOT NULL PRIMARY KEY,
    dashboard_id    BIGINT       NOT NULL,
    copy_type       VARCHAR(16)  NOT NULL,
    grid_cols       INT          NOT NULL DEFAULT 72,
    grid_rows       INT          NOT NULL DEFAULT 36,
    theme_ref       VARCHAR(64)  NULL,
    refresh_sec     INT          NULL DEFAULT 0,
    ext_style       JSONB        NULL,
    mobile_json     JSONB        NULL,
    UNIQUE (dashboard_id, copy_type)
);

CREATE INDEX IF NOT EXISTS idx_layout_dashboard ON de_dashboard_layout (dashboard_id);

CREATE TABLE IF NOT EXISTS de_dashboard_component (
    id              BIGINT       NOT NULL PRIMARY KEY,
    dashboard_id    BIGINT       NOT NULL,
    copy_type       VARCHAR(16)  NOT NULL,
    type            VARCHAR(32)  NOT NULL,
    parent_id       BIGINT       NULL DEFAULT 0,
    chart_view_id   BIGINT       NULL,
    x               INT          NOT NULL DEFAULT 0,
    y               INT          NOT NULL DEFAULT 0,
    w               INT          NOT NULL DEFAULT 6,
    h               INT          NOT NULL DEFAULT 4,
    z_index         INT          NOT NULL DEFAULT 0,
    props           JSONB        NULL
);

CREATE INDEX IF NOT EXISTS idx_comp_dash_copy ON de_dashboard_component (dashboard_id, copy_type);

CREATE TABLE IF NOT EXISTS de_chart_view (
    id              BIGINT       NOT NULL PRIMARY KEY,
    dashboard_id    BIGINT       NOT NULL,
    copy_type       VARCHAR(16)  NOT NULL,
    dataset_id      BIGINT       NULL,
    chart_type      VARCHAR(64)  NOT NULL DEFAULT 'bar',
    title           VARCHAR(256) NULL,
    encode_json     JSONB        NULL,
    style_json      JSONB        NULL,
    senior_json     JSONB        NULL
);

CREATE INDEX IF NOT EXISTS idx_chart_dash_copy ON de_chart_view (dashboard_id, copy_type);
CREATE INDEX IF NOT EXISTS idx_chart_dataset ON de_chart_view (dataset_id);

CREATE TABLE IF NOT EXISTS de_dashboard_linkage (
    id               BIGINT       NOT NULL PRIMARY KEY,
    dashboard_id     BIGINT       NOT NULL,
    copy_type        VARCHAR(16)  NOT NULL,
    source_chart_id  BIGINT       NOT NULL,
    source_field     VARCHAR(128) NOT NULL,
    target_chart_id  BIGINT       NOT NULL,
    target_field     VARCHAR(128) NOT NULL,
    enabled          SMALLINT     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_linkage_dash_copy ON de_dashboard_linkage (dashboard_id, copy_type);

CREATE TABLE IF NOT EXISTS de_dashboard_auth (
    id              BIGINT       NOT NULL PRIMARY KEY,
    dashboard_id    BIGINT       NOT NULL,
    subject_type    VARCHAR(16)  NOT NULL,
    subject_id      VARCHAR(64)  NOT NULL,
    perm            VARCHAR(16)  NOT NULL,
    create_by       VARCHAR(64)  NULL,
    create_time     BIGINT       NULL,
    UNIQUE (dashboard_id, subject_type, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_auth_subject ON de_dashboard_auth (subject_type, subject_id);

CREATE TABLE IF NOT EXISTS de_dashboard_share (
    id              BIGINT       NOT NULL PRIMARY KEY,
    dashboard_id    BIGINT       NOT NULL,
    token           VARCHAR(64)  NOT NULL,
    visibility      VARCHAR(16)  NOT NULL DEFAULT 'org',
    perm            VARCHAR(16)  NOT NULL DEFAULT 'view',
    password_hash   VARCHAR(128) NULL,
    expire_at       BIGINT       NULL,
    enabled         SMALLINT     NOT NULL DEFAULT 1,
    create_by       VARCHAR(64)  NULL,
    create_time     BIGINT       NULL,
    UNIQUE (token)
);

CREATE INDEX IF NOT EXISTS idx_share_dashboard ON de_dashboard_share (dashboard_id);

-- Seed demo dashboard for scaffold smoke tests
INSERT INTO de_dashboard (id, pid, name, node_type, status, layout_mode, content_id, version, create_time, update_time)
VALUES (1, 0, '销售周报（脚手架）', 'dashboard', 'draft', 'grid', 1, 1, 0, 0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO de_dashboard_layout (id, dashboard_id, copy_type, grid_cols, grid_rows, mobile_json)
VALUES (
  1, 1, 'draft', 72, 36,
  '{"enabled":true,"device":"iphone-14","bg":"#f5f6f8","components":[]}'::jsonb
)
ON CONFLICT (dashboard_id, copy_type) DO NOTHING;
