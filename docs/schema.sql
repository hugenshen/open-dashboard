-- Dashboard redesign schema (target product)
-- Dual-copy publish: each logical entity has draft + published rows distinguished by `copy_type`.
-- Do NOT expose copy_type / resourceTable to external APIs.

CREATE TABLE IF NOT EXISTS de_dashboard (
    id              BIGINT       NOT NULL PRIMARY KEY,
    pid             BIGINT       NOT NULL DEFAULT 0,
    name            VARCHAR(128) NOT NULL,
    node_type       VARCHAR(16)  NOT NULL COMMENT 'folder | dashboard',
    status          VARCHAR(32)  NOT NULL DEFAULT 'draft' COMMENT 'draft | published | publishedWithDraft',
    layout_mode     VARCHAR(16)  NOT NULL DEFAULT 'grid' COMMENT 'grid | free(reserved)',
    content_id      BIGINT       NOT NULL DEFAULT 0 COMMENT 'optimistic lock token',
    version         INT          NOT NULL DEFAULT 1,
    create_by       VARCHAR(64)  NULL,
    create_time     BIGINT       NULL,
    update_by       VARCHAR(64)  NULL,
    update_time     BIGINT       NULL,
    INDEX idx_dashboard_pid (pid),
    INDEX idx_dashboard_status (status)
) COMMENT='仪表盘资源树节点';

CREATE TABLE IF NOT EXISTS de_dashboard_layout (
    id              BIGINT       NOT NULL PRIMARY KEY,
    dashboard_id    BIGINT       NOT NULL,
    copy_type       VARCHAR(16)  NOT NULL COMMENT 'draft | published',
    grid_cols       INT          NOT NULL DEFAULT 72,
    grid_rows       INT          NOT NULL DEFAULT 36,
    theme_ref       VARCHAR(64)  NULL,
    refresh_sec     INT          NULL DEFAULT 0,
    ext_style       LONGTEXT     NULL COMMENT 'non-canonical style JSON',
    UNIQUE KEY uk_layout_dash_copy (dashboard_id, copy_type),
    INDEX idx_layout_dashboard (dashboard_id)
) COMMENT='仪表盘布局（PC 网格一期）';

CREATE TABLE IF NOT EXISTS de_dashboard_component (
    id              BIGINT       NOT NULL PRIMARY KEY,
    dashboard_id    BIGINT       NOT NULL,
    copy_type       VARCHAR(16)  NOT NULL COMMENT 'draft | published',
    type            VARCHAR(32)  NOT NULL COMMENT 'chart | filter | text | image | tabs',
    parent_id       BIGINT       NULL DEFAULT 0,
    chart_view_id   BIGINT       NULL COMMENT 'when type=chart',
    x               INT          NOT NULL DEFAULT 0,
    y               INT          NOT NULL DEFAULT 0,
    w               INT          NOT NULL DEFAULT 6,
    h               INT          NOT NULL DEFAULT 4,
    z_index         INT          NOT NULL DEFAULT 0,
    props           LONGTEXT     NULL COMMENT 'type-specific props JSON',
    INDEX idx_comp_dash_copy (dashboard_id, copy_type),
    INDEX idx_comp_parent (parent_id)
) COMMENT='画布组件行（替代整页 component_data blob）';

CREATE TABLE IF NOT EXISTS de_chart_view (
    id              BIGINT       NOT NULL PRIMARY KEY,
    dashboard_id    BIGINT       NOT NULL,
    copy_type       VARCHAR(16)  NOT NULL COMMENT 'draft | published',
    dataset_id      BIGINT       NULL COMMENT 'binds dataset only, never datasource',
    chart_type      VARCHAR(64)  NOT NULL DEFAULT 'bar',
    title           VARCHAR(256) NULL,
    encode_json     LONGTEXT     NULL COMMENT 'x/y/category/value encodings',
    style_json      LONGTEXT     NULL,
    senior_json     LONGTEXT     NULL COMMENT 'drill, threshold, etc.',
    INDEX idx_chart_dash_copy (dashboard_id, copy_type),
    INDEX idx_chart_dataset (dataset_id)
) COMMENT='图表配置';

CREATE TABLE IF NOT EXISTS de_dashboard_linkage (
    id               BIGINT       NOT NULL PRIMARY KEY,
    dashboard_id     BIGINT       NOT NULL,
    copy_type        VARCHAR(16)  NOT NULL COMMENT 'draft | published',
    source_chart_id  BIGINT       NOT NULL,
    source_field     VARCHAR(128) NOT NULL,
    target_chart_id  BIGINT       NOT NULL,
    target_field     VARCHAR(128) NOT NULL,
    enabled          TINYINT      NOT NULL DEFAULT 1,
    INDEX idx_linkage_dash_copy (dashboard_id, copy_type)
) COMMENT='图间联动映射（简化模型）';

-- ---------------------------------------------------------------------------
-- Access control & sharing（详见 docs/backend-architecture.md）
-- 数据集行列权限表在数据集模块维护，查询时由 Dataset 引擎注入，此处不重复定义。
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS de_dashboard_auth (
    id              BIGINT       NOT NULL PRIMARY KEY,
    dashboard_id    BIGINT       NOT NULL,
    subject_type    VARCHAR(16)  NOT NULL COMMENT 'user | role | dept',
    subject_id      VARCHAR(64)  NOT NULL,
    perm            VARCHAR(16)  NOT NULL COMMENT 'manage | edit | view',
    create_by       VARCHAR(64)  NULL,
    create_time     BIGINT       NULL,
    UNIQUE KEY uk_dash_subject (dashboard_id, subject_type, subject_id),
    INDEX idx_auth_subject (subject_type, subject_id)
) COMMENT='仪表盘访问控制';

CREATE TABLE IF NOT EXISTS de_dashboard_share (
    id              BIGINT       NOT NULL PRIMARY KEY,
    dashboard_id    BIGINT       NOT NULL,
    token           VARCHAR(64)  NOT NULL,
    visibility      VARCHAR(16)  NOT NULL DEFAULT 'org' COMMENT 'public | org | password',
    perm            VARCHAR(16)  NOT NULL DEFAULT 'view' COMMENT 'view | edit',
    password_hash   VARCHAR(128) NULL,
    expire_at       BIGINT       NULL,
    enabled         TINYINT      NOT NULL DEFAULT 1,
    create_by       VARCHAR(64)  NULL,
    create_time     BIGINT       NULL,
    UNIQUE KEY uk_share_token (token),
    INDEX idx_share_dashboard (dashboard_id)
) COMMENT='分享与嵌入链接';
