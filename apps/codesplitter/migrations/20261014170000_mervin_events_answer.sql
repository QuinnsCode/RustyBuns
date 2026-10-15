-- How a card was answered (main | branch | both | written | agent | mixed), kept with the asked event so repeats can become rules.
ALTER TABLE mervin_events ADD COLUMN answer TEXT NOT NULL DEFAULT '';
