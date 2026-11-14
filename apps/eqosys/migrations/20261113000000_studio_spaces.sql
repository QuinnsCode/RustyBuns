-- A space a studio owns (space.ts, #4464): its members are the studio's (studio_members), not space_members rows, and its
-- owners and admins run it. One a studio; a person's own spaces leave it NULL.
ALTER TABLE spaces ADD COLUMN studio_id TEXT;
CREATE UNIQUE INDEX spaces_studio ON spaces (studio_id);
