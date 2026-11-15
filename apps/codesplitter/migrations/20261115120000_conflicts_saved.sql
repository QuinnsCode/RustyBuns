-- Conflicts Mervin saved: work that, one PR at a time, would have been a merge conflict someone fought by hand.
-- One row per hour and kind ("do-save": a stale line edit word-merged on save; "branch-merge": a stretch both sides
-- changed, settled with no card). Written by ConflictSavedCounter off the hot path; read by GET /api/stats/saved.
CREATE TABLE IF NOT EXISTS conflicts_saved (
  hour INTEGER NOT NULL,
  kind TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (hour, kind)
);
