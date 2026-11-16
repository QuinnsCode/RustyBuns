-- Roles inside a person's own space (space.ts, #4380): 'admin' runs it beside the owner, 'member' is everyone else, 'guest'
-- sees only #general and the private channels they are let into. A studio's space takes its roles from studio_members instead.
ALTER TABLE space_members ADD COLUMN role TEXT NOT NULL DEFAULT 'member';
