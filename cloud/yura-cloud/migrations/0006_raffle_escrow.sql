-- v3.3.90: jackpot escrow and exactly-once raffle awards.
-- Do not pay out using read-modify-write. D1 triggers make the debit / credit / ledger atomic.
CREATE TABLE IF NOT EXISTS jackpot_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stake INTEGER NOT NULL CHECK(stake BETWEEN 1 AND 1000000),
  ends_at_utc TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','settling','refunding','paid','refunded')),
  created_at_utc TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_jackpot ON jackpot_sessions(status) WHERE status='open';
CREATE TABLE IF NOT EXISTS jackpot_entries (
  session_id INTEGER NOT NULL REFERENCES jackpot_sessions(id),
  login TEXT NOT NULL COLLATE NOCASE,
  twitch_user_id TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL,
  stake INTEGER NOT NULL CHECK(stake > 0),
  joined_at_utc TEXT NOT NULL,
  PRIMARY KEY(session_id,login)
);
CREATE TRIGGER IF NOT EXISTS jackpot_join_guard BEFORE INSERT ON jackpot_entries
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM jackpot_sessions
       WHERE id=NEW.session_id AND status='open' AND ends_at_utc>NEW.joined_at_utc AND stake=NEW.stake)
       THEN RAISE(ABORT,'jackpot not open') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM accounts WHERE login=NEW.login AND points>=NEW.stake)
       THEN RAISE(ABORT,'insufficient points') END;
END;
CREATE TRIGGER IF NOT EXISTS jackpot_join_debit AFTER INSERT ON jackpot_entries
BEGIN
  UPDATE accounts SET points=points-NEW.stake,last_write_utc=NEW.joined_at_utc WHERE login=NEW.login;
  INSERT INTO transactions(twitch_user_id,login,display_name,delta,balance_after,reason,source,created_at_utc)
  SELECT NEW.twitch_user_id,NEW.login,NEW.display_name,-NEW.stake,points,
    'Jackpot entry #'||NEW.session_id,'jackpot',NEW.joined_at_utc FROM accounts WHERE login=NEW.login;
END;
CREATE TABLE IF NOT EXISTS jackpot_payouts (
  session_id INTEGER PRIMARY KEY REFERENCES jackpot_sessions(id),
  login TEXT NOT NULL COLLATE NOCASE,
  twitch_user_id TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK(amount>0),
  created_at_utc TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS jackpot_payout_guard BEFORE INSERT ON jackpot_payouts
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM jackpot_sessions WHERE id=NEW.session_id AND status='settling')
       THEN RAISE(ABORT,'jackpot not settling') END;
  SELECT CASE WHEN (SELECT COALESCE(SUM(stake),0) FROM jackpot_entries WHERE session_id=NEW.session_id)<>NEW.amount
       THEN RAISE(ABORT,'jackpot pool mismatch') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM jackpot_entries WHERE session_id=NEW.session_id AND login=NEW.login)
       THEN RAISE(ABORT,'winner must be a paid participant') END;
END;
CREATE TRIGGER IF NOT EXISTS jackpot_payout_credit AFTER INSERT ON jackpot_payouts
BEGIN
  UPDATE accounts SET points=points+NEW.amount,last_write_utc=NEW.created_at_utc WHERE login=NEW.login;
  INSERT INTO transactions(twitch_user_id,login,display_name,delta,balance_after,reason,source,created_at_utc)
  SELECT NEW.twitch_user_id,NEW.login,NEW.display_name,NEW.amount,points,
    'Jackpot win #'||NEW.session_id,'jackpot',NEW.created_at_utc FROM accounts WHERE login=NEW.login;
END;
CREATE TABLE IF NOT EXISTS jackpot_refunds (
  session_id INTEGER NOT NULL REFERENCES jackpot_sessions(id),
  login TEXT NOT NULL COLLATE NOCASE,
  twitch_user_id TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK(amount>0),
  created_at_utc TEXT NOT NULL,
  PRIMARY KEY(session_id,login)
);
CREATE TRIGGER IF NOT EXISTS jackpot_refund_guard BEFORE INSERT ON jackpot_refunds
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM jackpot_sessions WHERE id=NEW.session_id AND status='refunding')
       THEN RAISE(ABORT,'jackpot not refunding') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM jackpot_entries WHERE session_id=NEW.session_id AND login=NEW.login AND stake=NEW.amount)
       THEN RAISE(ABORT,'invalid jackpot refund') END;
END;
CREATE TRIGGER IF NOT EXISTS jackpot_refund_credit AFTER INSERT ON jackpot_refunds
BEGIN
  UPDATE accounts SET points=points+NEW.amount,last_write_utc=NEW.created_at_utc WHERE login=NEW.login;
  INSERT INTO transactions(twitch_user_id,login,display_name,delta,balance_after,reason,source,created_at_utc)
  SELECT NEW.twitch_user_id,NEW.login,NEW.display_name,NEW.amount,points,
    'Jackpot refund #'||NEW.session_id,'jackpot',NEW.created_at_utc FROM accounts WHERE login=NEW.login;
END;
-- Unique (raffle, rank) means retries can never award rank twice.
CREATE TABLE IF NOT EXISTS raffle_auto_awards (
  raffle_id TEXT NOT NULL,
  rank INTEGER NOT NULL CHECK(rank IN (1,2,3)),
  login TEXT NOT NULL COLLATE NOCASE,
  twitch_user_id TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK(amount>=0),
  created_at_utc TEXT NOT NULL,
  PRIMARY KEY(raffle_id,rank),
  UNIQUE(raffle_id,login)
);
CREATE TRIGGER IF NOT EXISTS raffle_auto_award_credit AFTER INSERT ON raffle_auto_awards
BEGIN
  UPDATE accounts SET points=points+NEW.amount,last_write_utc=NEW.created_at_utc WHERE login=NEW.login;
  INSERT INTO transactions(twitch_user_id,login,display_name,delta,balance_after,reason,source,created_at_utc)
  SELECT NEW.twitch_user_id,NEW.login,NEW.display_name,NEW.amount,points,
    'Auto-raffle #'||NEW.raffle_id||' rank '||NEW.rank,'raffle',NEW.created_at_utc FROM accounts WHERE login=NEW.login;
END;
