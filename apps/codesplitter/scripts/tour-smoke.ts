#!/usr/bin/env bun
// Smoke test the tour's three ways of being driven, in a real Chrome against the app on the local twins (free,
// nothing leaves the machine): a person pressing its buttons, autoplay stepping by itself, and an agent calling
// the page's WebMCP tools (list_scenes, play_scene, scene_step). Three checks each; the scene they walk is
// the chapters in CHAPTERS below (add a chapter by adding a row).
//
//   bun scripts/tour-smoke.ts [--chrome "/path/to/chrome"] [--keep]
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@rustybuns/shell-bun";
import worker from "../src/worker.ts";
import { local } from "../src/local.ts";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const CHROME = arg("chrome") ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const call = await local({ GH_CLI: "off" });
if (!(await Bun.file("dist/client/index.html").exists())) await Bun.$`bun run build.ts`.quiet();
const shell = serve({ port: 0, assets: "dist/client", runWorkerFirst: ["/api"], reporter: { escaped: () => {} } as any });
shell.mount(worker as any, call.env);

const j = (path: string, body?: unknown, method = body === undefined ? "GET" : "POST") =>
  call("ryan", "/api" + path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
await j("/login", { name: "ryan" });
await j("/repos", { name: "office", visibility: "public" });
await j("/repos/ryan/office/files", { path: "src/server.ts", content: "export const a = 1;\nexport const b = 2;\n" });
for (const b of ["fix-a", "fix-b"]) await j("/repos/ryan/office/branches", { name: b });
// Two open PRs on Mervin's board: one green, one red, so Ester has something to sort.
await j("/repos/ryan/office/board", { main: "abc", prs: [
  { pr: 1, head: "h1", ci: "pass", tiers: { certain: 1 }, files: 1, clashes: [], title: "fix a" },
  { pr: 2, head: "h2", ci: "fail", failing: ["apps/a: t1"], tiers: { agree: 1 }, files: 1, clashes: [], title: "fix b" },
] });

// Chrome over CDP, with the page's WebMCP registry stood in for (an agent's browser has document.modelContext).
const dir = mkdtempSync(join(tmpdir(), "tour-smoke-"));
const chrome = Bun.spawn([CHROME, "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "--no-first-run", "--window-size=1400,1000", "about:blank"], { stdout: "ignore", stderr: "pipe" });
const wsUrl = await (async () => {
  const dec = new TextDecoder(); let buf = "";
  for await (const c of chrome.stderr as any) { buf += dec.decode(c); const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) return m[1]!; }
  throw new Error("Chrome never said where DevTools listens");
})();
const port = new URL(wsUrl).port;
const target = (await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json()) as { webSocketDebuggerUrl: string };
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const waiting = new Map<number, (m: any) => void>();
ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); waiting.get(m.id)?.(m); };
const cdp = (method: string, params: object = {}) => new Promise<any>((res) => { const n = ++id; waiting.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
/** Evaluate in the page (awaiting promises) and hand back the JSON value. */
const page = async <T = any>(expr: string): Promise<T> => {
  const r = await cdp("Runtime.evaluate", { expression: `(async () => (${expr}))()`, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "page error");
  return r.result.result.value;
};
const until = async (what: string, expr: string, ms = 15000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) if (await page(expr).catch(() => false)) return;
  throw new Error(`never saw: ${what}`);
};
await cdp("Page.enable");
await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `
  window.__tools = {};
  navigator.modelContext = { registerTool: async (t) => { window.__tools[t.name] = t; return { unregister() { delete window.__tools[t.name]; } }; } };
  document.cookie = "cs_user=ryan; path=/";` });

const open = async () => {
  await cdp("Page.navigate", { url: `${shell.url}/#/f/ryan/office/src/server.ts` });
  await sleep(500);
  await cdp("Page.navigate", { url: `${shell.url}/#/f/ryan/office/src/server.ts` });
  await until("the file page", `!!document.querySelector("#lines .ln")`);
  await page(`sessionStorage.removeItem("cs_tour")`);
  await until("the board", `!!document.querySelector("[data-board]")`);
};
const card = () => page<string>(`document.querySelector(".tour b")?.textContent ?? ""`);
const tool = (name: string, args: object = {}) => page<any>(`window.__tools[${JSON.stringify(name)}].execute(${JSON.stringify(args)})`);

