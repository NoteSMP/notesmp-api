PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS server_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  online INTEGER NOT NULL DEFAULT 0,
  players_online INTEGER NOT NULL DEFAULT 0,
  max_players INTEGER NOT NULL DEFAULT 0,
  motd TEXT NOT NULL DEFAULT '',
  version TEXT,
  online_players_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT
);

INSERT OR IGNORE INTO server_state (id, online, players_online, max_players, motd, online_players_json)
VALUES (1, 0, 0, 0, '', '[]');

CREATE TABLE IF NOT EXISTS players (
  uuid TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  first_join TEXT,
  last_seen TEXT,
  playtime_seconds INTEGER NOT NULL DEFAULT 0,
  blocks_broken INTEGER NOT NULL DEFAULT 0,
  blocks_placed INTEGER NOT NULL DEFAULT 0,
  deaths INTEGER NOT NULL DEFAULT 0,
  kills INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_players_username ON players(username COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_players_playtime ON players(playtime_seconds DESC);
CREATE INDEX IF NOT EXISTS idx_players_last_seen ON players(last_seen DESC);
