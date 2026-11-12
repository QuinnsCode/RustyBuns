// A first-time tutorial in a real page: it waits on each step in turn, finishes once (the eqosys `tutorial` unlock sent,
// the browser remembering), never starts again here, and ends quietly when the account says it was done elsewhere.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { launchChrome, load, openTab } from "../../../scripts/chrome.ts";

setDefaultTimeout(60_000);

const built = await Bun.build({ entrypoints: [join(import.meta.dir, "tutorial-page.ts")], target: "browser" });
const script = await built.outputs[0]!.text();
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (req) => new URL(req.url).pathname === "/page.js"
  ? new Response(script, { headers: { "content-type": "text/javascript" } })
  : new Response(`<!doctype html><meta charset="utf-8"><body><script type="module" src="/page.js"></script>`, { headers: { "content-type": "text/html" } }) });
let chrome: Awaited<ReturnType<typeof launchChrome>>;
beforeAll(async () => { chrome = await launchChrome(); });
afterAll(() => { chrome?.stop(); server.stop(true); });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function page(query: string) {
  // Its own browser context, so each case starts with nothing remembered.
  const tab = await openTab(chrome.cdp, { w: 800, h: 600 }, false, true);
  await load(chrome.cdp, tab, `http://127.0.0.1:${server.port}/${query}`, 100);
  return { run: <T>(js: string) => tab.eval<T>(js), close: tab.close };
}

test("each step waits for the player, then it is done for good in this browser", async () => {
  const p = await page("");
  expect(await p.run("t.coach.start()")).toBe(true);
  expect(await p.run("t.card()")).toContain("Move");
  // Two done at once (the second before the first, even) both count once the first is.
  await p.run("t.flags.b = true");
  await sleep(300);
  expect(await p.run("t.coach.state().title")).toBe("Move");
  await p.run("t.flags.a = true");
  await sleep(300);
  expect(await p.run("t.coach.state()")).toMatchObject({ running: true, step: 2, title: "Land" });
  expect(await p.run("t.card()")).toContain("3 of 3");
  await p.run("t.flags.c = true");
  await sleep(300);
  expect(await p.run("t.coach.state()")).toMatchObject({ running: false, learned: true });
  expect(await p.run("[t.sent, t.finished()]")).toEqual([["tutorial"], 1]);
  await sleep(2000);
  expect(await p.run("t.card()")).toBeNull();
  // A reload, or the game asking again: not again.
  await p.run("location.reload()");
  await sleep(500);
  expect(await p.run("t.coach.start()")).toBe(false);
  expect(await p.run("t.card()")).toBeNull();
  // Forgotten (a "How to play" button), it runs again.
  await p.run("t.coach.forget()");
  expect(await p.run("t.coach.start()")).toBe(true);
  await p.close();
});

test("finished on another device: the account ends it at once, with no unlock sent again", async () => {
  const p = await page("?account=done");
  await p.run("t.coach.start()");
  await sleep(300);
  expect(await p.run("t.coach.state()")).toMatchObject({ running: false, learned: true });
  expect(await p.run("[t.card(), t.sent, t.finished()]")).toEqual([null, [], 0]);
  await p.close();
});
