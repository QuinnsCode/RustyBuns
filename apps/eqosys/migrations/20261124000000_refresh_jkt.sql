-- A game page's refresh token bound to the page's key (DPoP, #5892): the RFC 7638 thumbprint of the non-extractable key
-- that asked for it. A bound token is spent only with a proof from that key (oauth.ts); null for native apps and old pages.
ALTER TABLE refresh ADD COLUMN jkt TEXT;
