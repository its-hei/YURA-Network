-- User-requested Pokémon cooldowns. Modify ONLY these two command settings
-- in persisted D1 configuration; leave all other settings untouched.
-- Global cooldown is separate for !pokemon and !pokeroll (one second each).
UPDATE meta
SET value = json_set(value,
  '$.pokemon.userCooldown', 0,
  '$.pokemon.globalCooldown', 1,
  '$.pokeroll.userCooldown', 0,
  '$.pokeroll.globalCooldown', 1
)
WHERE key = 'command_settings_json'
  AND json_valid(value);

-- Clear the old per-user 3s/5s cooldown slots so new values take effect.
DELETE FROM command_cooldowns
WHERE command_key IN ('pokemon', 'pokeroll');
