-- Apple's server notifications already handled (apple.ts), by `jti`: a captured one sent again is answered 200 and does nothing.
-- Kept SEEN_DAYS; a notification signed before that is refused, so a pruned row can't be replayed either.
CREATE TABLE apple_seen (jti TEXT PRIMARY KEY, at INTEGER NOT NULL);
