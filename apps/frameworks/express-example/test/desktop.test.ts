import { setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { counterJourney } from "../../../../scripts/counter.ts";

setDefaultTimeout(120_000); // builds the app and boots PGlite twice (initdb is slow)

// The sample-app contract (FRAMEWORKS.md) through Express and PGlite: count 0, two posts, count 2,
// restart, still 2. No edge plan: a Worker can't run a node:http server.
test("desktop: the Express server counts in Postgres on PGlite, survives a restart", () =>
  counterJourney(join(import.meta.dir, ".."), { edge: false }));
