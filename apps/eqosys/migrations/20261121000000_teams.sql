-- Qollab for teams (#5543). A studio proves it owns its company sign-in domain with a DNS TXT record (sso.ts proveDomain):
-- `proved_at` is when that record was last seen. A proved domain links an account made another way with the same email, and
-- outranks an unproved claim on the domain by another studio.
ALTER TABLE studio_sso ADD COLUMN proved_at INTEGER;
-- A seat that came from company sign-in (sso.ts joinStudio) is renewed by each company sign-in; `sso_at` is the last one. The
-- daily sweep (lapseSeats) takes out seats not renewed in SSO_SEAT_DAYS, so someone the company turned off leaves the studio
-- and its space without waiting for their session to end. Seats an owner handed out by email have none and never lapse.
ALTER TABLE studio_members ADD COLUMN sso_at INTEGER;
