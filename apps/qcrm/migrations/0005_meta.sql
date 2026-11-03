-- Per-install settings. The desktop app keeps its random session secret here (src/worker.tsx); the edge never writes it.
-- Was 0003_meta.sql, which shared its number with 0003_oauth.sql (#3120). Migrations are tracked by file name, so a
-- database that ran the old name runs this one again: IF NOT EXISTS makes that a no-op.
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
