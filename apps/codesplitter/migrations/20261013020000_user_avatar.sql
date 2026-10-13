-- A person's avatar (src/avatar.ts): their chosen parts as JSON, worn in the code city. '' until they make one.
ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT '';
