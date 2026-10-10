-- The dependency doctor's fixer (src/deps.ts): which coding agent patches the
-- call sites an update broke, and how many tries it gets. NULL: nobody does.
ALTER TABLE dep_watches ADD COLUMN fix_with TEXT;
ALTER TABLE dep_watches ADD COLUMN fix_tries INTEGER NOT NULL DEFAULT 3;
