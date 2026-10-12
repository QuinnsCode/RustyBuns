-- The dependency doctor's preview deploys (src/deps.ts, #864): whether what passed
-- the tests is deployed as a preview, checked and torn down before it goes on the branch.
ALTER TABLE dep_watches ADD COLUMN preview INTEGER NOT NULL DEFAULT 0;
