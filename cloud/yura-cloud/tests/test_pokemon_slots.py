"""Safety regression checks for permanent Pokémon places and named rerolls."""
import sqlite3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = """
CREATE TABLE pokemon_profiles(twitch_user_id TEXT PRIMARY KEY,login TEXT UNIQUE COLLATE NOCASE,
 avatar_mode TEXT NOT NULL DEFAULT 'pokemon',pokemon_id INTEGER NOT NULL,
 pokemon_name TEXT NOT NULL,updated_at_utc TEXT NOT NULL);
CREATE TABLE accounts(login TEXT PRIMARY KEY COLLATE NOCASE,twitch_user_id TEXT NOT NULL,
 display_name TEXT NOT NULL,points INTEGER NOT NULL,last_write_utc TEXT NOT NULL);
CREATE TABLE transactions(id INTEGER PRIMARY KEY AUTOINCREMENT,twitch_user_id TEXT NOT NULL,
 login TEXT NOT NULL,display_name TEXT NOT NULL,delta INTEGER NOT NULL,
 balance_after INTEGER NOT NULL,reason TEXT NOT NULL,source TEXT NOT NULL,
 created_at_utc TEXT NOT NULL);
"""

class PokemonSlotsSafety(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript(BASE)
        self.db.execute("INSERT INTO pokemon_profiles VALUES('101','humi','pokemon',94,'Gengar','2026-11-13T00:00:00Z')")
        self.db.execute("INSERT INTO accounts VALUES('humi','101','Humi',1000000,'2026-11-13T00:00:00Z')")
        for version in ("0013_pokemon_market.sql","0014_pokemon_slots.sql"):
            self.db.executescript((ROOT/"migrations"/version).read_text(encoding="utf-8"))

    def buy(self,slot,price,event):
        return self.db.execute("""INSERT INTO pokemon_slot_unlocks
         (twitch_user_id,slot,login,event_id,price,created_at_utc)
         VALUES('101',?,?,?,?, '2026-11-13T00:00:01Z')""",(slot,"humi",event,price))
    def roll(self,event,slot,pid,name):
        return self.db.execute("""INSERT INTO pokemon_slot_rolls
        (event_id,twitch_user_id,login,slot,pokemon_id,pokemon_name,price,created_at_utc)
        VALUES(?,'101','humi',?,?,?,5000,'2026-11-13T00:00:02Z')""",(event,slot,pid,name))
    def points(self):
        return self.db.execute("SELECT points FROM accounts WHERE login='humi'").fetchone()[0]
    def count_audit(self):
        return self.db.execute("SELECT count(*) FROM transactions").fetchone()[0]

    def test_all_four_slots_cost_exactly_800k_and_are_permanent(self):
        for slot,price in [(2,30000),(3,120000),(4,250000),(5,400000)]:
            self.buy(slot,price,"buy-"+str(slot))
        self.assertEqual(self.points(),200000)
        self.assertEqual(self.count_audit(),4)
        with self.assertRaises(sqlite3.IntegrityError):
            self.buy(5,400000,"buy-repeat")
        self.assertEqual(self.points(),200000)

    def test_cannot_skip_slot_or_forge_low_price(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.buy(4,250000,"skip")
        with self.assertRaises(sqlite3.IntegrityError):
            self.buy(2,1,"cheap")
        self.assertEqual(self.points(),1000000)
        self.assertEqual(self.count_audit(),0)

    def test_extra_roll_replaces_only_selected_extra_place(self):
        self.buy(2,30000,"buy-2")
        self.roll("roll-2",2,6,"Charizard")
        self.assertEqual(self.points(),965000)
        self.roll("roll-3",2,25,"Pikachu")
        self.assertEqual(self.points(),960000)
        self.assertEqual(self.db.execute("SELECT pokemon_id FROM pokemon_profiles WHERE twitch_user_id='101'").fetchone()[0],94)
        self.assertEqual(self.db.execute("SELECT pokemon_id FROM pokemon_extra_roster WHERE twitch_user_id='101'").fetchone()[0],25)
        self.assertEqual(self.count_audit(),3)

    def test_duplicate_event_and_unowned_slot_never_charge(self):
        self.buy(2,30000,"buy-2")
        with self.assertRaises(sqlite3.IntegrityError):
            self.roll("bad-roll",3,25,"Pikachu")
        self.roll("roll-2",2,6,"Charizard")
        before=(self.points(),self.count_audit())
        with self.assertRaises(sqlite3.IntegrityError):
            self.roll("roll-2",2,25,"Pikachu")
        self.assertEqual((self.points(),self.count_audit()),before)

    def test_global_species_uniqueness_prevents_duplicate_charges(self):
        self.buy(2,30000,"buy-2")
        before=(self.points(),self.count_audit())
        with self.assertRaises(sqlite3.IntegrityError):
            self.roll("duplicate",2,94,"Gengar")
        self.assertEqual((self.points(),self.count_audit()),before)
        self.roll("valid",2,6,"Charizard")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO pokemon_profiles VALUES('202','other','pokemon',6,'Charizard','2026-11-13T00:00:00Z')")

    def test_insufficient_funds_rolls_back_everything(self):
        self.db.execute("UPDATE accounts SET points=1000 WHERE login='humi'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.buy(2,30000,"no-money")
        self.assertEqual(self.count_audit(),0)
        self.db.execute("UPDATE accounts SET points=30000 WHERE login='humi'")
        self.buy(2,30000,"buy-2")
        with self.assertRaises(sqlite3.IntegrityError):
            self.roll("no-roll-money",2,6,"Charizard")
        self.assertEqual(self.points(),0)
        self.assertEqual(self.count_audit(),1)
        self.assertEqual(self.db.execute("SELECT count(*) FROM pokemon_extra_roster").fetchone()[0],0)

if __name__=="__main__":
    unittest.main()
