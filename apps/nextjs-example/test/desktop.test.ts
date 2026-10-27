import { setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { counterJourney } from "../../../scripts/counter.ts";

// Next builds are slow: `opennextjs-cloudflare build` runs `next build`, then bundles the Worker.
setDefaultTimeout(300_000);

// The sample-app contract (FRAMEWORKS.md): build the dev host (which runs the OpenNext build),
// count 0, two posts through the form, count 2, restart, still 2.
test("desktop: the Next.js Worker counts in KV, survives a restart", () => counterJourney(join(import.meta.dir, "..")));
