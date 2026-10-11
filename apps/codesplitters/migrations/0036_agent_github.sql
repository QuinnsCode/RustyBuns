-- Which of a person's linked GitHub accounts their hosted agents work as (Better
-- Auth's account.id), apart from the one they dig as. Null means none: agents get no token.
ALTER TABLE users ADD COLUMN agent_github TEXT;
