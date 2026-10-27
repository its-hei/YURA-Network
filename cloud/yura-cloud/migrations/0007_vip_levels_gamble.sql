-- v3.3.93: non-spendable XP monthly checkpoints and permanent-VIP claims.
CREATE TABLE IF NOT EXISTS vip_monthly_levels (
  month_key TEXT NOT NULL, login TEXT NOT NULL COLLATE NOCASE,
  base_exp INTEGER NOT NULL CHECK(base_exp>=0),
  end_exp INTEGER, created_at_utc TEXT NOT NULL,
  PRIMARY KEY(month_key,login)
);
CREATE INDEX IF NOT EXISTS idx_vip_monthly_levels_month ON vip_monthly_levels(month_key);
CREATE TABLE IF NOT EXISTS vip_permanent_awards (
  login TEXT PRIMARY KEY COLLATE NOCASE,
  twitch_user_id TEXT NOT NULL, display_name TEXT NOT NULL,
  stake INTEGER NOT NULL, won INTEGER NOT NULL,
  chance_percent REAL NOT NULL, roll_percent REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','granted')),
  created_at_utc TEXT NOT NULL, granted_at_utc TEXT NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vip_permanent_awards_uid ON vip_permanent_awards(twitch_user_id);
