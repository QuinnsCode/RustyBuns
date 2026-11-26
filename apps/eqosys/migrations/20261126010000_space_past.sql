-- The spaces a person has left or was taken out of (qollab/space.ts): their messages and files stay there, so deleting the
-- account erases them there too, and their download holds them. Rows from before this one are not known.
CREATE TABLE space_past (user_id TEXT NOT NULL, space_id TEXT NOT NULL, PRIMARY KEY (user_id, space_id));
