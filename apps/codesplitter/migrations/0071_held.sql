-- Who holds lines in which file of main (src/file-do.ts, #927): a row per claim that keeps
-- others off (not intents), kept by the file's DO as claims are laid and let go. The DO is
-- the truth; this is only so the Worker can refuse `claim_lines {wait}` to someone holding
-- lines in another file (no cross-file hold-and-wait, so no deadlock). A row whose claim
-- has gone is dropped when the Worker finds so.
CREATE TABLE held (
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  path TEXT NOT NULL,
  id TEXT NOT NULL,
  who TEXT NOT NULL,
  PRIMARY KEY (owner, repo, path, id)
);
CREATE INDEX held_who ON held (who);
