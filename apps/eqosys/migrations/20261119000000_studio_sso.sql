-- Company sign-in (sso.ts, #4793): a studio's owner connects the company's own OpenID provider. Anyone whose work email is on
-- `domain` signs in through it and lands in the studio as `role`. `secret` is the client secret sealed with BETTER_AUTH_SECRET
-- (which varlock brings in at deploy), never the secret itself; null for a provider that takes PKCE alone. One studio a domain.
CREATE TABLE studio_sso (studio_id TEXT PRIMARY KEY, issuer TEXT NOT NULL, client_id TEXT NOT NULL, secret TEXT, domain TEXT NOT NULL UNIQUE, role TEXT NOT NULL, at INTEGER NOT NULL);
-- One company sign-in in flight: what the provider must hand back (state, nonce) and the PKCE verifier, ten minutes at most.
-- `ask` is the app's ask (handle.ts askQuery) to carry on with once signed in.
CREATE TABLE sso_states (state TEXT PRIMARY KEY, studio_id TEXT NOT NULL, nonce TEXT NOT NULL, verifier TEXT NOT NULL, ask TEXT, at INTEGER NOT NULL);
