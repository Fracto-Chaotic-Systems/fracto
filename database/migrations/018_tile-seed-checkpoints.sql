-- The byte position advances in the same InnoDB transaction as a tile batch.
CREATE TABLE IF NOT EXISTS fracto_tile_seed_checkpoints (
  target_table VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  source_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_json JSON NOT NULL,
  byte_offset BIGINT UNSIGNED NOT NULL DEFAULT 0,
  processed BIGINT UNSIGNED NOT NULL DEFAULT 0,
  inserted BIGINT UNSIGNED NOT NULL DEFAULT 0,
  existing BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;
