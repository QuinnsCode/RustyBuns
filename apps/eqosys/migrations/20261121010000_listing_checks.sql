-- The machine checks a studio's game got when it was last sent to review (checks.ts): JSON { at, list: [{ name, ok, says }] }.
ALTER TABLE listings ADD COLUMN checks TEXT;
