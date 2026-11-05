-- The return URL a handoff code was sent to (#3634): an exchange or /oauth/token that names a different redirect_uri is refused.
ALTER TABLE codes ADD COLUMN back TEXT;
