-- Privacy (privacy.ts). `region` is where a person's vault lives, set once at their first sign-in: "eu" for Europe, null for anywhere.
-- A vault holds the key their saves are sealed with, so an EU person's key, and so their readable saves, stay in the EU.
ALTER TABLE members ADD COLUMN region TEXT;
-- 1 when `data` is sealed with the person's key (AES-256-GCM, @rustybuns/util/privacy); 0 for a save written before vaults.
ALTER TABLE saves ADD COLUMN sealed INTEGER NOT NULL DEFAULT 0;
-- Sessions are kept until they run out (privacy.ts): every sign-in deletes the expired ones, everyone's, by this index.
CREATE INDEX session_expires ON "session" ("expiresAt");
