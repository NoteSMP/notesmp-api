CREATE TABLE IF NOT EXISTS stats_refresh_queue (
  uuid TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done')),
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  claimed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_stats_refresh_queue_status_requested
  ON stats_refresh_queue(status, requested_at);
