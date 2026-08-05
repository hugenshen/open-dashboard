-- Report documents + demo dashboard charts for cite wizard

CREATE TABLE IF NOT EXISTS de_report (
    id              BIGINT       NOT NULL PRIMARY KEY,
    name            VARCHAR(256) NOT NULL,
    status          VARCHAR(32)  NOT NULL DEFAULT 'draft',
    content_id      BIGINT       NOT NULL DEFAULT 1,
    version         INT          NOT NULL DEFAULT 1,
    content_json    JSONB        NOT NULL DEFAULT '{}'::jsonb,
    create_time     BIGINT       NULL,
    update_time     BIGINT       NULL
);

CREATE INDEX IF NOT EXISTS idx_report_status ON de_report (status);

-- Demo charts on dashboard 1 (draft copy)
INSERT INTO de_chart_view (id, dashboard_id, copy_type, dataset_id, chart_type, title, encode_json, style_json, senior_json)
VALUES
  (101, 1, 'draft', NULL, 'bar', '区域销售额',
   '{"datasetId":"ds_sales","category":"region","value":"amount","agg":"SUM"}'::jsonb,
   '{}'::jsonb, '{}'::jsonb),
  (102, 1, 'draft', NULL, 'kpi', '总金额 KPI',
   '{"datasetId":"ds_sales","value":"amount","agg":"SUM"}'::jsonb,
   '{}'::jsonb, '{}'::jsonb),
  (103, 1, 'draft', NULL, 'line', '渠道趋势',
   '{"datasetId":"ds_sales","category":"channel","value":"amount","agg":"SUM"}'::jsonb,
   '{}'::jsonb, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO de_dashboard_component (id, dashboard_id, copy_type, type, parent_id, chart_view_id, x, y, w, h, z_index, props)
VALUES
  (1001, 1, 'draft', 'chart', 0, 101, 0, 0, 24, 12, 1, '{}'::jsonb),
  (1002, 1, 'draft', 'chart', 0, 102, 24, 0, 12, 8, 2, '{}'::jsonb),
  (1003, 1, 'draft', 'chart', 0, 103, 0, 12, 36, 12, 3, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO de_report (id, name, status, content_id, version, content_json, create_time, update_time)
VALUES (
  1,
  '销售周报（报告脚手架）',
  'draft',
  1,
  1,
  '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"在 Ribbon「工具」中使用「引用仪表盘」或「新建图表」插入实时图表。"}]}]}'::jsonb,
  0,
  0
)
ON CONFLICT (id) DO NOTHING;