let failed = 0;
async function check(mode: string, name: string, fn: () => Promise<void>) {
  const t = performance.now();
  try { await fn(); console.log(`ok    ${mode.padEnd(12)} ${name} (${Math.round(performance.now() - t)} ms)`); }
  catch (e) { failed++; console.log(`FAIL  ${mode.padEnd(12)} ${name}: ${(e as Error).message}`); }
}
const must = (c: unknown, what: string) => { if (!c) throw new Error(what); };
const click = (sel: string, shift = false) => page(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) throw new Error("no ${sel.replace(/"/g, "'")}"); b.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: ${shift} })); })()`);
const scene = (spec: string) => page(`(() => { sessionStorage.setItem("cs_tour", JSON.stringify({ owner: "ryan", repo: "office", scene: ${JSON.stringify(spec)}, i: tourSpan(${JSON.stringify(spec)})[0], dir: 1 })); tour(); })()`);

/** One chapter is data: the checks below are the same three per way for each. `first` is a phrase from its opening step; `held` from the person-only step's hold. */
type Chapter = { id: string; steps: string[]; you: number; held: string; first: string; other: string };
const CHAPTERS: Chapter[] = [
  { id: "queue", steps: ["Meet the trio", "Mervin reads the board", "Mervin queues the merges", "Ester sorts the red tests", "Queue the merge"], you: 4, held: "A merge changes main", first: "deterministic", other: "play" },
  { id: "agents", steps: ["Agents on one repo", "Agents claim lines", "Two on the same line", "Merges settle by line id", "Agents rebase themselves", "Hosted agents", "Agents can't ship"], you: 5, held: "costs money", first: "at once", other: "play" },
];

