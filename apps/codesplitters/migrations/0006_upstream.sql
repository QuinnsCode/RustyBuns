-- Where a repo was forked from: "github:owner/name" and the commit it was cloned
-- at. A repo made here has neither. The fork is the owner's; upstream never hears of it.
ALTER TABLE repos ADD COLUMN upstream TEXT;
ALTER TABLE repos ADD COLUMN upstream_commit TEXT;
