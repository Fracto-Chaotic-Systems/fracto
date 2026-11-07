-- Durable unit boundaries and execution fencing; no calculation or backfill.
SET @orbital_token_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orbital_discovery_runs' AND COLUMN_NAME='execution_token'
);
SET @orbital_token_ddl = IF(@orbital_token_exists=0,
  'ALTER TABLE orbital_discovery_runs ADD COLUMN execution_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL, ADD COLUMN resume_count INT UNSIGNED NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE orbital_token_stmt FROM @orbital_token_ddl;
EXECUTE orbital_token_stmt;
DEALLOCATE PREPARE orbital_token_stmt;

CREATE TABLE IF NOT EXISTS orbital_discovery_checkpoints (
  run_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  format_version INT UNSIGNED NOT NULL,
  phase VARCHAR(32) NOT NULL,
  payload MEDIUMBLOB NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_orbital_checkpoint_run FOREIGN KEY (run_id) REFERENCES orbital_discovery_runs(id)
) ENGINE=InnoDB;