try {
  // Every feature id a step claims must be on the strip.
  const order = (await Bun.file("src/features/order.txt").text()).split("\n").filter(Boolean);
  await open();
  const tagged = await page<string[]>(`[...new Set(TOUR.map((s) => s.feat).filter(Boolean))]`);
  const unknown = tagged.filter((f) => !order.includes(f));
  if (unknown.length) { failed++; console.log(`FAIL  coverage     unknown feature ids: ${unknown.join(", ")}`); }
  else console.log(`ok    coverage     ${tagged.length} of ${order.length} features have a scene`);

  for (const c of CHAPTERS) {
    const title = c.steps;
    await open();
    // A person: the card's own buttons.
    await check("human", `${c.id}: starts from the chapter strip`, async () => {
      await page(`(() => { sessionStorage.setItem("cs_tour", JSON.stringify({ owner: "ryan", repo: "office", i: 0, dir: 1 })); tour(); })()`);
      await until("the card", `!!document.querySelector(".tour")`);
      await click(`.tour [data-ch="${c.id}"]`);
      await until("the first step", `document.querySelector(".tour b")?.textContent === ${JSON.stringify(title[0])}`);
      must((await page<string>(`document.querySelector(".tour p")?.textContent ?? ""`)).includes(c.first), "first step doesn't say what it should");
    });
    await check("human", `${c.id}: Next walks on and Back returns`, async () => {
      await click(".tour [data-next]"); await until("Next", `document.querySelector(".tour b")?.textContent === ${JSON.stringify(title[1])}`);
      await click(".tour [data-next]");
      must((await card()) === title[2], `third step is "${await card()}"`);
      await click(".tour [data-back]");
      must((await card()) === title[1], "Back didn't return");
    });
    await check("human", `${c.id}: shift-click queues a chapter and Next reaches the person's step`, async () => {
      await click(`.tour [data-ch="${c.other}"]`, true);
      must(await page(`!!document.querySelector(".tour-queue")`), "nothing was queued");
      await click(`.tour [data-ch="${c.id}"]`);
      for (let n = 0; n < c.you; n++) await click(".tour [data-next]");
      must((await card()) === title[c.you], `got "${await card()}"`);
    });

    await check("human", `${c.id}: the scrub bar jumps back and pauses autoplay`, async () => {
      await click(".tour [data-auto]"); await click(".tour [data-next]");
      await page(`(() => { const r = document.querySelector(".tour-scrub"); r.value = String(+r.value - 1); r.dispatchEvent(new Event("change")); })()`);
      await until("scrubbed", `document.querySelector(".tour b")?.textContent === ${JSON.stringify(title[0])} && !JSON.parse(sessionStorage.getItem("cs_tour")).auto`);
    });

    // Autoplay: a cursor does the steps, and stops where a person must act.
    await check("autoplay", `${c.id}: Play turns it on and the cursor appears`, async () => {
      await scene(`${c.id}:1-${c.steps.length}`); await click(".tour [data-auto]");
      await until("auto on", `JSON.parse(sessionStorage.getItem("cs_tour")).auto === true`);
      await until("the cursor", `!!document.querySelector(".tour-cursor")`);
    });
    await check("autoplay", `${c.id}: it steps on by itself`, async () => {
      await until("step 2", `document.querySelector(".tour b")?.textContent === ${JSON.stringify(title[1])}`, 25000);
    });
    await check("autoplay", `${c.id}: it holds before the person's step and hands the wheel back`, async () => {
      await until("held", `document.querySelector(".tour-said")?.textContent.includes(${JSON.stringify(c.held)}) && !JSON.parse(sessionStorage.getItem("cs_tour")).auto`, 60000);
      must((await card()) === title[c.you], `held on "${await card()}"`);
    });

    // An agent: the same scene over WebMCP.
    await open();
    await check("agent", `${c.id}: list_scenes offers it, the person's step marked`, async () => {
      await until("tools", `!!window.__tools.list_scenes`);
      const q = (await tool("list_scenes")).find((s: any) => s.id === c.id);
      must(q?.steps.map((s: any) => s.title).join("|") === title.join("|"), "steps differ");
      must(q.steps[c.you].you, "the step isn't marked as a person's");
    });
    await check("agent", `${c.id}: play_scene puts it on screen and scene_step walks it`, async () => {
      const now = (await tool("play_scene", { scene: c.id, owner: "ryan", repo: "office" })).result;
      must(now.step === 1 && now.of === c.steps.length, `started at ${now.step}/${now.of}`);
      for (const t of title.slice(0, c.you)) {
        const r = (await tool("scene_step")).result;
        must(r.stepped === t, `stepped "${r.stepped}", wanted "${t}"`);
      }
    });
    await check("agent", `${c.id}: scene_step answers held and skip finishes the scene`, async () => {
      const held = (await tool("scene_step")).result;
      must(held.held?.includes(c.held), `no hold: ${JSON.stringify(held)}`);
      let done = (await tool("scene_step", { skip: true })).result; // skip passes the held step; any steps after it play on
      for (let n = 0; !done.done && n < c.steps.length; n++) done = (await tool("scene_step")).result;
      must(done.done === true, `not done: ${JSON.stringify(done)}`);
      must(await page(`!document.querySelector(".tour")`), "the card is still up");
    });
  }

  // The demos page: every chapter is a card, and Play starts the tour's own autoplay on it.
  await open();
  await check("demos", "the page lists every chapter and Play runs the desktop one by itself", async () => {
    await page(`location.hash = "#/demos"`);
    await until("the cards", `document.querySelectorAll("[data-demo]").length === TOUR_CHAPTERS.length`);
    await click(`[data-demo="desktop"]`);
    await until("the first step", `document.querySelector(".tour b")?.textContent === "The same app on your machine"`);
    await until("autoplay", `JSON.parse(sessionStorage.getItem("cs_tour")).auto === true`);
    await until("step 2", `document.querySelector(".tour b")?.textContent === "It syncs out, both ways"`, 25000);
  });
} finally {
  ws.close(); chrome.kill(); shell.stop?.();
  if (!process.argv.includes("--keep")) rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} failed` : `\nall ${CHAPTERS.length * 9 + 1} passed`);
process.exit(failed ? 1 : 0);
