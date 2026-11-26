-- Which token an audit row's request signed in with (src/audit.ts, #5590): `via` says token or oauth, this says
-- which one, by its id (api_tokens.id; an OAuth grant's tokens are rows there too). A self-request made inside a
-- token's request (edit.ts) carries the outer token's. NULL for a cookie, a job without a token, an invite, a push.
ALTER TABLE audit ADD COLUMN token TEXT;
