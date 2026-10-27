CREATE TABLE IF NOT EXISTS discord_member_snapshot (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  is_bot INTEGER NOT NULL DEFAULT 0,
  last_seen_utc TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discord_member_snapshot_last_seen
  ON discord_member_snapshot(last_seen_utc);
