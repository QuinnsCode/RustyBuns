import { expect, test } from "bun:test";
import { dryRun, nextFire, render } from "../src/manual-run.ts";

const run = (f: typeof fetch) => dryRun({ site: "https://x.test", cron: "0 * * * *", dailyCalls: 1000, now: Date.UTC(2026, 9, 28, 10, 30), fetch: f });
const reply = (body: BodyInit, status = 200) => (async () => new Response(body, { status })) as unknown as typeof fetch;

test("before the deploy every step is to do; after a drawn fight the deploy, domain and billed call are done", async () => {
  const before = await run(reply("<html>not found</html>", 404));
  expect(before.map((s) => s.state)).toEqual(["unknown", "todo", "todo", "todo", "todo"]);
  const after = await run(reply(JSON.stringify([{ id: "m-1791810759744", startedAt: 1, shapes: [4, 6] }])));
  expect(after.map((s) => s.state)).toEqual(["unknown", "done", "done", "todo", "done"]);
  expect(render(after)).toContain("m-1791810759744");
});

test("an index with empty canvases is not a first real fight, and an unreachable site is reported", async () => {
  const empty = await run(reply(JSON.stringify([{ id: "m-1", startedAt: 1, shapes: [0, 0] }])));
  expect(empty[4]!.state).toBe("todo");
  const down = await run((async () => { throw new Error("ENOTFOUND"); }) as unknown as typeof fetch);
  expect(down[1]!.note).toContain("ENOTFOUND");
});

test("the next fire is the coming :00", () => {
  expect(nextFire("0 * * * *", Date.UTC(2026, 9, 28, 10, 30)).toISOString()).toBe("2026-10-28T11:00:00.000Z");
});
