CREATE TABLE IF NOT EXISTS accounts (
  login TEXT PRIMARY KEY COLLATE NOCASE,
  twitch_user_id TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  points INTEGER NOT NULL DEFAULT 0,
  watch_seconds INTEGER NOT NULL DEFAULT 0,
  watch_seed_seconds INTEGER NOT NULL DEFAULT 0,
  last_seen_utc TEXT NOT NULL DEFAULT '',
  presence_remainder INTEGER NOT NULL DEFAULT 0,
  created_at_utc TEXT NOT NULL,
  last_write_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_accounts_points ON accounts(points DESC);
CREATE INDEX IF NOT EXISTS idx_accounts_watch ON accounts((watch_seconds + watch_seed_seconds) DESC);
CREATE INDEX IF NOT EXISTS idx_accounts_uid ON accounts(twitch_user_id);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  twitch_user_id TEXT NOT NULL DEFAULT '',
  login TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  delta INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  created_at_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transactions_time ON transactions(created_at_utc DESC);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS monthly_vip_exclusions (
  login TEXT PRIMARY KEY COLLATE NOCASE,
  created_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS manual_bots (
  login TEXT PRIMARY KEY COLLATE NOCASE,
  created_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS command_cooldowns (
  command_key TEXT NOT NULL,
  user_id TEXT NOT NULL,
  expires_at_utc TEXT NOT NULL,
  PRIMARY KEY(command_key, user_id)
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  kind TEXT PRIMARY KEY,
  access_token TEXT NOT NULL DEFAULT '',
  refresh_token TEXT NOT NULL DEFAULT '',
  expires_at_utc TEXT NOT NULL DEFAULT '',
  updated_at_utc TEXT NOT NULL DEFAULT ''
);
