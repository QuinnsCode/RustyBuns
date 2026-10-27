import { setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { counterJourney } from "../../../scripts/counter.ts";

setDefaultTimeout(120_000);

// The sample-app contract (FRAMEWORKS.md): build the dev host (the Qwik client build, the adapter's
// server build, then the Worker bundle under Bun), count 0, two posts through the routeAction$
// form, count 2, restart, still 2.
test("desktop: the Qwik City Worker counts in KV, survives a restart", () => counterJourney(join(import.meta.dir, "..")));
