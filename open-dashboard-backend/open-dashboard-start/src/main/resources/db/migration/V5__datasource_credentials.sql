-- Real JDBC credentials + default schema for business datasources

ALTER TABLE de_datasource ADD COLUMN IF NOT EXISTS password_enc TEXT NULL;
ALTER TABLE de_datasource ADD COLUMN IF NOT EXISTS schema_name VARCHAR(128) NULL;
