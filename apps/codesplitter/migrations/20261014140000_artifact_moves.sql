-- Moving the Artifacts namespace off codesplitters (#823): each repo copied into the new namespace, and the remote it got there.
-- POST /api/admin/artifacts/rewrite swaps these into repos.artifact_remote and crew_remote once the binding points at the new one.
CREATE TABLE artifact_moves (name TEXT PRIMARY KEY, remote TEXT NOT NULL, moved_at INTEGER NOT NULL);
