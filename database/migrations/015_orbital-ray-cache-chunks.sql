-- Content-addressed chunks for large catalog outcomes and Julia path caches.
-- Existing inline cache rows remain valid, with no backfill or recalculation.
CREATE TABLE IF NOT EXISTS orbital_ray_cache_chunks (
  content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  payload MEDIUMBLOB NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;
