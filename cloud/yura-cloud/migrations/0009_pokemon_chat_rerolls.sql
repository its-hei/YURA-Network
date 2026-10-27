-- v3.3.99: chat-only Pokémon system. Keep legacy 15k purchase receipts intact.
-- The new 5k rerolls have a separate immutable event-id ledger.
CREATE TABLE IF NOT EXISTS pokemon_rerolls (
  event_id TEXT PRIMARY KEY NOT NULL,
  twitch_user_id TEXT NOT NULL,
  login TEXT NOT NULL COLLATE NOCASE,
  pokemon_id INTEGER NOT NULL CHECK(pokemon_id BETWEEN 1 AND 1025),
  pokemon_name TEXT NOT NULL,
  price INTEGER NOT NULL CHECK(price=5000),
  created_at_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pokemon_rerolls_user ON pokemon_rerolls(twitch_user_id);
