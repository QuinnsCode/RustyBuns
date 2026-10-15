#!/usr/bin/env bun
// Smoke test the tour's three ways of being driven, in a real Chrome against the app on the local twins (free,
// nothing leaves the machine): a person pressing its buttons, autoplay stepping by itself, and an agent calling
// the page's WebMCP tools (list_scenes, play_scene, scene_step). Three checks each; the scene they walk is
// "Mervin and Ester queue it": who the trio are, the board, the merge waves, the red tests, then the merge that is a person's.
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

try {
  await open();

  // A person: the card's own buttons.
  await check("human", "a scene starts from the chapter strip and shows Mervin's board", async () => {
    await page(`(() => { sessionStorage.setItem("cs_tour", JSON.stringify({ owner: "ryan", repo: "office", i: 0, dir: 1 })); tour(); })()`);
    await until("the card", `!!document.querySelector(".tour")`);
    await click('.tour [data-ch="queue"]');
    await until("the trio's step", `document.querySelector(".tour b")?.textContent === "Meet the trio"`);
    must((await page<string>(`document.querySelector(".tour p")?.textContent ?? ""`)).includes("deterministic"), "doesn't say they're deterministic");
    await click(".tour [data-next]");
    await until("Mervin's step", `document.querySelector(".tour b")?.textContent === "Mervin reads the board"`);
    must(await page(`!!document.querySelector("[data-board].tour-hot")`), "the board isn't lit");
  });
  await check("human", "Next walks to Ester and Back returns", async () => {
    await click(".tour [data-next]"); await until("Next", `document.querySelector(".tour b")?.textContent !== "Mervin reads the board"`);
    const second = await card();
    await click(".tour [data-next]");
    must((await card()) === "Ester sorts the red tests", `third step is "${await card()}"`);
    await click(".tour [data-back]");
    must((await card()) === second, "Back didn't return");
  });
  await check("human", "shift-clicking a chapter queues it and the last step is the merge only a person presses", async () => {
    await click('.tour [data-ch="play"]', true);
    must((await page<string>(`document.querySelector(".tour-queue")?.textContent ?? ""`)).includes("Play"), "Play wasn't queued");
    await click(".tour [data-next]"); await click(".tour [data-next]");
    must((await card()) === "Queue the merge", `got "${await card()}"`);
    must(await page(`!!document.querySelector(".tour [data-go]")`), "no merge button on the card");
  });

  // Autoplay: a cursor does the steps, and stops where a person must act.
  await check("autoplay", "Play turns it on and the cursor appears", async () => {
    await scene("queue:2-5"); await click(".tour [data-auto]");
    await until("auto on", `JSON.parse(sessionStorage.getItem("cs_tour")).auto === true`);
    await until("the cursor", `!!document.querySelector(".tour-cursor")`);
  });
  await check("autoplay", "it steps on by itself to Mervin's waves", async () => {
    await until("step 2", `document.querySelector(".tour b")?.textContent === "Mervin queues the merges"`, 20000);
  });
  await check("autoplay", "it holds before the merge and hands the wheel back", async () => {
    await until("held", `document.querySelector(".tour-said")?.textContent.includes("A merge changes main") && !JSON.parse(sessionStorage.getItem("cs_tour")).auto`, 40000);
    must((await card()) === "Queue the merge", "held on the wrong step");
  });

  // An agent: the same scene over WebMCP.
  await open();
  await check("agent", "list_scenes offers the scene, the merge marked as a person's", async () => {
    await until("tools", `!!window.__tools.list_scenes`);
    const q = (await tool("list_scenes")).find((s: any) => s.id === "queue");
    must(q?.steps.map((s: any) => s.title).join("|") === "Meet the trio|Mervin reads the board|Mervin queues the merges|Ester sorts the red tests|Queue the merge", "steps differ");
    must(q.steps[4].you, "the merge isn't marked as a person's");
  });
  await check("agent", "play_scene puts the scene on screen and scene_step walks it", async () => {
    const now = (await tool("play_scene", { scene: "queue", owner: "ryan", repo: "office" })).result;
    must(now.step === 1 && now.of === 5, `started at ${now.step}/${now.of}`);
    for (const title of ["Meet the trio", "Mervin reads the board", "Mervin queues the merges", "Ester sorts the red tests"]) {
      const r = (await tool("scene_step")).result;
      must(r.stepped === title, `stepped "${r.stepped}", wanted "${title}"`);
    }
  });
  await check("agent", "scene_step answers held on the merge and skip finishes the scene", async () => {
    const held = (await tool("scene_step")).result;
    must(held.held?.includes("A merge changes main"), `no hold: ${JSON.stringify(held)}`);
    const done = (await tool("scene_step", { skip: true })).result;
    must(done.done === true, `not done: ${JSON.stringify(done)}`);
    must(await page(`document.querySelectorAll("[data-merge]:not([disabled])").length >= 0 && !document.querySelector(".tour")`), "the card is still up");
  });
} finally {
  ws.close(); chrome.kill(); shell.stop?.();
  if (!process.argv.includes("--keep")) rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} failed` : "\nall 9 passed");
process.exit(failed ? 1 : 0);
