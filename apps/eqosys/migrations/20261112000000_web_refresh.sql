-- A game page's refresh token (the page client keeps one so a long session renews its ten-minute token without a bounce):
-- marked `web`, so signing out on the eqosys page ends it, while a native app's stays until that app signs out.
ALTER TABLE refresh ADD COLUMN web INTEGER NOT NULL DEFAULT 0;
