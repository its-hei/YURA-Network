-- YURA v3.3.98: avatar preferences / paid Pokémon choices / confirmed month winners.
-- User IDs are the authority for avatar preference updates; never trust a submitted login.
CREATE TABLE IF NOT EXISTS pokemon_profiles (
  twitch_user_id TEXT PRIMARY KEY NOT NULL,
  login TEXT NOT NULL COLLATE NOCASE,
  avatar_mode TEXT NOT NULL DEFAULT 'twitch' CHECK(avatar_mode IN ('twitch','pokemon')),
  pokemon_id INTEGER NOT NULL CHECK(pokemon_id BETWEEN 1 AND 1025),
  pokemon_name TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pokemon_profiles_login ON pokemon_profiles(login);
CREATE TABLE IF NOT EXISTS pokemon_purchases (
  event_id TEXT PRIMARY KEY NOT NULL,
  twitch_user_id TEXT NOT NULL,
  login TEXT NOT NULL,
  pokemon_id INTEGER NOT NULL CHECK(pokemon_id BETWEEN 1 AND 1025),
  pokemon_name TEXT NOT NULL,
  price INTEGER NOT NULL CHECK(price=15000),
  created_at_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pokemon_purchases_user ON pokemon_purchases(twitch_user_id);
CREATE TABLE IF NOT EXISTS vip_monthly_awards (
  won_month TEXT PRIMARY KEY NOT NULL,
  active_month TEXT NOT NULL,
  login TEXT NOT NULL COLLATE NOCASE,
  twitch_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  gained_exp INTEGER NOT NULL CHECK(gained_exp>=0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','granted')),
  created_at_utc TEXT NOT NULL,
  granted_at_utc TEXT NOT NULL DEFAULT ''
);
