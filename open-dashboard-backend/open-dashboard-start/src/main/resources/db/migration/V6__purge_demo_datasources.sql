-- Purge unreachable demo datasources/datasets; keep only connections with stored password.

CREATE TEMP TABLE tmp_drop_ds AS
SELECT id FROM de_dataset
 WHERE id IN ('ds_sales', 'ds_ops')
    OR datasource_id IN ('src_mysql_erp', 'src_pg_bi')
    OR datasource_id IN (
         SELECT id FROM de_datasource
          WHERE password_enc IS NULL OR btrim(password_enc) = ''
    );

-- dataset refs live in encode_json (varchar ids); de_chart_view.dataset_id is legacy bigint
UPDATE de_chart_view
   SET encode_json = COALESCE(encode_json, '{}'::jsonb) - 'datasetId'
 WHERE encode_json->>'datasetId' IN (SELECT id FROM tmp_drop_ds);

DELETE FROM de_dataset_field WHERE dataset_id IN (SELECT id FROM tmp_drop_ds);
DELETE FROM de_dataset WHERE id IN (SELECT id FROM tmp_drop_ds);

DELETE FROM de_datasource
 WHERE id IN ('src_mysql_erp', 'src_pg_bi')
    OR password_enc IS NULL
    OR btrim(password_enc) = '';

DROP TABLE tmp_drop_ds;
