-- Keep numerical confirmation, discovery counts, and ranked run membership.
-- Existing orbital points and ray data are retained without a backfill.
SET @fracto_orbital_metadata_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orbital_progressions' AND COLUMN_NAME='discovery_metadata'
);
SET @fracto_orbital_metadata_ddl = IF(@fracto_orbital_metadata_exists=0,
  'ALTER TABLE orbital_progressions ADD COLUMN discovery_metadata JSON NULL', 'SELECT 1');
PREPARE fracto_orbital_metadata_stmt FROM @fracto_orbital_metadata_ddl;
EXECUTE fracto_orbital_metadata_stmt;
DEALLOCATE PREPARE fracto_orbital_metadata_stmt;

SET @fracto_result_metadata_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orbital_discovery_results' AND COLUMN_NAME='discovery_metadata'
);
SET @fracto_result_metadata_ddl = IF(@fracto_result_metadata_exists=0,
  'ALTER TABLE orbital_discovery_results ADD COLUMN discovery_metadata JSON NULL', 'SELECT 1');
PREPARE fracto_result_metadata_stmt FROM @fracto_result_metadata_ddl;
EXECUTE fracto_result_metadata_stmt;
DEALLOCATE PREPARE fracto_result_metadata_stmt;
