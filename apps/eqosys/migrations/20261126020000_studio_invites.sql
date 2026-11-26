-- A studio's invites waiting for a yes (studios.ts, #6232): adding someone by email asks them first, on their Studio tab, instead of
-- seating them. Kept by email (lowercased) so the one asking can't tell whether that email has an account.
CREATE TABLE studio_invites (studio_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, asked_by TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (studio_id, email));
CREATE INDEX studio_invites_email ON studio_invites (email);
