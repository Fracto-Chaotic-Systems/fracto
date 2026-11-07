-- Additive storage only. Discovery is explicitly requested; no backfill.
CREATE TABLE IF NOT EXISTS orbital_discovery_runs (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  request_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_bailiwick_id BIGINT UNSIGNED NOT NULL,
  focal_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  focal_re VARCHAR(768) CHARACTER SET ascii NOT NULL,
  focal_im VARCHAR(768) CHARACTER SET ascii NOT NULL,
  source_pattern INT UNSIGNED NOT NULL,
  settings JSON NOT NULL,
  calculation_version VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  stage VARCHAR(32) NOT NULL,
  progress JSON NOT NULL,
  error_code VARCHAR(64) NULL,
  cancel_requested TINYINT(1) NOT NULL DEFAULT 0,
  lease_expires_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_orbital_run_request (request_key),
  KEY idx_orbital_run_focal (focal_key, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS orbital_progressions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  focal_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  focal_re VARCHAR(768) CHARACTER SET ascii NOT NULL,
  focal_im VARCHAR(768) CHARACTER SET ascii NOT NULL,
  period INT UNSIGNED NOT NULL,
  precision_digits INT UNSIGNED NOT NULL,
  closure_error VARCHAR(768) CHARACTER SET ascii NOT NULL,
  closure_tolerance VARCHAR(768) CHARACTER SET ascii NOT NULL,
  identity_tolerance VARCHAR(768) CHARACTER SET ascii NOT NULL,
  calculation_version VARCHAR(64) NOT NULL,
  ray_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  ray_metadata JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_orbital_focal_period (focal_key, period)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS orbital_progression_points (
  orbital_id BIGINT UNSIGNED NOT NULL,
  point_index INT UNSIGNED NOT NULL,
  point_re VARCHAR(768) CHARACTER SET ascii NOT NULL,
  point_im VARCHAR(768) CHARACTER SET ascii NOT NULL,
  PRIMARY KEY (orbital_id, point_index),
  CONSTRAINT fk_orbital_point FOREIGN KEY (orbital_id) REFERENCES orbital_progressions (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS orbital_landing_ratios (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  orbital_id BIGINT UNSIGNED NOT NULL,
  point_index INT UNSIGNED NOT NULL,
  numerator VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  denominator VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  family_key VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  angle_period INT UNSIGNED NOT NULL,
  landing_error DOUBLE NOT NULL,
  validation_status VARCHAR(32) NOT NULL,
  calculation_version VARCHAR(64) NOT NULL,
  UNIQUE KEY uq_orbital_angle (orbital_id, numerator, denominator),
  KEY idx_orbital_ratio_point (orbital_id, point_index),
  CONSTRAINT fk_orbital_ratio_point FOREIGN KEY (orbital_id, point_index)
    REFERENCES orbital_progression_points (orbital_id, point_index)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS orbital_discovery_results (
  run_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  orbital_id BIGINT UNSIGNED NOT NULL,
  disposition VARCHAR(16) NOT NULL,
  discovery_method VARCHAR(32) NOT NULL,
  PRIMARY KEY (run_id, orbital_id),
  CONSTRAINT fk_orbital_result_run FOREIGN KEY (run_id) REFERENCES orbital_discovery_runs (id),
  CONSTRAINT fk_orbital_result_orbit FOREIGN KEY (orbital_id) REFERENCES orbital_progressions (id)
) ENGINE=InnoDB;
