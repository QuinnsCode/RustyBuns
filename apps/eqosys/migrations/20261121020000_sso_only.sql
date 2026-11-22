-- Qollab for teams (#5543). A studio that proved its domain (studio_sso.proved_at) can make company sign-in the only way in for
-- its domain's emails (sso.ts ssoOnly): a password, GitHub, Google or Apple sign-in with such an email is refused. Off by default;
-- a changed domain is unproved, and an unproved domain requires nothing.
ALTER TABLE studio_sso ADD COLUMN only_sso INTEGER NOT NULL DEFAULT 0;
