-- What each shared line said when it was shared, beside its id, so a line moved since (a delete and an insert: a new id)
-- is still found by its text (shares.ts).
ALTER TABLE shares ADD COLUMN texts TEXT;
