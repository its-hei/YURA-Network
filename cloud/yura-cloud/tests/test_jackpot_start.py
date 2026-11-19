"""Regression: opening a funded Jackpot must not depend on D1 changes."""
import json
import pathlib
import re
import sqlite3
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "src/index.ts").read_text(encoding="utf-8")
START = SOURCE.index("    const state:YuraRaffleState={active:true,mode:\"jackpot\"")
END = SOURCE.index("    await tryEnterCloudCommandCooldown(env,JACKPOT_START_COOLDOWN_KEY", START)
BLOCK = SOURCE[START:END]
SQL = re.findall(r"env\.DB\.prepare\(`([^`]+)`\)", BLOCK)[:3]
CREATED = "2026-11-19T18:00:00.000Z"
ENDS = "2026-11-19T18:01:00.000Z"

class JackpotStart(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.addCleanup(self.db.close)
        for migration in ("0001_initial.sql", "0006_raffle_escrow.sql"):
            self.db.executescript((ROOT / "migrations" / migration).read_text(encoding="utf-8"))
        for login, points in (("hei", 21015), ("viewer", 4000), ("poor", 100)):
            self.db.execute("INSERT INTO accounts(login,points,created_at_utc,last_write_utc) VALUES(?,?,?,?)",
                            (login, points, CREATED, CREATED))
        self.db.commit()

    def start(self, login="hei", stake=2000):
        state = json.dumps({"active": True, "mode": "jackpot", "prize": stake})
        with self.db:
            self.db.execute(SQL[0], (stake, ENDS, CREATED))
            before = self.db.total_changes
            self.db.execute(SQL[1], (login, "123", login, stake, CREATED, ENDS))
            self.assertEqual(self.db.total_changes - before, 3)
            self.db.execute(SQL[2], (state, stake, CREATED, ENDS))

    def points(self, login):
        return self.db.execute("SELECT points FROM accounts WHERE login=?", (login,)).fetchone()[0]

    def count(self, table):
        return self.db.execute("SELECT COUNT(*) FROM " + table).fetchone()[0]

    def state(self):
        return json.loads(self.db.execute("SELECT value FROM meta WHERE key='yura_raffle_state_json'").fetchone()[0])

    def test_funded_start_and_duplicate(self):
        self.assertNotIn("meta?.changes", BLOCK)
        self.start()
        sid = self.state()["jackpotId"]
        self.assertEqual(self.db.execute("SELECT id FROM jackpot_sessions").fetchone()[0], sid)
        self.assertEqual(self.points("hei"), 19015)
        self.assertEqual(self.count("jackpot_entries"), 1)
        self.assertEqual(self.count("transactions"), 1)
        with self.assertRaises(sqlite3.IntegrityError):
            self.start("viewer")
        self.assertEqual(self.points("viewer"), 4000)
        self.assertEqual(self.count("jackpot_sessions"), 1)

    def test_insufficient_balance_rolls_back_everything(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.start("poor")
        self.assertEqual(self.points("poor"), 100)
        for table in ("jackpot_sessions", "jackpot_entries", "transactions", "meta"):
            self.assertEqual(self.count(table), 0)

    def test_state_write_error_rolls_back_debit(self):
        self.db.execute("CREATE TRIGGER fail_state BEFORE INSERT ON meta BEGIN SELECT RAISE(ABORT,'state write failed'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            self.start()
        self.assertEqual(self.points("hei"), 21015)
        for table in ("jackpot_sessions", "jackpot_entries", "transactions"):
            self.assertEqual(self.count(table), 0)

    def test_cancel_refunds_exactly_once(self):
        self.start()
        sid = self.state()["jackpotId"]
        with self.db:
            self.db.execute("UPDATE jackpot_sessions SET status='refunding' WHERE id=?", (sid,))
            statement = "INSERT OR IGNORE INTO jackpot_refunds(session_id,login,twitch_user_id,display_name,amount,created_at_utc) VALUES(?,?,?,?,?,?)"
            for _ in range(2):
                self.db.execute(statement, (sid,"hei","123","hei",2000,ENDS))
            self.db.execute("UPDATE jackpot_sessions SET status='refunded' WHERE id=?", (sid,))
        self.assertEqual(self.points("hei"), 21015)
        self.assertEqual(self.count("jackpot_refunds"), 1)
        self.assertEqual(self.count("transactions"), 2)

    def test_two_participants_payout_exactly_once(self):
        self.start()
        sid = self.state()["jackpotId"]
        with self.db:
            self.db.execute("INSERT INTO jackpot_entries VALUES(?,?,?,?,?,?)", (sid,"viewer","456","viewer",2000,CREATED))
            self.db.execute("UPDATE jackpot_sessions SET status='settling' WHERE id=?", (sid,))
            for _ in range(2):
                self.db.execute("INSERT OR IGNORE INTO jackpot_payouts VALUES(?,?,?,?,?,?)", (sid,"viewer","456","viewer",4000,ENDS))
            self.db.execute("UPDATE jackpot_sessions SET status='paid' WHERE id=?", (sid,))
        self.assertEqual(self.points("hei"), 19015)
        self.assertEqual(self.points("viewer"), 6000)
        self.assertEqual(self.count("jackpot_payouts"), 1)
        self.assertEqual(self.count("transactions"), 3)

if __name__ == "__main__":
    unittest.main()
