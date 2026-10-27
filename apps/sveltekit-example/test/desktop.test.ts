import { setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { counterJourney } from "../../../scripts/counter.ts";

setDefaultTimeout(120_000);

// The sample-app contract (FRAMEWORKS.md): build the dev host, count 0, two posts through the
// form action, count 2, restart, still 2.
test("desktop: the SvelteKit Worker counts in KV through a form action, survives a restart", () => counterJourney(join(import.meta.dir, "..")));
