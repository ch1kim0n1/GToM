-- migrate:up
CREATE INDEX IF NOT EXISTS idx_gtom_receipts_timestamp ON gtom_receipts(timestamp);
CREATE INDEX IF NOT EXISTS idx_gtom_receipts_corpus_sha8 ON gtom_receipts(corpus_sha8);
CREATE INDEX IF NOT EXISTS idx_gtom_vulnerability_snapshots_recorded_at ON gtom_vulnerability_snapshots(recorded_at);

-- migrate:down
DROP INDEX IF EXISTS idx_gtom_vulnerability_snapshots_recorded_at;
DROP INDEX IF EXISTS idx_gtom_receipts_corpus_sha8;
DROP INDEX IF EXISTS idx_gtom_receipts_timestamp;
