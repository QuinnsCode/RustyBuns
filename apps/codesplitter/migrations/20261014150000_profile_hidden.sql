-- Profile sections their owner took off (a JSON array of ids, see PROFILE_SECTIONS in src/worker.ts).
-- Empty by default: a profile keeps its repos, pulse, stamps, collections and city unless you remove them.
ALTER TABLE users ADD COLUMN hidden TEXT NOT NULL DEFAULT '[]';
