-- 指标注册表（阶段2：候选指标 + 人工确认 → confirmed 权威口径）
-- 自学习 Learner 在录入时写 draft 候选；管理页「指标确认」draft → confirmed；
-- od_interpret_fields / 生成验证回写 confidence（自学习闭环）。
-- confirmed 指标参与 <knowledge> 注入与 od_plan_charts 指标选择（agg/unit 权威）。

CREATE TABLE IF NOT EXISTS de_indicator (
    id           BIGSERIAL PRIMARY KEY,
    dataset_id   VARCHAR(64)  NOT NULL,
    field_name   VARCHAR(128) NOT NULL,
    name         VARCHAR(128) NOT NULL,           -- 业务名「消费金额」
    agg          VARCHAR(16)  NULL,               -- SUM | AVG | COUNT | MIN | MAX
    unit         VARCHAR(32)  NULL,               -- 元 | 万元 | % | 件 …
    formula      TEXT         NULL,               -- 口径说明（如「订单金额 - 退款」）
    description  TEXT         NULL,
    status       VARCHAR(16)  NOT NULL DEFAULT 'draft',  -- draft | confirmed | deprecated
    source       VARCHAR(16)  NOT NULL DEFAULT 'learned', -- learned | manual
    confidence   REAL         DEFAULT 0,          -- 0-1，统计/LLM 给的可信度
    created_at   BIGINT       NULL,
    updated_at   BIGINT       NULL,
    UNIQUE (dataset_id, field_name, name)
);

CREATE INDEX IF NOT EXISTS idx_indicator_dataset ON de_indicator (dataset_id, status);
