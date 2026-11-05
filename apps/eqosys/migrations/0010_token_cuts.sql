-- Token cuts (members.ts): a token eqosys signed for `app` ("*" for every app) at or before `before` (seconds) is refused,
-- so signing out everywhere or revoking a refresh token ends the ten-minute tokens already handed out. Gone with the account.
CREATE TABLE token_cuts (user_id TEXT NOT NULL, app TEXT NOT NULL, before INTEGER NOT NULL, PRIMARY KEY (user_id, app));
