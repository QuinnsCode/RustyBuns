-- Conflict rounds per branch (#1089): how many merges of it asked the conflict agent anew, because its
-- conflicts changed (src/branches.ts askLeftovers). From the third on, fresh eyes answer from a terse note
-- of what the rounds before tried, or a person does, as the file's policy says (budget.ts).
ALTER TABLE branches ADD COLUMN conflict_rounds INTEGER NOT NULL DEFAULT 0;
