-- Datasource + Dataset schema with seed aligned to hi-fi demo

CREATE TABLE IF NOT EXISTS de_datasource (
    id              VARCHAR(64)  NOT NULL PRIMARY KEY,
    name            VARCHAR(256) NOT NULL,
    type            VARCHAR(32)  NOT NULL,
    host            VARCHAR(256) NULL,
    port            INT          NULL,
    db_name         VARCHAR(128) NULL,
    username        VARCHAR(128) NULL,
    status          VARCHAR(32)  NOT NULL DEFAULT 'ok',
    ext_json        JSONB        NULL,
    create_time     BIGINT       NULL,
    update_time     BIGINT       NULL
);

CREATE TABLE IF NOT EXISTS de_dataset (
    id              VARCHAR(64)  NOT NULL PRIMARY KEY,
    name            VARCHAR(256) NOT NULL,
    folder          VARCHAR(128) NULL,
    datasource_id   VARCHAR(64)  NULL,
    table_name      VARCHAR(128) NULL,
    status          VARCHAR(32)  NOT NULL DEFAULT 'ready',
    create_time     BIGINT       NULL,
    update_time     BIGINT       NULL
);

CREATE INDEX IF NOT EXISTS idx_dataset_ds ON de_dataset (datasource_id);
CREATE INDEX IF NOT EXISTS idx_dataset_folder ON de_dataset (folder);

CREATE TABLE IF NOT EXISTS de_dataset_field (
    id              BIGINT       NOT NULL PRIMARY KEY,
    dataset_id      VARCHAR(64)  NOT NULL,
    name            VARCHAR(128) NOT NULL,
    label           VARCHAR(128) NULL,
    field_group     VARCHAR(16)  NOT NULL DEFAULT 'dim',
    data_type       VARCHAR(32)  NULL,
    ord             INT          NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ds_field_dataset ON de_dataset_field (dataset_id);

INSERT INTO de_datasource (id, name, type, host, port, db_name, username, status, ext_json, create_time, update_time)
VALUES
  ('src_mysql_erp', 'ERP MySQL', 'mysql', '10.0.1.21', 3306, 'erp', 'bi_ro', 'ok',
   '{"desc":"订单/库存主库"}'::jsonb, 0, 0),
  ('src_pg_bi', 'BI PostgreSQL', 'pg', '10.0.1.33', 5432, 'bi', 'bi_ro', 'ok',
   '{"desc":"运营分析库"}'::jsonb, 0, 0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO de_dataset (id, name, folder, datasource_id, table_name, status, create_time, update_time)
VALUES
  ('ds_sales', '销售明细', '销售分析', 'src_mysql_erp', 'fact_sales', 'ready', 0, 0),
  ('ds_ops', '运营日报', '运营增长', 'src_pg_bi', 'ops_daily', 'ready', 0, 0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO de_dataset_field (id, dataset_id, name, label, field_group, data_type, ord) VALUES
  (1, 'ds_sales', 'region', '区域', 'dim', 'STRING', 1),
  (2, 'ds_sales', 'channel', '渠道', 'dim', 'STRING', 2),
  (3, 'ds_sales', 'product', '产品', 'dim', 'STRING', 3),
  (4, 'ds_sales', 'amount', '销售额', 'quota', 'DECIMAL', 4),
  (5, 'ds_sales', 'qty', '销量', 'quota', 'DECIMAL', 5),
  (6, 'ds_sales', 'profit', '利润', 'quota', 'DECIMAL', 6),
  (7, 'ds_ops', 'day', '日期', 'dim', 'STRING', 1),
  (8, 'ds_ops', 'module', '模块', 'dim', 'STRING', 2),
  (9, 'ds_ops', 'uv', 'UV', 'quota', 'DECIMAL', 3),
  (10, 'ds_ops', 'pv', 'PV', 'quota', 'DECIMAL', 4)
ON CONFLICT (id) DO NOTHING;

-- Point seed charts at dataset string ids stored in encode_json (already ds_sales)
UPDATE de_chart_view SET dataset_id = NULL WHERE id IN (101, 102, 103);
