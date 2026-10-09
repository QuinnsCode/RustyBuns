-- The social side lives in D1: who people are, their repos, and their taste.
-- File contents live in each file's Durable Object; D1 only indexes commits.

CREATE TABLE users (
  name TEXT PRIMARY KEY,
  bio TEXT NOT NULL DEFAULT '',
  -- MySpace rules: your profile is your own HTML and CSS, shown in a sandbox.
  theme_html TEXT NOT NULL DEFAULT ''
);

CREATE TABLE repos (
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner, name)
);

CREATE TABLE collaborators (
  owner TEXT NOT NULL, repo TEXT NOT NULL, name TEXT NOT NULL,
  PRIMARY KEY (owner, repo, name)
);

CREATE TABLE files (
  owner TEXT NOT NULL, repo TEXT NOT NULL, path TEXT NOT NULL,
  PRIMARY KEY (owner, repo, path)
);

-- A playlist of code taste: tracks are line ranges from any file you can see.
CREATE TABLE playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  title TEXT NOT NULL
);

CREATE TABLE tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  playlist INTEGER NOT NULL,
  owner TEXT NOT NULL, repo TEXT NOT NULL, path TEXT NOT NULL,
  from_line INTEGER NOT NULL, to_line INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);

-- Search over the last commit of every file. D1 and bun:sqlite both ship FTS5.
CREATE VIRTUAL TABLE file_search USING fts5(owner UNINDEXED, repo UNINDEXED, path, content);
