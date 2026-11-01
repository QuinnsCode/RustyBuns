-- Which parties a person has sat in (Qollab, party.ts), so deleting the account can tell each one to forget them.
-- A party is good 24 hours, so a row older than that is pruned whenever someone sits down.
CREATE TABLE party_seats (user_id TEXT NOT NULL, code TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user_id, code));
