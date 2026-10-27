-- v3.3.100: lifetime statistics, independent from points and monthly EXP.
-- Existing balances, watchtime, EXP and VIP history are preserved.
CREATE TABLE IF NOT EXISTS stats_chat_messages (
  message_id TEXT PRIMARY KEY,
  twitch_user_id TEXT NOT NULL DEFAULT '',
  login TEXT NOT NULL COLLATE NOCASE,
  display_name TEXT NOT NULL DEFAULT '',
  sent_at_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stats_chat_login ON stats_chat_messages(login);
CREATE TABLE IF NOT EXISTS stats_chat_baseline (
  login TEXT PRIMARY KEY COLLATE NOCASE,
  messages INTEGER NOT NULL DEFAULT 0
);
-- Backfill ONLY the verbose event history present at migration time.
-- Later chat events are counted exclusively by stats_chat_messages.
INSERT OR IGNORE INTO stats_chat_baseline(login,messages)
SELECT user_login,COUNT(*) FROM cloud_events
WHERE event_type='CHAT' AND user_login<>'' GROUP BY user_login;
CREATE TABLE IF NOT EXISTS stats_gamble_all (
  event_id TEXT PRIMARY KEY,
  twitch_user_id TEXT NOT NULL DEFAULT '',
  login TEXT NOT NULL COLLATE NOCASE,
  outcome TEXT NOT NULL CHECK(outcome IN ('win','loss')),
  created_at_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stats_gamble_all_login ON stats_gamble_all(login);
INSERT INTO meta(key,value)
VALUES('stats_started_at_utc',strftime('%Y-%m-%dT%H:%M:%fZ','now'))
ON CONFLICT(key) DO NOTHING;
