-- Visitors (visitors.ts): a row per caller, site and day, the way codeSplitter's insights count traffic. `who` is a hash of the
-- IP and browser salted with the day, so no IP is kept and nobody is followed from one day to the next. Swept after 30 days.
-- `engaged` counts the times that caller's page saw a tap, a key or a scroll: what makes a browser look like a person.
CREATE TABLE visits (
  day INTEGER NOT NULL,
  site TEXT NOT NULL,
  who TEXT NOT NULL,
  kind TEXT NOT NULL,
  via TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  engaged INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  ua TEXT,
  ref TEXT,
  PRIMARY KEY (day, site, who, kind, via)
);
CREATE INDEX visits_last ON visits (last_at);
-- The super admin's own callers that day (marked when they open eqosys), left out of every count: on a small site they'd swamp it.
CREATE TABLE visit_staff (
  day INTEGER NOT NULL,
  who TEXT NOT NULL,
  PRIMARY KEY (day, who)
);
