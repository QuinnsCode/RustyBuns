import { setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { counterJourney } from "../../../scripts/counter.ts";

setDefaultTimeout(120_000);

// A client-only Svelte app: the shell is served behind the token, and its "use server" counter
// action counts to 2 through /__rb/action and survives a restart.
test("desktop: the Svelte SPA counts through a host action, survives a restart", () => counterJourney(join(import.meta.dir, ".."), { spa: "src/actions/counter.ts" }));
