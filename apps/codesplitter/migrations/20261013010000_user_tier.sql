-- A paid tier, named for a gem (tiers.ts): stamped next to the name, and a bigger share of the per-person rate limits.
ALTER TABLE users ADD COLUMN tier TEXT;
