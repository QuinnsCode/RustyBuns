-- Each pipeline lane's count since it last ran, per repo (src/pipeline-lanes.ts, #3313): an `often` lane runs on
-- its Nth change, a `bus` leaves when its seats are full. A change landing on main moves them.
CREATE TABLE IF NOT EXISTS lane_counts (
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  lane TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (owner, repo, lane)
);
