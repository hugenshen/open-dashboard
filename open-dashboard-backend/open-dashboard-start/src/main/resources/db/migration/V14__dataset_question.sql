-- 高频问题（阶段5：few-shot 示例，提升 SQLBot 生成 SQL 准确度）
-- 数据集页「高频问题」tab 人工维护：用户常问的问题 + 对应的标准 SQL + 图表类型。
-- SQLBot 生成 SQL 时取该数据集最近 N 条作为 <few-shot-examples> 注入 system prompt。

CREATE TABLE IF NOT EXISTS de_dataset_question (
    id           BIGSERIAL PRIMARY KEY,
    dataset_id   VARCHAR(64)  NOT NULL,
    question     TEXT         NOT NULL,           -- 用户问题原文「各状态分布」
    sql          TEXT         NOT NULL,           -- 标准 SQL（SELECT/WITH）
    chart_type   VARCHAR(16)  NULL,               -- table | bar | line | pie | kpi
    brief        VARCHAR(128) NULL,               -- 结果标题
    status       VARCHAR(16)  NOT NULL DEFAULT 'active',  -- active | disabled
    hit_count    INT          DEFAULT 0,          -- 命中次数（用户问题匹配该示例时 +1）
    created_at   BIGINT       NULL,
    updated_at   BIGINT       NULL
);

CREATE INDEX IF NOT EXISTS idx_dq_dataset ON de_dataset_question (dataset_id, status);
