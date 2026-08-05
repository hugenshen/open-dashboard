-- Demo dashboard components were seeded as DataEase-like 72-col cells (h=12),
-- which become hi-fi h=2 after ÷6 and crush ECharts plot area. Bump to sizes
-- that map to bar 6×5 / kpi 4×2 / line 12×4 in the 12-col editor.

UPDATE de_dashboard_component
SET x = 0, y = 0, w = 36, h = 30
WHERE id = 1001 AND dashboard_id = 1;

UPDATE de_dashboard_component
SET x = 36, y = 0, w = 24, h = 12
WHERE id = 1002 AND dashboard_id = 1;

UPDATE de_dashboard_component
SET x = 0, y = 30, w = 72, h = 24
WHERE id = 1003 AND dashboard_id = 1;
