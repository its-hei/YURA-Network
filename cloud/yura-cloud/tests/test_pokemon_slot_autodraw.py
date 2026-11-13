"""Regression: slot purchase + automatic Pokémon assignment is one atomic D1 statement."""
import sqlite3
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
BASE="""
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
NOW="2026-11-13T17:00:00.000Z"

class SlotAutoDrawSafety(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript(BASE)
        self.db.execute("INSERT INTO pokemon_profiles VALUES('101','humi','pokemon',94,'Gengar',?)",(NOW,))
        self.db.execute("INSERT INTO accounts VALUES('humi','101','Humi',1000000,?)",(NOW,))
        for version in ("0013_pokemon_market.sql","0014_pokemon_slots.sql"):
            self.db.executescript((ROOT/"migrations"/version).read_text(encoding="utf-8"))
        # An old paid place with its own Pokémon must remain unchanged by the migration.
        self.db.execute("""INSERT INTO pokemon_slot_unlocks(twitch_user_id,slot,login,event_id,price,created_at_utc)
          VALUES('101',2,'humi','old-2',30000,?)""",(NOW,))
        self.db.execute("""INSERT INTO pokemon_extra_roster(twitch_user_id,slot,pokemon_id,pokemon_name,updated_at_utc)
          VALUES('101',2,6,'Charizard',?)""",(NOW,))
        self.db.executescript((ROOT/"migrations"/"0015_pokemon_slot_auto_draw.sql").read_text(encoding="utf-8"))

    def buy(self,slot,price,ident,pid,name):
        self.db.execute("""INSERT INTO pokemon_slot_unlocks
          (twitch_user_id,slot,login,event_id,price,created_at_utc,pokemon_id,pokemon_name)
          VALUES('101',?,'humi',?,?,?,?,?)""",(slot,ident,price,NOW,pid,name))

    def snapshot(self):
        return (
            self.db.execute("SELECT points FROM accounts WHERE twitch_user_id='101'").fetchone()[0],
            tuple(self.db.execute("SELECT slot,pokemon_id FROM pokemon_extra_roster ORDER BY slot")),
            tuple(self.db.execute("SELECT slot FROM pokemon_slot_unlocks ORDER BY slot")),
            self.db.execute("SELECT count(*) FROM transactions").fetchone()[0]
        )

    def test_migration_preserves_existing_roster_and_one_charge(self):
        self.assertEqual(self.snapshot(),(970000,((2,6),),((2,),),1))
        self.buy(3,120000,"buy-3",25,"Pikachu")
        self.assertEqual(self.snapshot(),(850000,((2,6),(3,25)),((2,),(3,)),2))
        self.assertEqual(self.db.execute("SELECT pokemon_id FROM pokemon_profiles WHERE twitch_user_id='101'").fetchone()[0],94)

    def test_purchase_without_species_is_rejected_without_charging(self):
        before=self.snapshot()
        with self.assertRaises(sqlite3.IntegrityError):
            self.buy(3,120000,"no-draw",None,None)
        self.assertEqual(self.snapshot(),before)
        with self.assertRaises(sqlite3.IntegrityError):
            self.buy(3,120000,"blank",27,"")
        self.assertEqual(self.snapshot(),before)

    def test_duplicate_species_rolls_back_debit_and_slot(self):
        before=self.snapshot()
        with self.assertRaises(sqlite3.IntegrityError):
            self.buy(3,120000,"duplicate-extra",6,"Charizard")
        self.assertEqual(self.snapshot(),before)
        with self.assertRaises(sqlite3.IntegrityError):
            self.buy(3,120000,"duplicate-primary",94,"Gengar")
        self.assertEqual(self.snapshot(),before)

    def test_insufficient_funds_does_not_create_empty_slot(self):
        self.db.execute("UPDATE accounts SET points=5000 WHERE twitch_user_id='101'")
        before=self.snapshot()
        with self.assertRaises(sqlite3.IntegrityError):
            self.buy(3,120000,"poor",25,"Pikachu")
        self.assertEqual(self.snapshot(),before)

    def test_double_purchase_cannot_charge_twice(self):
        self.buy(3,120000,"buy-3",25,"Pikachu")
        before=self.snapshot()
        with self.assertRaises(sqlite3.IntegrityError):
            self.buy(3,120000,"repeat",30,"Nidorina")
        self.assertEqual(self.snapshot(),before)

    def test_new_slot_can_be_rerolled_after_purchase(self):
        self.buy(3,120000,"buy-3",25,"Pikachu")
        self.db.execute("""INSERT INTO pokemon_slot_rolls
          (event_id,twitch_user_id,login,slot,pokemon_id,pokemon_name,price,created_at_utc)
          VALUES('reroll-1','101','humi',3,30,'Nidorina',5000,?)""",(NOW,))
        self.assertEqual(self.snapshot(),(845000,((2,6),(3,30)),((2,),(3,)),3))

if __name__=="__main__":
    unittest.main()
