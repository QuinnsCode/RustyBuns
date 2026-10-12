-- What a hosted deploy may run with the owner's keys (#646): commits on the remote it
-- clones that the owner made alone ('own'), or that they approved after reading the
-- diff ('approved', which clears everything before it too). Anything else waits.
CREATE TABLE deploy_cleared (
  owner TEXT NOT NULL, repo TEXT NOT NULL, sha TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('own', 'approved')),
  at INTEGER NOT NULL,
  PRIMARY KEY (owner, repo, sha)
);
