-- Achievements a person has unlocked in a game (achievements.ts). The catalog of what each game has is in code;
-- a row is one unlock, kept the first time and never moved. `at` is ms since the epoch.
CREATE TABLE unlocks (user_id TEXT NOT NULL, app TEXT NOT NULL, achievement TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user_id, app, achievement));
