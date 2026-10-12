-- Where git truth lives (src/mirror.ts): when a mirror and its upstream changed the
-- same lines, or upstream rewrote its history, whose side wins without asking.
-- ask (the default) stops and waits for the owner, as mirrors always have;
-- codesplitters keeps the edits here, committed or not; artifact keeps this copy's
-- commits but still asks about edits not committed yet; github takes upstream's.
ALTER TABLE users ADD COLUMN git_truth TEXT NOT NULL DEFAULT 'ask';
