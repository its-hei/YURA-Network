CREATE TABLE IF NOT EXISTS cloud_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL DEFAULT '',
  user_login TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL DEFAULT 0,
  created_at_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cloud_events_time ON cloud_events(created_at_utc DESC);
CREATE INDEX IF NOT EXISTS idx_cloud_events_type_time ON cloud_events(event_type, created_at_utc DESC);

CREATE TABLE IF NOT EXISTS cloud_timers (
  id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  repeat_minutes INTEGER NOT NULL DEFAULT 30,
  only_when_live INTEGER NOT NULL DEFAULT 1,
  min_chat_messages INTEGER NOT NULL DEFAULT 0,
  chat_count INTEGER NOT NULL DEFAULT 0,
  last_sent_utc TEXT NOT NULL DEFAULT '',
  updated_at_utc TEXT NOT NULL
);
