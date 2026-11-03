-- Spaces (Qollab, space.ts): groups that last, across every Q app, with text channels. Who owns a space and who is in it
-- lives here; the channels and messages live in the space's Durable Object. `invite` is the code an owner hands out.
CREATE TABLE spaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, owner TEXT NOT NULL, invite TEXT NOT NULL UNIQUE, at INTEGER NOT NULL);
CREATE INDEX spaces_owner ON spaces (owner);
CREATE TABLE space_members (space_id TEXT NOT NULL, user_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (space_id, user_id));
CREATE INDEX space_members_user ON space_members (user_id);
