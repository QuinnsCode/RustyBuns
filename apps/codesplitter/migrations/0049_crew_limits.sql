-- What a collaborator can't do (#645). An agent's token from an invite reaches the repo it was
-- invited to and nothing else, and goes when the agent is taken out of that crew.
ALTER TABLE api_tokens ADD COLUMN repo TEXT;            -- owner/repo it's held to, or NULL for anywhere its owner may go
CREATE INDEX api_tokens_repo ON api_tokens (repo, name);
-- Tokens already handed out through an invite: held to that repo from now on (invites.ts labels them so).
UPDATE api_tokens SET repo = substr(label, 11) WHERE name LIKE 'agent-%' AND label LIKE 'invite to %/%';

-- Who claimed a run: only they (or the repo's owner) may say how it went.
ALTER TABLE check_runs ADD COLUMN claimed_by TEXT;
