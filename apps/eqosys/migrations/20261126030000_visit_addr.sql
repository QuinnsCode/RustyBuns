-- Visitors (visitors.ts): `addr` is a hash of the IP alone, salted with the day like `who`, so one address can only add so many
-- rows a day however many browsers it claims to be. Rows from before this have none and count toward no cap.
ALTER TABLE visits ADD COLUMN addr TEXT;
CREATE INDEX visits_addr ON visits (day, addr);
