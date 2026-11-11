-- Denominator-catalog investigation ledger. No backfill or orbital recalculation.
CREATE TABLE IF NOT EXISTS orbital_family_investigations (
  identity_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  focal_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  focal_re VARCHAR(768) CHARACTER SET ascii NOT NULL,
  focal_im VARCHAR(768) CHARACTER SET ascii NOT NULL,
  family_key VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  denominator VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  angle_period INT UNSIGNED NOT NULL,
  catalog_version VARCHAR(64) CHARACTER SET ascii NOT NULL,
  solver_version VARCHAR(64) CHARACTER SET ascii NOT NULL,
  profile JSON NOT NULL,
  status VARCHAR(24) CHARACTER SET ascii NOT NULL DEFAULT 'pending',
  reason VARCHAR(96) CHARACTER SET ascii NULL,
  outcome JSON NULL,
  orbital_id BIGINT UNSIGNED NULL,
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  lease_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  lease_expires_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_orbital_family_focal (focal_key, family_key),
  KEY idx_orbital_family_status (status, lease_expires_at),
  CONSTRAINT fk_family_investigation_orbital FOREIGN KEY (orbital_id)
    REFERENCES orbital_progressions(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS orbital_family_investigation_attempts (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  investigation_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(24) CHARACTER SET ascii NOT NULL,
  reason VARCHAR(96) CHARACTER SET ascii NULL,
  outcome_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  evidence JSON NULL,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at DATETIME(3) NULL,
  KEY idx_family_attempt_investigation (investigation_key, started_at),
  CONSTRAINT fk_family_attempt_investigation FOREIGN KEY (investigation_key)
    REFERENCES orbital_family_investigations(identity_key)
) ENGINE=InnoDB;
