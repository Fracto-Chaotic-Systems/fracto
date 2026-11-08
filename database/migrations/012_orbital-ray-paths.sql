-- Lazy Julia ray geometry. Separate from minibrot parameter rays; no backfill.
CREATE TABLE IF NOT EXISTS orbital_ray_paths (
  orbital_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  paths JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_orbital_ray_paths_orbital FOREIGN KEY (orbital_id) REFERENCES orbital_progressions(id)
) ENGINE=InnoDB;
