-- Your character (avatars.ts, #4987): the parts you picked (@rustybuns/util/avatar), as JSON, one row a person.
-- Someone with no row wears defaultAvatar(name).
CREATE TABLE avatars (user_id TEXT PRIMARY KEY, look TEXT NOT NULL, at INTEGER NOT NULL);
