-- P019 report generation run, traceability, evidence and artifact persistence

ALTER TABLE de_conversation_run ADD COLUMN IF NOT EXISTS run_type VARCHAR(16) NOT NULL DEFAULT 'board';
ALTER TABLE de_conversation_run ADD COLUMN IF NOT EXISTS workspace_id VARCHAR(128) NOT NULL DEFAULT 'workspace-retail';
ALTER TABLE de_conversation_run ADD COLUMN IF NOT EXISTS owner_id VARCHAR(128) NOT NULL DEFAULT 'demo';
ALTER TABLE de_conversation_run ADD COLUMN IF NOT EXISTS brief_json JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE de_conversation_run ADD COLUMN IF NOT EXISTS brief_version INT NOT NULL DEFAULT 1;
ALTER TABLE de_conversation_run ADD COLUMN IF NOT EXISTS plan_version INT NOT NULL DEFAULT 0;
ALTER TABLE de_conversation_run ADD COLUMN IF NOT EXISTS approved_plan_version INT NULL;
ALTER TABLE de_conversation_run ADD COLUMN IF NOT EXISTS budget_json JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE de_conversation_run ADD COLUMN IF NOT EXISTS quality_json JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE de_conversation_run ADD COLUMN IF NOT EXISTS active_artifact_version INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_conversation_run_scope
ON de_conversation_run (workspace_id, owner_id, conversation_id, id);

CREATE TABLE IF NOT EXISTS de_report_task (
    id BIGINT NOT NULL PRIMARY KEY,
    run_id BIGINT NOT NULL,
    plan_version INT NOT NULL,
    task_key VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    attempt INT NOT NULL DEFAULT 1,
    depends_on_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    spec_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    budget_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    skip_reason TEXT NULL,
    create_time BIGINT NULL,
    update_time BIGINT NULL,
    UNIQUE (run_id, plan_version, task_key, attempt)
);
CREATE INDEX IF NOT EXISTS idx_report_task_run ON de_report_task (run_id, id);

CREATE TABLE IF NOT EXISTS de_report_event (
    id BIGINT NOT NULL PRIMARY KEY,
    run_id BIGINT NOT NULL,
    task_id BIGINT NULL,
    audience VARCHAR(16) NOT NULL DEFAULT 'business',
    event_type VARCHAR(64) NOT NULL,
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    create_time BIGINT NULL
);
CREATE INDEX IF NOT EXISTS idx_report_event_run ON de_report_event (run_id, id);

CREATE TABLE IF NOT EXISTS de_report_evidence (
    id BIGINT NOT NULL PRIMARY KEY,
    run_id BIGINT NOT NULL,
    task_id BIGINT NULL,
    dataset_id VARCHAR(128) NOT NULL,
    query_fingerprint VARCHAR(128) NOT NULL,
    metric_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    filters_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    time_range_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    unit_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    denominator_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    result_digest VARCHAR(128) NOT NULL,
    result_summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    sample_rows_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    create_time BIGINT NULL
);
CREATE INDEX IF NOT EXISTS idx_report_evidence_run ON de_report_evidence (run_id, id);

CREATE TABLE IF NOT EXISTS de_report_claim (
    id BIGINT NOT NULL PRIMARY KEY,
    run_id BIGINT NOT NULL,
    artifact_version INT NOT NULL,
    section_id VARCHAR(128) NULL,
    claim_type VARCHAR(32) NOT NULL,
    statement TEXT NOT NULL,
    evidence_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    confidence VARCHAR(16) NULL,
    caveat TEXT NULL,
    validation_status VARCHAR(32) NOT NULL DEFAULT 'pending',
    create_time BIGINT NULL
);
CREATE INDEX IF NOT EXISTS idx_report_claim_run ON de_report_claim (run_id, artifact_version, id);

CREATE TABLE IF NOT EXISTS de_report_artifact (
    id BIGINT NOT NULL PRIMARY KEY,
    run_id BIGINT NOT NULL,
    artifact_version INT NOT NULL,
    kind VARCHAR(32) NOT NULL,
    filename VARCHAR(256) NOT NULL,
    content_type VARCHAR(128) NOT NULL,
    content_text TEXT NOT NULL,
    evidence_set_version INT NOT NULL DEFAULT 1,
    parent_version INT NULL,
    change_scope VARCHAR(128) NULL,
    create_time BIGINT NULL
);
CREATE INDEX IF NOT EXISTS idx_report_artifact_run ON de_report_artifact (run_id, artifact_version, id);

