-- Bind family leases to resumable discovery-job ownership; no recalculation.
SET @family_owner_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orbital_family_investigations' AND COLUMN_NAME='owner_run_id'
);
SET @family_owner_ddl = IF(@family_owner_exists=0,
  'ALTER TABLE orbital_family_investigations ADD COLUMN owner_run_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL, ADD COLUMN owner_execution_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL', 'SELECT 1');
PREPARE family_owner_stmt FROM @family_owner_ddl;
EXECUTE family_owner_stmt;
DEALLOCATE PREPARE family_owner_stmt;
