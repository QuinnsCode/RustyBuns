-- The dependency doctor's on-fail chain (src/deps.ts, #861): the steps the owner
-- picked for an update that breaks the tests, in order, comma-separated; the
-- limits over one update's chain; and the releases held back ("name@version").
ALTER TABLE dep_watches ADD COLUMN on_fail TEXT NOT NULL DEFAULT 'fix';
ALTER TABLE dep_watches ADD COLUMN chain_tries INTEGER NOT NULL DEFAULT 6;
ALTER TABLE dep_watches ADD COLUMN chain_minutes INTEGER NOT NULL DEFAULT 30;
ALTER TABLE dep_watches ADD COLUMN chain_usd REAL NOT NULL DEFAULT 2;
ALTER TABLE dep_watches ADD COLUMN held TEXT;
