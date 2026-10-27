import { setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { counterJourney } from "../../../scripts/counter.ts";

setDefaultTimeout(120_000);

// The sample-app contract (FRAMEWORKS.md): build the dev host (which runs `nuxt build`), count 0,
// two posts through the form, count 2, restart, still 2.
test("desktop: the Nuxt Worker counts in KV, survives a restart", () => counterJourney(join(import.meta.dir, "..")));
