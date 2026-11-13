-- Five Pokemon collection places: existing pokemon_profiles is permanently place 1.
-- Extra places unlock sequentially: 30k, 120k, 250k, 400k YURA.
CREATE TABLE IF NOT EXISTS pokemon_slot_unlocks (
  twitch_user_id TEXT NOT NULL, slot INTEGER NOT NULL CHECK(slot BETWEEN 2 AND 5),
  login TEXT NOT NULL COLLATE NOCASE, event_id TEXT NOT NULL UNIQUE,
  price INTEGER NOT NULL, created_at_utc TEXT NOT NULL,
  PRIMARY KEY(twitch_user_id,slot)
);
CREATE TABLE IF NOT EXISTS pokemon_extra_roster (
  twitch_user_id TEXT NOT NULL, slot INTEGER NOT NULL CHECK(slot BETWEEN 2 AND 5),
  pokemon_id INTEGER NOT NULL CHECK(pokemon_id BETWEEN 1 AND 1025),
  pokemon_name TEXT NOT NULL, updated_at_utc TEXT NOT NULL,
  PRIMARY KEY(twitch_user_id,slot),
  UNIQUE(pokemon_id),
  FOREIGN KEY(twitch_user_id,slot) REFERENCES pokemon_slot_unlocks(twitch_user_id,slot)
);
CREATE TABLE IF NOT EXISTS pokemon_slot_rolls (
  event_id TEXT PRIMARY KEY NOT NULL,
  twitch_user_id TEXT NOT NULL, login TEXT NOT NULL COLLATE NOCASE,
  slot INTEGER NOT NULL CHECK(slot BETWEEN 2 AND 5),
  pokemon_id INTEGER NOT NULL CHECK(pokemon_id BETWEEN 1 AND 1025),
  pokemon_name TEXT NOT NULL, price INTEGER NOT NULL CHECK(price=5000),
  created_at_utc TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS pokemon_slot_unlock_atomic BEFORE INSERT ON pokemon_slot_unlocks
BEGIN
  SELECT RAISE(ABORT,'invalid_slot') WHERE NEW.price <> CASE NEW.slot WHEN 2 THEN 30000 WHEN 3 THEN 120000 WHEN 4 THEN 250000 WHEN 5 THEN 400000 END;
  SELECT RAISE(ABORT,'first_pokemon_missing') WHERE NOT EXISTS(
    SELECT 1 FROM pokemon_profiles p WHERE p.twitch_user_id=NEW.twitch_user_id AND p.login=NEW.login);
  SELECT RAISE(ABORT,'previous_slot_locked') WHERE NEW.slot>2 AND NOT EXISTS(
    SELECT 1 FROM pokemon_slot_unlocks WHERE twitch_user_id=NEW.twitch_user_id AND slot=NEW.slot-1);
  SELECT RAISE(ABORT,'trade_pending') WHERE EXISTS(
    SELECT 1 FROM pokemon_trade_offers t WHERE t.status='pending' AND t.expires_at_utc>NEW.created_at_utc
      AND (t.seller_user_id=NEW.twitch_user_id OR t.buyer_user_id=NEW.twitch_user_id));
  UPDATE accounts SET points=points-NEW.price,last_write_utc=NEW.created_at_utc
    WHERE twitch_user_id=NEW.twitch_user_id AND login=NEW.login AND points>=NEW.price;
  SELECT RAISE(ABORT,'insufficient_funds') WHERE changes()<>1;
  INSERT INTO transactions(twitch_user_id,login,display_name,delta,balance_after,reason,source,created_at_utc)
    SELECT twitch_user_id,login,display_name,-NEW.price,points,'Pokemon slot '||NEW.slot,
      'pokemon-slot',NEW.created_at_utc FROM accounts
    WHERE twitch_user_id=NEW.twitch_user_id AND login=NEW.login;
END;
CREATE TRIGGER IF NOT EXISTS pokemon_extra_species_insert BEFORE INSERT ON pokemon_extra_roster
BEGIN
  SELECT RAISE(ABORT,'species_taken') WHERE EXISTS(
    SELECT 1 FROM pokemon_profiles p WHERE p.pokemon_id=NEW.pokemon_id);
END;
CREATE TRIGGER IF NOT EXISTS pokemon_extra_species_update BEFORE UPDATE OF pokemon_id ON pokemon_extra_roster
BEGIN
  SELECT RAISE(ABORT,'species_taken') WHERE EXISTS(
    SELECT 1 FROM pokemon_profiles p WHERE p.pokemon_id=NEW.pokemon_id);
END;
-- Protect legacy primary rolls from assigning any newly owned extra species.
CREATE TRIGGER IF NOT EXISTS pokemon_primary_extra_guard BEFORE UPDATE OF pokemon_id ON pokemon_profiles
WHEN NEW.pokemon_id<>OLD.pokemon_id AND EXISTS(
  SELECT 1 FROM pokemon_extra_roster r WHERE r.pokemon_id=NEW.pokemon_id)
BEGIN SELECT RAISE(ABORT,'species_taken'); END;
CREATE TRIGGER IF NOT EXISTS pokemon_primary_extra_insert BEFORE INSERT ON pokemon_profiles
WHEN EXISTS(SELECT 1 FROM pokemon_extra_roster r WHERE r.pokemon_id=NEW.pokemon_id)
BEGIN SELECT RAISE(ABORT,'species_taken'); END;
CREATE TRIGGER IF NOT EXISTS pokemon_slot_roll_atomic BEFORE INSERT ON pokemon_slot_rolls
BEGIN
  SELECT RAISE(ABORT,'not_unlocked') WHERE NOT EXISTS(
    SELECT 1 FROM pokemon_slot_unlocks u WHERE u.twitch_user_id=NEW.twitch_user_id AND u.slot=NEW.slot AND u.login=NEW.login);
  SELECT RAISE(ABORT,'species_taken') WHERE EXISTS(
    SELECT 1 FROM pokemon_profiles p WHERE p.pokemon_id=NEW.pokemon_id)
    OR EXISTS(SELECT 1 FROM pokemon_extra_roster r WHERE r.pokemon_id=NEW.pokemon_id);
  SELECT RAISE(ABORT,'trade_pending') WHERE EXISTS(
    SELECT 1 FROM pokemon_trade_offers t WHERE t.status='pending' AND t.expires_at_utc>NEW.created_at_utc
      AND (t.seller_user_id=NEW.twitch_user_id OR t.buyer_user_id=NEW.twitch_user_id));
  UPDATE accounts SET points=points-NEW.price,last_write_utc=NEW.created_at_utc
    WHERE twitch_user_id=NEW.twitch_user_id AND login=NEW.login AND points>=NEW.price;
  SELECT RAISE(ABORT,'insufficient_funds') WHERE changes()<>1;
  INSERT INTO transactions(twitch_user_id,login,display_name,delta,balance_after,reason,source,created_at_utc)
    SELECT twitch_user_id,login,display_name,-NEW.price,points,'pokeroll '||NEW.pokemon_name||' slot '||NEW.slot,
      'pokemon',NEW.created_at_utc FROM accounts
    WHERE twitch_user_id=NEW.twitch_user_id AND login=NEW.login;
  INSERT INTO pokemon_extra_roster(twitch_user_id,slot,pokemon_id,pokemon_name,updated_at_utc)
    VALUES(NEW.twitch_user_id,NEW.slot,NEW.pokemon_id,NEW.pokemon_name,NEW.created_at_utc)
    ON CONFLICT(twitch_user_id,slot) DO UPDATE SET
      pokemon_id=excluded.pokemon_id,pokemon_name=excluded.pokemon_name,updated_at_utc=excluded.updated_at_utc;
END;
