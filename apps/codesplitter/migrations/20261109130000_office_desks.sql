-- Which Agent Office desk a coding agent's run sits at (src/office.ts, #3423 slice 3). A hire with a repo and a file
-- starts an agent run; this row lets the run tell its desk how it went when it ends. Only office-preview has a floor.
CREATE TABLE IF NOT EXISTS office_desks (
  run INTEGER PRIMARY KEY,
  floor TEXT NOT NULL,
  worker TEXT NOT NULL
);
