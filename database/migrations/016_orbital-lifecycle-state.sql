-- Independent orbital, landing-assignment and path-cache evidence; no backfill.
SET @orbital_lifecycle_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orbital_progressions' AND COLUMN_NAME='lifecycle_state'
);
SET @orbital_lifecycle_ddl = IF(@orbital_lifecycle_exists=0,
  'ALTER TABLE orbital_progressions ADD COLUMN lifecycle_state JSON NULL', 'SELECT 1');
PREPARE orbital_lifecycle_stmt FROM @orbital_lifecycle_ddl;
EXECUTE orbital_lifecycle_stmt;
DEALLOCATE PREPARE orbital_lifecycle_stmt;
