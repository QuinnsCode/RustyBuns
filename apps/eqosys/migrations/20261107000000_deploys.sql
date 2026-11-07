-- The Ship door (deploys.ts): each app's last deploy per stage, as `rustybuns deploy` reported it in a signed POST /api/deploys.
CREATE TABLE deploys (app TEXT NOT NULL, stage TEXT NOT NULL, version TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (app, stage));
