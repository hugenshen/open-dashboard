-- Reintroduce stub demo datasets for business-domain dashboard templates.
-- Uses src_demo with a non-empty password_enc so purge-style cleanups keep them.

INSERT INTO de_datasource (
  id, name, type, host, port, db_name, username, status, ext_json,
  password_enc, schema_name, create_time, update_time
)
VALUES (
  'src_demo', '演示数据（模版）', 'demo', '127.0.0.1', 0, 'demo', 'demo', 'ok',
  '{"desc":"业务领域模版绑定的 stub 数据集，不连真实库"}'::jsonb,
  'stub', NULL, 0, 0
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  type = EXCLUDED.type,
  status = EXCLUDED.status,
  password_enc = EXCLUDED.password_enc,
  ext_json = EXCLUDED.ext_json,
  update_time = EXCLUDED.update_time;

INSERT INTO de_dataset (id, name, folder, datasource_id, table_name, status, create_time, update_time)
VALUES
  ('ds_sales', '销售明细', '销售分析', 'src_demo', 'fact_sales', 'ready', 0, 0),
  ('ds_ops', '运营日报', '运营增长', 'src_demo', 'ops_daily', 'ready', 0, 0),
  ('ds_fin', '财务科目月报', '财务库存', 'src_demo', 'fact_finance', 'ready', 0, 0)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  folder = EXCLUDED.folder,
  datasource_id = EXCLUDED.datasource_id,
  table_name = EXCLUDED.table_name,
  status = EXCLUDED.status,
  update_time = EXCLUDED.update_time;

DELETE FROM de_dataset_field WHERE dataset_id IN ('ds_sales', 'ds_ops', 'ds_fin');

INSERT INTO de_dataset_field (id, dataset_id, name, label, field_group, data_type, ord) VALUES
  (7001, 'ds_sales', 'region', '区域', 'dim', 'STRING', 1),
  (7002, 'ds_sales', 'channel', '渠道', 'dim', 'STRING', 2),
  (7003, 'ds_sales', 'product', '产品', 'dim', 'STRING', 3),
  (7004, 'ds_sales', 'salesman', '销售员', 'dim', 'STRING', 4),
  (7005, 'ds_sales', 'amount', '销售额', 'quota', 'DECIMAL', 5),
  (7006, 'ds_sales', 'qty', '销量', 'quota', 'DECIMAL', 6),
  (7007, 'ds_sales', 'profit', '利润', 'quota', 'DECIMAL', 7),
  (7008, 'ds_sales', 'order_cnt', '订单数', 'quota', 'DECIMAL', 8),
  (7011, 'ds_ops', 'day', '日期', 'dim', 'STRING', 1),
  (7012, 'ds_ops', 'module', '模块', 'dim', 'STRING', 2),
  (7013, 'ds_ops', 'platform', '端', 'dim', 'STRING', 3),
  (7014, 'ds_ops', 'channel', '来源', 'dim', 'STRING', 4),
  (7015, 'ds_ops', 'uv', 'UV', 'quota', 'DECIMAL', 5),
  (7016, 'ds_ops', 'pv', 'PV', 'quota', 'DECIMAL', 6),
  (7017, 'ds_ops', 'bounce', '跳出率', 'quota', 'DECIMAL', 7),
  (7018, 'ds_ops', 'duration', '停留秒', 'quota', 'DECIMAL', 8),
  (7021, 'ds_fin', 'month', '月份', 'dim', 'STRING', 1),
  (7022, 'ds_fin', 'subject', '科目', 'dim', 'STRING', 2),
  (7023, 'ds_fin', 'dept', '部门', 'dim', 'STRING', 3),
  (7024, 'ds_fin', 'income', '收入', 'quota', 'DECIMAL', 4),
  (7025, 'ds_fin', 'expense', '支出', 'quota', 'DECIMAL', 5),
  (7026, 'ds_fin', 'profit', '利润', 'quota', 'DECIMAL', 6)
ON CONFLICT (id) DO NOTHING;
