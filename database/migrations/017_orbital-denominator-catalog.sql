-- Focal-independent exact angle catalog. A representative determines its full
-- cycle by n -> 2*n mod denominator; no floating point angles or ray paths.
CREATE TABLE IF NOT EXISTS orbital_catalog_denominators (
  denominator INT UNSIGNED NOT NULL PRIMARY KEY,
  catalog_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  angle_period INT UNSIGNED NOT NULL,
  candidate_orbital_periods JSON NOT NULL,
  angle_count INT UNSIGNED NOT NULL,
  family_count INT UNSIGNED NOT NULL,
  completed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS orbital_catalog_families (
  denominator INT UNSIGNED NOT NULL,
  numerator INT UNSIGNED NOT NULL,
  PRIMARY KEY (denominator, numerator),
  KEY idx_orbital_catalog_numerator (numerator, denominator),
  CONSTRAINT fk_orbital_catalog_denominator FOREIGN KEY (denominator)
    REFERENCES orbital_catalog_denominators(denominator)
) ENGINE=InnoDB;
