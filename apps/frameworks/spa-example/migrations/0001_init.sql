CREATE TABLE IF NOT EXISTS world_progress (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, world_slug TEXT NOT NULL, data TEXT, UNIQUE(user_id, world_slug));
