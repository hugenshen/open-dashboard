-- 业务词表 + 公共维度（阶段2：指标/维度语义对齐 + 维度值存储）
-- 维度自学习：Learner 把低基数 dim 字段抽取为公共维度候选，含维度值（values_json）。

CREATE TABLE IF NOT EXISTS de_glossary (
    id               BIGSERIAL PRIMARY KEY,
    term             VARCHAR(128) NOT NULL,   -- 业务词「销售额」「状态」
    type             VARCHAR(16)  NOT NULL DEFAULT 'metric',  -- metric | dimension | entity | flag
    dataset_id       VARCHAR(64),             -- 来源数据集（公共维度可能跨表）
    canonical_field  VARCHAR(128),            -- 对齐到的字段（spending_amount / status）
    aliases          JSONB        NULL,       -- ["销售额","sales","GMV"]
    values_json      JSONB        NULL,       -- 维度枚举值 ["0-草稿","1-发布"]（type=dimension 时）
    status           VARCHAR(16)  NOT NULL DEFAULT 'candidate', -- candidate | confirmed | merged | deprecated
    source           VARCHAR(16)  NOT NULL DEFAULT 'learned',   -- learned | manual
    confidence       REAL         DEFAULT 0,  -- 0-1
    created_at       BIGINT       NULL,
    updated_at       BIGINT       NULL,
    UNIQUE (term, dataset_id)
);

CREATE INDEX IF NOT EXISTS idx_glossary_type ON de_glossary (type, status);
CREATE INDEX IF NOT EXISTS idx_glossary_dataset ON de_glossary (dataset_id);
