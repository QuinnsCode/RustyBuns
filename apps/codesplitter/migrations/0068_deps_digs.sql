-- The dependency doctor's digs (src/deps.ts, #863): future releases the owner
-- asked it to watch, try, and maybe take, as JSON [{name, target, take}].
ALTER TABLE dep_watches ADD COLUMN digs TEXT;
