-- Which of a person's linked GitHub accounts digs and lists repos (Better Auth's
-- account.id). Null means the one linked last.
ALTER TABLE users ADD COLUMN github_account TEXT;
