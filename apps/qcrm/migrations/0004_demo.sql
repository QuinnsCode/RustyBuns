-- Demo sessions handed out, by a salted hash of the visitor's IP: each gets a few a day (src/demo.ts).
CREATE TABLE demo_visits (ip_hash TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX demo_visits_ip_at ON demo_visits (ip_hash, at);
