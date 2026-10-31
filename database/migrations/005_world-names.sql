-- Add world names without replacing previously curated names on replay.
SET @fracto_world_name_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wordnet_mappings'
    AND COLUMN_NAME = 'world_name'
);
SET @fracto_world_name_ddl = IF(@fracto_world_name_exists = 0,
  'ALTER TABLE wordnet_mappings ADD COLUMN world_name VARCHAR(255) NOT NULL DEFAULT '''' AFTER word',
  'SELECT 1');
PREPARE fracto_world_name_stmt FROM @fracto_world_name_ddl;
EXECUTE fracto_world_name_stmt;
DEALLOCATE PREPARE fracto_world_name_stmt;

UPDATE wordnet_mappings
SET world_name = CONCAT('world ', cardinality), updated_at = updated_at
WHERE world_name = '';
