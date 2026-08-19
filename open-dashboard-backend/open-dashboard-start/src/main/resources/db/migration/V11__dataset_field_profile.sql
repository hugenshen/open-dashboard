-- 数据集字段自学习画像（阶段1：统计特征 + 学习角色 + 采样）
-- 参照 deer-flow 记忆的「确定性写闸」思路：角色由统计特征判定（命名仅候选打分），
-- 采样供 LLM 语义解释（od_interpret_fields）与 schema 返回体使用。

CREATE TABLE IF NOT EXISTS de_dataset_field_profile (
    dataset_id       VARCHAR(64)  NOT NULL,
    field_name       VARCHAR(128) NOT NULL,
    field_label      VARCHAR(255) NULL,
    data_type        VARCHAR(32)  NULL,
    role_learned     VARCHAR(16)  NULL,           -- dim | measure | time | flag | id | junk | text
    role_source      VARCHAR(16)  NULL,           -- stats | naming | both | manual
    distinct_count   BIGINT       NULL,
    null_count       BIGINT       NULL,
    null_rate        DOUBLE PRECISION NULL,
    numeric_min      DOUBLE PRECISION NULL,
    numeric_max      DOUBLE PRECISION NULL,
    distinct_values  JSONB        NULL,           -- 低基数取值集合 ["0","1"]；高基数存 [min,max]
    is_timestamp_like BOOLEAN     NULL,
    sample_json      JSONB        NULL,           -- 该字段 ≤20 行真实采样
    learned_at       BIGINT       NULL,
    PRIMARY KEY (dataset_id, field_name)
);

CREATE INDEX IF NOT EXISTS idx_dsfp_dataset ON de_dataset_field_profile (dataset_id);
