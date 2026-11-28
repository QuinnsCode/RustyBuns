// What a whole "build me a world" session costs an AI, in estimated tokens: the instructions and tool list once, each
// call's arguments, each reply (session.ts, counted by scripts/mcp-session.ts). No network, no key. A longer tool
// description or reply that takes it past tokens.json's budget fails here.
import { expect, test } from "bun:test";
import { int, obj } from "@rustybuns/util/guard";
import { cost, session } from "../../../scripts/mcp-session.ts";
import { local } from "./app-kit.ts";
import { SESSION, WORLD } from "./session.ts";

const { budget } = obj({ budget: int(1, 1_000_000) })(await Bun.file(new URL("./tokens.json", import.meta.url)).json());

test("the build-me-a-world session stays within its token budget", async () => {
  const app = local();
  const run = await session(app.rpc, SESSION);
  // A refused call would make a cheap session that built nothing.
  expect(run.calls.filter((c) => c.refused)).toEqual([]);
  expect(app.page().files["world.js"]).toBe(WORLD.replace(`sky("night")`, `sky("dusk")`));
  const c = cost(run);
  console.log(`session: ${c.total} tokens (budget ${budget}); tool list and instructions ${c.list}\n${c.calls.map((x) => `  ${x.name.padEnd(16)} ${x.args} sent, ${x.reply} back`).join("\n")}`);
  expect(c.total).toBeLessThanOrEqual(budget);
});
