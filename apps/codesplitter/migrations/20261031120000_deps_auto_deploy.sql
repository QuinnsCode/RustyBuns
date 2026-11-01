-- The dependency doctor's opt-in auto-deploy (src/deps.ts, #3079): ship what passed the tests and a preview.
ALTER TABLE dep_watches ADD COLUMN auto_deploy INTEGER NOT NULL DEFAULT 0;
