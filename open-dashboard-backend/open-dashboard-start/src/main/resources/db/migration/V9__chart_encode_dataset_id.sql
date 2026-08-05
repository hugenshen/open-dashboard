-- Seed/scaffold charts historically omitted datasetId in encode_json.
-- Report chartQuery then silently fell back to ds_sales stub data, looking "fixed".
UPDATE de_chart_view
SET encode_json = COALESCE(encode_json, '{}'::jsonb) || '{"datasetId":"ds_sales"}'::jsonb
WHERE dashboard_id = 1
  AND (encode_json->>'datasetId') IS NULL;
