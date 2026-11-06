-- Studios (studios.ts, VISION.md): an account that makes and ships apps, at any size: one person, a team, a business.
-- A person's own account plays; a studio's account makes. QNTBR is the first, the super admin's, holding every app in APPS.
CREATE TABLE studios (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, at INTEGER NOT NULL);
-- Who is in a studio and what they may do there: owner (everything, and deleting it), admin (people and apps), maker (builds and ships).
CREATE TABLE studio_members (studio_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (studio_id, user_id));
CREATE INDEX studio_members_user ON studio_members (user_id);
-- The apps a studio makes: an app belongs to one studio. `repo` is where its code lives (a codeSplitter repo), once linked.
CREATE TABLE studio_apps (app TEXT PRIMARY KEY, studio_id TEXT NOT NULL, repo TEXT, at INTEGER NOT NULL);
CREATE INDEX studio_apps_studio ON studio_apps (studio_id);
