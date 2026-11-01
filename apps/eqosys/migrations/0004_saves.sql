-- Qollab cloud saves (saves.ts): opaque blobs a game keeps per person. A slot keeps its last few versions, one row each; `id` only
-- grows, so the biggest id in a slot is its newest. `size` is the blob's bytes, summed for a person's quota. Times are ms since the epoch.
CREATE TABLE saves (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, app TEXT NOT NULL, slot TEXT NOT NULL, at INTEGER NOT NULL, size INTEGER NOT NULL, data BLOB NOT NULL);
CREATE INDEX saves_slot ON saves (user_id, app, slot, id);
