-- A hook that hears only the owner's own work (#1571): a crew member's or an agent's branch doesn't reach a CI that has the owner's secrets.
ALTER TABLE webhooks ADD COLUMN owner_only INTEGER NOT NULL DEFAULT 0;
