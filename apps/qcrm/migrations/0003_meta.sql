-- Per-install settings. The desktop app keeps its random session secret here (src/worker.tsx); the edge never writes it.
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
