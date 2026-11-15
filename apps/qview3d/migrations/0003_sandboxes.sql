-- Sandboxes (src/sandboxes.ts): a test shop the owner hands someone ends at `expires` (ms since 1970). NULL: never.
ALTER TABLE orgs ADD COLUMN expires INTEGER;
