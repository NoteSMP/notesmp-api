CREATE TABLE IF NOT EXISTS player_advancements (
  minecraft_uuid TEXT NOT NULL,
  advancement_id TEXT NOT NULL,
  advancement_title TEXT NOT NULL DEFAULT '',
  earned_at TEXT NOT NULL,
  PRIMARY KEY (minecraft_uuid, advancement_id)
);

CREATE INDEX IF NOT EXISTS idx_player_advancements_earned
  ON player_advancements(minecraft_uuid, earned_at DESC);
