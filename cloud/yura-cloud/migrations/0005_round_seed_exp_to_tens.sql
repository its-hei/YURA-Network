-- Normalize the two existing YURA EXP seed totals to full tens.
-- Requested before final EXP gain rules are locked.
UPDATE accounts
SET
  exp = CAST((MAX(0, exp) + 5) / 10 AS INTEGER) * 10,
  exp_stream = CAST((MAX(0, exp_stream) + 5) / 10 AS INTEGER) * 10,
  last_write_utc = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE lower(login) IN ('neverblameme', 'wielki_gekon_expiciel');
