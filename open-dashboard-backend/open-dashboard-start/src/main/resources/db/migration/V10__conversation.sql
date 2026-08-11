-- Conversation (内测): sessions, messages, runs, revisions

CREATE TABLE IF NOT EXISTS de_conversation (
    id                   BIGINT       NOT NULL PRIMARY KEY,
    title                VARCHAR(512) NOT NULL DEFAULT '新对话',
    owner_id             VARCHAR(128) NOT NULL,
    layout_prefs_json    JSONB        NOT NULL DEFAULT '{}'::jsonb,
    dataset_ids_json     JSONB        NOT NULL DEFAULT '[]'::jsonb,
    linked_dashboard_id  VARCHAR(64)  NULL,
    create_time          BIGINT       NULL,
    update_time          BIGINT       NULL
);

CREATE INDEX IF NOT EXISTS idx_conversation_owner ON de_conversation (owner_id);

CREATE TABLE IF NOT EXISTS de_conversation_message (
    id               BIGINT       NOT NULL PRIMARY KEY,
    conversation_id  BIGINT       NOT NULL,
    role             VARCHAR(32)  NOT NULL,
    content          TEXT         NOT NULL DEFAULT '',
    attachments_json JSONB        NOT NULL DEFAULT '[]'::jsonb,
    create_time      BIGINT       NULL
);

CREATE INDEX IF NOT EXISTS idx_conversation_message_cid ON de_conversation_message (conversation_id);

CREATE TABLE IF NOT EXISTS de_conversation_run (
    id               BIGINT       NOT NULL PRIMARY KEY,
    conversation_id  BIGINT       NOT NULL,
    status           VARCHAR(32)  NOT NULL DEFAULT 'streaming',
    mode             VARCHAR(16)  NOT NULL DEFAULT 'auto',
    style_id         VARCHAR(64)  NULL,
    plan_json        JSONB        NULL,
    finish_reason    VARCHAR(64)  NULL,
    finish_detail    TEXT         NULL,
    create_time      BIGINT       NULL,
    update_time      BIGINT       NULL
);

CREATE INDEX IF NOT EXISTS idx_conversation_run_cid ON de_conversation_run (conversation_id);

CREATE TABLE IF NOT EXISTS de_conversation_revision (
    id               BIGINT       NOT NULL PRIMARY KEY,
    conversation_id  BIGINT       NOT NULL,
    run_id           BIGINT       NULL,
    dashboard_id     VARCHAR(64)  NOT NULL,
    patch_json       JSONB        NOT NULL DEFAULT '{}'::jsonb,
    snapshot_json    JSONB        NOT NULL DEFAULT '{}'::jsonb,
    label            VARCHAR(256) NULL,
    create_time      BIGINT       NULL
);

CREATE INDEX IF NOT EXISTS idx_conversation_revision_cid ON de_conversation_revision (conversation_id);
