CREATE TABLE IF NOT EXISTS hidden_players (
  uuid TEXT PRIMARY KEY,
  username TEXT,
  hidden_by TEXT,
  hidden_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hidden_players_username ON hidden_players(lower(username)) WHERE username IS NOT NULL;
