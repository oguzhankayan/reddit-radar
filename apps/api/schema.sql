-- Reddit Radar — D1 şeması.
-- Ham Reddit metni BURAYA GİRMEZ; o R2'de durur ve saklama politikasına tabidir.

CREATE TABLE IF NOT EXISTS accounts (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  plan        TEXT NOT NULL DEFAULT 'free',
  item_quota  INTEGER NOT NULL DEFAULT 1000,   -- ay başına sınıflandırılabilir item
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Anahtarın kendisi saklanmaz; yalnız SHA-256 özeti (v2 §48).
CREATE TABLE IF NOT EXISTS api_keys (
  hash        TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id),
  label       TEXT,
  last_used   TEXT,
  revoked_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scans (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  question      TEXT NOT NULL,
  spec          TEXT NOT NULL,          -- ScanPlan JSON
  status        TEXT NOT NULL,
  target_items  INTEGER NOT NULL,
  received      INTEGER NOT NULL DEFAULT 0,
  classified    INTEGER NOT NULL DEFAULT 0,
  failures      INTEGER NOT NULL DEFAULT 0,
  partial_reason TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_scans_account ON scans(account_id, created_at DESC);

-- Item başına Stage 1/2 kararı. Metin YOK — yalnız kimlik ve skorlar.
CREATE TABLE IF NOT EXISTS item_scores (
  scan_id       TEXT NOT NULL REFERENCES scans(id),
  item_id       TEXT NOT NULL,
  fit           REAL,
  disqualified  REAL,
  score         REAL,
  stage2        TEXT,                   -- Stage 2 olasılıkları JSON
  opportunity   INTEGER,
  PRIMARY KEY (scan_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_scores_rank ON item_scores(scan_id, score DESC);

CREATE TABLE IF NOT EXISTS usage_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id  TEXT NOT NULL,
  scan_id     TEXT,
  kind        TEXT NOT NULL,            -- classified_items | synthesis
  units       INTEGER NOT NULL,
  at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_usage_account ON usage_events(account_id, at DESC);
