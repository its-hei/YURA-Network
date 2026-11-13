-- Pokémon slot purchases now automatically assign a free species in the SAME D1 transaction.
-- Existing purchases and roster entries remain intact (nullable columns preserve legacy rows).
ALTER TABLE pokemon_slot_unlocks ADD COLUMN pokemon_id INTEGER;
ALTER TABLE pokemon_slot_unlocks ADD COLUMN pokemon_name TEXT;

CREATE TRIGGER IF NOT EXISTS pokemon_slot_purchase_requires_species
BEFORE INSERT ON pokemon_slot_unlocks
BEGIN
  SELECT RAISE(ABORT,'pokemon_required') WHERE NEW.pokemon_id IS NULL OR NEW.pokemon_name IS NULL
    OR LENGTH(TRIM(NEW.pokemon_name))=0
    OR NEW.pokemon_id NOT BETWEEN 1 AND 1025;
  SELECT RAISE(ABORT,'species_taken') WHERE EXISTS(
    SELECT 1 FROM pokemon_profiles WHERE pokemon_id=NEW.pokemon_id)
    OR EXISTS(SELECT 1 FROM pokemon_extra_roster WHERE pokemon_id=NEW.pokemon_id);
END;

-- The previous BEFORE INSERT trigger debits the slot price. This AFTER INSERT
-- trigger adds the chosen Pokémon to its newly unlocked slot. An error from
-- either trigger aborts the whole statement, including money and audit writes.
CREATE TRIGGER IF NOT EXISTS pokemon_slot_purchase_assign_species
AFTER INSERT ON pokemon_slot_unlocks
BEGIN
  INSERT INTO pokemon_extra_roster(twitch_user_id,slot,pokemon_id,pokemon_name,updated_at_utc)
    VALUES(NEW.twitch_user_id,NEW.slot,NEW.pokemon_id,NEW.pokemon_name,NEW.created_at_utc);
END;
