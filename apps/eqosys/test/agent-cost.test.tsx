// One browser task, done the four ways an agent can, with what each costs in tokens: the numbers WEBMCP.md quotes for eqosys.
// The task: "how many achievements have I unlocked, of how many, in each Sports & Skate game?"
// Tokens are characters / 4 on the exact text sent and received (codeSplitter's yardstick); a screenshot is width × height / 750
// on Claude, and the number of them is the Trophies tab's real height in Chrome at 1280 × 800, one screen per 800 px plus the
// home page the agent starts on.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { workerLoader } from "@rustybuns/shell-bun";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { newKey } from "@rustybuns/util/token";
import { launchChrome, load, openTab } from "../../../scripts/chrome.ts";
import { Document } from "../src/app/Document.tsx";
import { Home } from "../src/app/pages.tsx";
import { APPS } from "../src/apps.ts";
import { ACHIEVEMENTS } from "../src/achievements.ts";
import { asks, boot, PARK, PASSWORD } from "./kit.ts";

setDefaultTimeout(60_000);
const W = 1280, H = 800, GENRE = "Sports & Skate";
const tokens = (x: unknown) => Math.ceil((typeof x === "string" ? x : JSON.stringify(x)).length / 4);
const want = APPS.filter((a) => a.genre === GENRE && ACHIEVEMENTS[a.id]).map((a) => a.id).sort();

const { call } = await boot({ EQOSYS_SIGNING_KEY: await newKey(), LOADER: workerLoader(mkdtempSync(join(tmpdir(), "eq-loader-"))) as never });
const a = await asks("park-hide-seek", PARK);
const { cookie } = await call("/do/signup", { form: { ...a.form, name: "Ada", email: "ada@example.com", password: PASSWORD } });
const run = async (name: string, args: unknown) => (await (await call(`/api/tools/${name}`, { json: args, cookie })).res.json()) as { result: any };

// The Trophies tab as the person sees it (no unlocks yet, as for Ada above).
const me = { id: "1", email: "ada@example.com", name: "Ada" } as never;
const html = "<!doctype html>" + renderToStaticMarkup(<Document><Home counts={new Map()} t0={0} me={me} mine={undefined} hub={null} everyone={null} unlocks={new Map()} tab="achievements" /></Document>);
const srv = Bun.serve({ port: 0, fetch: async (r) => {
  const p = new URL(r.url).pathname, file = Bun.file(join(import.meta.dir, "../public", p));
  if (p === "/") return new Response(html, { headers: { "content-type": "text/html" } });
  return (await file.exists()) ? new Response(file) : new Response("", { status: 404 });
} });
let chrome: Awaited<ReturnType<typeof launchChrome>>;
beforeAll(async () => { chrome = await launchChrome(); });
afterAll(() => { chrome?.stop(); srv.stop(); });

test("one task by screenshots, by the page's text, by one eq_batch and by one eq_execute: the tools cost a sliver", async () => {
  // Screenshots: the home page, then every screen of the Trophies tab scrolled through. Measured height, published rate.
  const tab = await openTab(chrome.cdp, { w: W, h: H });
  await load(chrome.cdp, tab, `http://127.0.0.1:${srv.port}/`, 500);
  const height = await tab.eval<number>("document.documentElement.scrollHeight");
  const screens = 1 + Math.ceil(height / H), screenshots = screens * Math.ceil((W * H) / 750);

  // The page as text, what a get_page_text tool hands back: everything the tab says. (It doesn't name a game's genre, so an agent
  // reading it still needs the library tab too; this counts the Trophies tab alone, a floor.)
  const text = await tab.eval<string>("document.body.innerText");
  expect(text).toContain("Skate Tech Park");
  const pageText = tokens(text);

  // One eq_batch: the genre's ids and every game's tally, picked down to the three fields wanted.
  const batchArgs = { calls: [{ tool: "eq_apps", args: { genre: GENRE }, pick: ["apps.id"] }, { tool: "eq_achievements", pick: ["games.app", "games.unlocked", "games.total"] }] };
  const batch = (await run("eq_batch", batchArgs)).result;
  const ids = new Set((batch[0].result.apps as { id: string }[]).map((x) => x.id));
  expect((batch[1].result.games as { app: string }[]).filter((g) => ids.has(g.app)).map((g) => g.app).sort()).toEqual(want);
  const viaBatch = tokens(batchArgs) + tokens(batch);

  // One eq_execute: the same two reads, filtered inside the program, so only the answer comes back.
  const code = "const { apps } = await tools.eq_apps({ genre: input.genre }); const ids = new Set(apps.map((a) => a.id)); const { games } = await tools.eq_achievements({}); return games.filter((g) => ids.has(g.app)).map((g) => [g.app, g.unlocked, g.total]);";
  const exec = (await run("eq_execute", { code, input: { genre: GENRE } })).result as { ok: boolean; result: [string, number, number][] };
  expect(exec.ok).toBe(true);
  expect(exec.result.map(([id]) => id).sort()).toEqual(want);
  const viaExecute = tokens({ code, input: { genre: GENRE } }) + tokens(exec);

  console.log(`one task: ${screens} screenshots ~${screenshots} tokens (page ${height} px), page text ~${pageText}, eq_batch ~${viaBatch}, eq_execute ~${viaExecute}`);
  expect(viaBatch).toBeLessThan(pageText);
  expect(viaExecute).toBeLessThan(pageText);
  expect(pageText).toBeLessThan(screenshots);
});
