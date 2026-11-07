-- Add an indexed primary source reference without recalculating existing data.
-- Discovery-run membership retains additional source associations on rediscovery.
SET @fracto_orbital_source_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orbital_progressions'
    AND COLUMN_NAME = 'free_bailiwick_id'
);
SET @fracto_orbital_source_ddl = IF(@fracto_orbital_source_exists = 0,
  'ALTER TABLE orbital_progressions ADD COLUMN free_bailiwick_id BIGINT UNSIGNED NULL', 'SELECT 1');
PREPARE fracto_orbital_source_stmt FROM @fracto_orbital_source_ddl;
EXECUTE fracto_orbital_source_stmt;
DEALLOCATE PREPARE fracto_orbital_source_stmt;

SET @fracto_orbital_source_index_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orbital_progressions'
    AND INDEX_NAME = 'idx_orbital_bailiwick'
);
SET @fracto_orbital_source_index_ddl = IF(@fracto_orbital_source_index_exists = 0,
  'CREATE INDEX idx_orbital_bailiwick ON orbital_progressions (free_bailiwick_id)', 'SELECT 1');
PREPARE fracto_orbital_source_index_stmt FROM @fracto_orbital_source_index_ddl;
EXECUTE fracto_orbital_source_index_stmt;
DEALLOCATE PREPARE fracto_orbital_source_index_stmt;
