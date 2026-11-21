-- Persistent deduplication across Worker restarts and Desktop releases.
-- First successful fetch establishes a baseline without posting old entries.
CREATE TABLE IF NOT EXISTS ffxiv_news_seen (
  source TEXT NOT NULL,
  item_id TEXT NOT NULL,
  first_seen_utc TEXT NOT NULL,
  PRIMARY KEY (source, item_id)
);
CREATE INDEX IF NOT EXISTS idx_ffxiv_news_seen_source_time
  ON ffxiv_news_seen(source, first_seen_utc DESC);
