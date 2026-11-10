-- Pokemon Market. Existing duplicate species remain legal; only new rolls are unique.
CREATE TABLE IF NOT EXISTS pokemon_trade_offers (
  id TEXT PRIMARY KEY NOT NULL,
  seller_user_id TEXT NOT NULL, buyer_user_id TEXT NOT NULL,
  seller_login TEXT NOT NULL COLLATE NOCASE, buyer_login TEXT NOT NULL COLLATE NOCASE,
  seller_pokemon_id INTEGER NOT NULL, seller_pokemon_name TEXT NOT NULL,
  buyer_pokemon_id INTEGER NOT NULL, buyer_pokemon_name TEXT NOT NULL,
  price INTEGER NOT NULL CHECK(price BETWEEN 10000 AND 1000000000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','cancelled','declined','expired')),
  created_at_utc TEXT NOT NULL, expires_at_utc TEXT NOT NULL,
  responded_at_utc TEXT NOT NULL DEFAULT '',
  CHECK(seller_user_id<>buyer_user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trade_pending_seller
  ON pokemon_trade_offers(seller_user_id) WHERE status='pending';
CREATE UNIQUE INDEX IF NOT EXISTS idx_trade_pending_buyer
  ON pokemon_trade_offers(buyer_user_id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS idx_trade_pending_expiry ON pokemon_trade_offers(status,expires_at_utc);
CREATE TABLE IF NOT EXISTS pokemon_trade_history (
  offer_id TEXT NOT NULL, twitch_user_id TEXT NOT NULL,
  pokemon_id INTEGER NOT NULL CHECK(pokemon_id BETWEEN 1 AND 1025),
  pokemon_name TEXT NOT NULL, created_at_utc TEXT NOT NULL,
  PRIMARY KEY(offer_id,twitch_user_id)
);
CREATE TRIGGER IF NOT EXISTS pokemon_trade_offer_guard
BEFORE INSERT ON pokemon_trade_offers WHEN NEW.status='pending'
BEGIN
  SELECT RAISE(ABORT,'participant_busy') WHERE EXISTS (
    SELECT 1 FROM pokemon_trade_offers p WHERE p.status='pending'
      AND p.expires_at_utc>NEW.created_at_utc
      AND (p.seller_user_id IN (NEW.seller_user_id,NEW.buyer_user_id)
      OR p.buyer_user_id IN (NEW.seller_user_id,NEW.buyer_user_id))
  );
END;

-- Preserve existing duplicate species, but never generate additional duplicates.
CREATE TRIGGER IF NOT EXISTS pokemon_new_species_guard
BEFORE INSERT ON pokemon_profiles
WHEN EXISTS(SELECT 1 FROM pokemon_profiles p WHERE p.pokemon_id=NEW.pokemon_id)
BEGIN SELECT RAISE(ABORT,'species_taken'); END;
CREATE TRIGGER IF NOT EXISTS pokemon_reroll_species_guard
BEFORE UPDATE OF pokemon_id ON pokemon_profiles
WHEN NEW.pokemon_id<>OLD.pokemon_id AND EXISTS(
  SELECT 1 FROM pokemon_profiles p
    WHERE p.pokemon_id=NEW.pokemon_id AND p.twitch_user_id<>NEW.twitch_user_id
) AND NOT EXISTS (
  SELECT 1 FROM pokemon_trade_offers t WHERE t.status='pending'
    AND (
      (t.seller_user_id=NEW.twitch_user_id AND t.seller_pokemon_id=OLD.pokemon_id
       AND t.buyer_pokemon_id=NEW.pokemon_id)
      OR
      (t.buyer_user_id=NEW.twitch_user_id AND t.buyer_pokemon_id=OLD.pokemon_id
       AND t.seller_pokemon_id=NEW.pokemon_id)
    )
)
BEGIN SELECT RAISE(ABORT,'species_taken'); END;

-- The trade only succeeds if BOTH Pokémon and the buyer's YURA are still available.
-- Everything runs in the same SQLite UPDATE statement. RAISE(ABORT) reverts
-- ALL debits/credits/profile changes on any error or race.
CREATE TRIGGER IF NOT EXISTS pokemon_trade_atomic_accept
BEFORE UPDATE OF status ON pokemon_trade_offers WHEN NEW.status='accepted'
BEGIN
  SELECT RAISE(ABORT,'not_pending') WHERE OLD.status<>'pending';
  SELECT RAISE(ABORT,'expired') WHERE NEW.expires_at_utc<=strftime('%Y-%m-%dT%H:%M:%fZ','now');
  SELECT RAISE(ABORT,'seller_changed') WHERE NOT EXISTS(
    SELECT 1 FROM pokemon_profiles p WHERE p.twitch_user_id=NEW.seller_user_id
      AND p.login=NEW.seller_login AND p.pokemon_id=NEW.seller_pokemon_id
  );
  SELECT RAISE(ABORT,'buyer_changed') WHERE NOT EXISTS(
    SELECT 1 FROM pokemon_profiles p WHERE p.twitch_user_id=NEW.buyer_user_id
      AND p.login=NEW.buyer_login AND p.pokemon_id=NEW.buyer_pokemon_id
  );

  UPDATE accounts SET points=points-NEW.price,last_write_utc=NEW.responded_at_utc
    WHERE twitch_user_id=NEW.buyer_user_id AND login=NEW.buyer_login AND points>=NEW.price;
  SELECT RAISE(ABORT,'insufficient_funds') WHERE changes()<>1;

  UPDATE accounts SET points=points+NEW.price,last_write_utc=NEW.responded_at_utc
    WHERE twitch_user_id=NEW.seller_user_id AND login=NEW.seller_login;
  SELECT RAISE(ABORT,'seller_account_missing') WHERE changes()<>1;

  UPDATE pokemon_profiles SET pokemon_id=NEW.buyer_pokemon_id,pokemon_name=NEW.buyer_pokemon_name,
    avatar_mode='pokemon',updated_at_utc=NEW.responded_at_utc
    WHERE twitch_user_id=NEW.seller_user_id AND pokemon_id=NEW.seller_pokemon_id;
  SELECT RAISE(ABORT,'seller_pokemon_changed') WHERE changes()<>1;

  UPDATE pokemon_profiles SET pokemon_id=NEW.seller_pokemon_id,pokemon_name=NEW.seller_pokemon_name,
    avatar_mode='pokemon',updated_at_utc=NEW.responded_at_utc
    WHERE twitch_user_id=NEW.buyer_user_id AND pokemon_id=NEW.buyer_pokemon_id;
  SELECT RAISE(ABORT,'buyer_pokemon_changed') WHERE changes()<>1;

  INSERT INTO transactions(twitch_user_id,login,display_name,delta,balance_after,reason,source,created_at_utc)
    SELECT twitch_user_id,login,display_name,-NEW.price,points,
      'Pokemon Market: zakup '||NEW.seller_pokemon_name||' #'||NEW.id,'pokemon-trade',NEW.responded_at_utc
    FROM accounts WHERE twitch_user_id=NEW.buyer_user_id AND login=NEW.buyer_login;
  INSERT INTO transactions(twitch_user_id,login,display_name,delta,balance_after,reason,source,created_at_utc)
    SELECT twitch_user_id,login,display_name,NEW.price,points,
      'Pokemon Market: sprzedaz '||NEW.seller_pokemon_name||' #'||NEW.id,'pokemon-trade',NEW.responded_at_utc
    FROM accounts WHERE twitch_user_id=NEW.seller_user_id AND login=NEW.seller_login;

  INSERT INTO pokemon_trade_history(offer_id,twitch_user_id,pokemon_id,pokemon_name,created_at_utc)
    VALUES(NEW.id,NEW.seller_user_id,NEW.buyer_pokemon_id,NEW.buyer_pokemon_name,NEW.responded_at_utc);
  INSERT INTO pokemon_trade_history(offer_id,twitch_user_id,pokemon_id,pokemon_name,created_at_utc)
    VALUES(NEW.id,NEW.buyer_user_id,NEW.seller_pokemon_id,NEW.seller_pokemon_name,NEW.responded_at_utc);
END;
