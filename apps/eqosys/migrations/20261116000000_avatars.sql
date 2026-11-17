-- Your character (avatar.ts, #4987): the parts of @rustybuns/util/avatar as JSON, one row a person, worn in every Q app.
-- `at` is when it was last saved, ms since the epoch. No row: the default from their name.
CREATE TABLE avatars (user_id TEXT PRIMARY KEY, data TEXT NOT NULL, at INTEGER NOT NULL);
