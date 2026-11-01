-- Which parties a person has sat in (Qollab, party.ts), so deleting the account can tell each one to forget them.
-- A party is good 24 hours, so a row older than that is pruned whenever someone sits down.
-- IF NOT EXISTS: this was 0004_party_seats.sql until it shared a number with 0004_saves.sql; a database that ran it under that name keeps its table.
CREATE TABLE IF NOT EXISTS party_seats (user_id TEXT NOT NULL, code TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user_id, code));
