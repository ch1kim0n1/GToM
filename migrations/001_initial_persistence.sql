-- migrate:up
CREATE TABLE IF NOT EXISTS gtom_persistence_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gtom_receipts (
  receipt_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  corpus_sha8 TEXT NOT NULL,
  receipt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gtom_vulnerability_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  vulnerability_id TEXT NOT NULL,
  current_level REAL NOT NULL,
  recorded_at TIMESTAMP NOT NULL,
  metadata TEXT
);

-- migrate:down
DROP TABLE IF EXISTS gtom_vulnerability_snapshots;
DROP TABLE IF EXISTS gtom_receipts;
DROP TABLE IF EXISTS gtom_persistence_metadata;
