-- Calculated / expression fields on dataset field bank
ALTER TABLE de_dataset_field ADD COLUMN IF NOT EXISTS origin VARCHAR(16) NOT NULL DEFAULT 'table';
ALTER TABLE de_dataset_field ADD COLUMN IF NOT EXISTS expression TEXT NULL;
