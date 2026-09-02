-- P016 commercial E2E: keep the demo payment order dataset queryable.
-- This does not replace real warehouse data; it only makes local/LAN demo
-- environments expose the same business table name used in user acceptance.

INSERT INTO de_dataset (id, name, folder, datasource_id, table_name, status, create_time, update_time)
VALUES
  ('ds_012eb19e', '支付订单表', '订单经营', 'src_demo', 't_pay_order', 'ready', 0, 0)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  folder = EXCLUDED.folder,
  datasource_id = EXCLUDED.datasource_id,
  table_name = EXCLUDED.table_name,
  status = EXCLUDED.status,
  update_time = EXCLUDED.update_time;

DELETE FROM de_dataset_field WHERE dataset_id = 'ds_012eb19e';

INSERT INTO de_dataset_field (id, dataset_id, name, label, field_group, data_type, ord) VALUES
  (7210, 'ds_012eb19e', 'PayOrderId', '支付订单ID', 'dim', 'STRING', 1),
  (7211, 'ds_012eb19e', 'CreatedDate', '下单日期', 'dim', 'DATE', 2),
  (7212, 'ds_012eb19e', 'Status', '支付状态（-1=未知/缺失；2=支付成功；3=业务处理完成）', 'dim', 'STRING', 3),
  (7213, 'ds_012eb19e', 'ChannelId', '渠道ID', 'dim', 'STRING', 4),
  (7214, 'ds_012eb19e', 'ProductId', '产品ID', 'dim', 'STRING', 5),
  (7215, 'ds_012eb19e', 'MchId', '商户ID', 'dim', 'STRING', 6),
  (7216, 'ds_012eb19e', 'Amount', '订单金额（单位分）', 'quota', 'DECIMAL', 7),
  (7217, 'ds_012eb19e', 'MchIncome', '商户入账金额（单位分）', 'quota', 'DECIMAL', 8),
  (7218, 'ds_012eb19e', 'AgentProfit', '平台代理利润（单位分）', 'quota', 'DECIMAL', 9),
  (7219, 'ds_012eb19e', 'MchRate', '商户费率', 'quota', 'DECIMAL', 10)
ON CONFLICT (id) DO NOTHING;
