-- A webhook's shape (src/webhooks.ts): json is the signed event as it is; slack and discord post a one-line message a channel shows.
ALTER TABLE webhooks ADD COLUMN format TEXT NOT NULL DEFAULT 'json';
