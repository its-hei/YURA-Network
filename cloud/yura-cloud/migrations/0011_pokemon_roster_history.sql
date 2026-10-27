-- YURA Pokémon roster: persistent join order and first assignment history.
-- Legacy records are backfilled from their earliest surviving draw, or
-- profile updated_at_utc if no earlier event exists. Their dates are estimates.
CREATE TABLE IF NOT EXISTS pokemon_first_assignments (
  twitch_user_id TEXT PRIMARY KEY NOT NULL,
  login TEXT NOT NULL COLLATE NOCASE,
  pokemon_id INTEGER NOT NULL CHECK(pokemon_id BETWEEN 1 AND 1025),
  pokemon_name TEXT NOT NULL,
  joined_at_utc TEXT NOT NULL,
  estimated INTEGER NOT NULL DEFAULT 0 CHECK(estimated IN (0,1))
);
CREATE INDEX IF NOT EXISTS idx_pokemon_first_joined
  ON pokemon_first_assignments(joined_at_utc,twitch_user_id);

INSERT OR IGNORE INTO pokemon_first_assignments
  (twitch_user_id,login,pokemon_id,pokemon_name,joined_at_utc,estimated)
SELECT p.twitch_user_id,p.login,p.pokemon_id,p.pokemon_name,
  COALESCE(
    (SELECT MIN(events.created_at_utc)
       FROM (
         SELECT r.created_at_utc FROM pokemon_rerolls r
          WHERE r.twitch_user_id=p.twitch_user_id
         UNION ALL
         SELECT old.created_at_utc FROM pokemon_purchases old
          WHERE old.twitch_user_id=p.twitch_user_id
       ) AS events),
    p.updated_at_utc
  ),1
FROM pokemon_profiles p
WHERE p.pokemon_id BETWEEN 1 AND 1025;
