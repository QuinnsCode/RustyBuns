-- Code city (src/city.ts): a city's districts, laid out, kept for a minute so a
-- visit, its postcard and a refresh share one build (git walks and file DOs are the
-- cost). Who's in town isn't kept; it's read live.
CREATE TABLE city_cache (name TEXT PRIMARY KEY, built_at INTEGER NOT NULL, body TEXT NOT NULL);
