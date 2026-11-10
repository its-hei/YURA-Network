"""Regression checks for the exact production Pokémon Market D1 migration."""
import sqlite3
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

MIGRATION = Path(__file__).resolve().parents[1] / "migrations" / "0013_pokemon_market.sql"
BASE = """
CREATE TABLE pokemon_profiles(
  twitch_user_id TEXT PRIMARY KEY,login TEXT UNIQUE COLLATE NOCASE,
  avatar_mode TEXT NOT NULL DEFAULT 'pokemon',pokemon_id INTEGER NOT NULL,
  pokemon_name TEXT NOT NULL,updated_at_utc TEXT NOT NULL);
CREATE TABLE accounts(
  login TEXT PRIMARY KEY COLLATE NOCASE,twitch_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,points INTEGER NOT NULL,last_write_utc TEXT NOT NULL);
CREATE TABLE transactions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,twitch_user_id TEXT NOT NULL,
  login TEXT NOT NULL,display_name TEXT NOT NULL,delta INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,reason TEXT NOT NULL,source TEXT NOT NULL,
  created_at_utc TEXT NOT NULL);
"""

def iso(minutes=0):
    return ((datetime.now(timezone.utc) + timedelta(minutes=minutes))
            .isoformat(timespec="milliseconds").replace("+00:00", "Z"))

class MarketSafety(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.executescript(BASE)
        self.people = [("101","humi",94,"Gengar",200),("202","senviasty",6,"Charizard",50000)]
        for uid,login,pokemon_id,pokemon_name,balance in self.people:
            self.db.execute("INSERT INTO pokemon_profiles VALUES(?,?,'pokemon',?,?,?)",
                            (uid,login,pokemon_id,pokemon_name,iso()))
            self.db.execute("INSERT INTO accounts VALUES(?,?,?,?,?)",
                            (login,uid,login,balance,iso()))
        self.db.executescript(MIGRATION.read_text(encoding="utf-8"))

    def offer(self,price=10000,expires=5,ident="trade-1"):
        self.db.execute("""INSERT INTO pokemon_trade_offers
          (id,seller_user_id,buyer_user_id,seller_login,buyer_login,
           seller_pokemon_id,seller_pokemon_name,buyer_pokemon_id,buyer_pokemon_name,
           price,status,created_at_utc,expires_at_utc)
          VALUES(?,?,?,?,?,?,?,?,?,?,'pending',?,?)""",
          (ident,"101","202","humi","senviasty",94,"Gengar",6,"Charizard",
           price,iso(),iso(expires)))
    def accept(self):
        return self.db.execute("""UPDATE pokemon_trade_offers
          SET status='accepted',responded_at_utc=?
          WHERE id='trade-1' AND buyer_user_id='202' AND status='pending'
            AND expires_at_utc>?""",(iso(),iso())).rowcount
    def snapshot(self):
        return (
          tuple(self.db.execute("SELECT login,points FROM accounts ORDER BY login")),
          tuple(self.db.execute("SELECT twitch_user_id,pokemon_id FROM pokemon_profiles ORDER BY twitch_user_id")),
          tuple(self.db.execute("SELECT status FROM pokemon_trade_offers ORDER BY id")),
          self.db.execute("SELECT count(*) FROM transactions").fetchone()[0],
          self.db.execute("SELECT count(*) FROM pokemon_trade_history").fetchone()[0]
        )

    def test_atomic_exchange_and_exactly_one_charge(self):
        self.offer()
        self.assertEqual(self.accept(),1)
        balance,pokemon,status,audit,history=self.snapshot()
        self.assertEqual(balance,(("humi",10200),("senviasty",40000)))
        self.assertEqual(pokemon,(("101",6),("202",94)))
        self.assertEqual(status,(("accepted",),))
        self.assertEqual((audit,history),(2,2))
        self.assertEqual(self.accept(),0)
        self.assertEqual(self.snapshot(),(balance,pokemon,status,audit,history))

    def test_insufficient_balance_rolls_everything_back(self):
        self.offer()
        self.db.execute("UPDATE accounts SET points=9999 WHERE twitch_user_id='202'")
        before=self.snapshot()
        with self.assertRaises(sqlite3.IntegrityError):
            self.accept()
        self.assertEqual(self.snapshot(),before)

    def test_stale_pokemon_aborts_with_no_charge(self):
        self.offer()
        self.db.execute("UPDATE pokemon_profiles SET pokemon_id=25,pokemon_name='Pikachu' WHERE twitch_user_id='101'")
        before=self.snapshot()
        with self.assertRaises(sqlite3.IntegrityError):
            self.accept()
        self.assertEqual(self.snapshot(),before)

    def test_expired_offer_never_executes(self):
        self.offer(expires=-1)
        before=self.snapshot()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE pokemon_trade_offers SET status='accepted',responded_at_utc=? WHERE id='trade-1'",
                            (iso(),))
        self.assertEqual(self.snapshot(),before)

    def test_cancelled_offer_and_double_accept_cannot_spend(self):
        self.offer()
        self.db.execute("UPDATE pokemon_trade_offers SET status='cancelled' WHERE id='trade-1'")
        before=self.snapshot()
        self.assertEqual(self.accept(),0)
        self.assertEqual(self.snapshot(),before)

    def test_legacy_duplicate_preserved_but_new_duplicate_rejected(self):
        # Existing duplicates are unchanged; no extra owner can receive the same species.
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO pokemon_profiles VALUES('303','third','pokemon',94,'Gengar',?)",(iso(),))
        self.assertEqual(self.db.execute("SELECT count(*) FROM pokemon_profiles WHERE pokemon_id=94").fetchone()[0],1)

    def test_trainer_cannot_join_two_open_offers(self):
        self.offer()
        self.db.execute("INSERT INTO pokemon_profiles VALUES('303','third','pokemon',25,'Pikachu',?)",(iso(),))
        self.db.execute("INSERT INTO accounts VALUES('third','303','third',50000,?)",(iso(),))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("""INSERT INTO pokemon_trade_offers
              (id,seller_user_id,buyer_user_id,seller_login,buyer_login,
               seller_pokemon_id,seller_pokemon_name,buyer_pokemon_id,buyer_pokemon_name,
               price,status,created_at_utc,expires_at_utc)
              VALUES('trade-2','303','202','third','senviasty',25,'Pikachu',
                     6,'Charizard',10000,'pending',?,?)""",(iso(),iso(5)))

if __name__ == "__main__":
    unittest.main()
