-- Additive cache field. Existing minibrot data and timestamps remain unchanged.
-- The information_schema guard also makes recovery after an unrecorded DDL safe.
SET @fracto_ray_column_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'free_bailiwicks'
    AND COLUMN_NAME = 'ray_paths'
);
SET @fracto_ray_column_ddl = IF(@fracto_ray_column_exists = 0,
  'ALTER TABLE free_bailiwicks ADD COLUMN ray_paths JSON NULL', 'SELECT 1');
PREPARE fracto_ray_column_stmt FROM @fracto_ray_column_ddl;
EXECUTE fracto_ray_column_stmt;
DEALLOCATE PREPARE fracto_ray_column_stmt;
