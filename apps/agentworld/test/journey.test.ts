// The whole walk, as a person takes it, through the running app (scripts/dev.ts, a stand-in eqosys, headless Chrome):
// land on the one-screen landing, Create your world, sign in, back on your world with Pick your land focused (keep the
// desert, and Copy prompt has the focus), your AI reads,
// says what it is doing and edits the starter (an edit alone makes the world, as a write does), the world is up, the
// Galaxy tile unlocks and is the bright one, pointing at it gets the galaxy ready before any click, you sign for your
// land and walk east onto the next plot; on the next visit the page gets it ready by itself with your plot, and the
// click only shows it; back at the root you go straight to your world. Plus: signed out, a locked tile gets nothing ready.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { freePort, launchChrome, load, openTab, type Tab, waitFor } from "../../../scripts/chrome.ts";
import { fakeEqosys, scrawlOnPad, signIn } from "./eqosys-kit.ts";

setDefaultTimeout(120_000); // Bun bundles the page cold, then the AI's world loads three.js

let chrome: Awaited<ReturnType<typeof launchChrome>>;
let server: ReturnType<typeof Bun.spawn>;
let base = "";
const eqosys = await fakeEqosys();
beforeAll(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = Bun.spawn(["bun", "scripts/dev.ts", "--port", String(port), "--with-parent"], { cwd: join(import.meta.dir, ".."), env: { ...process.env, EQOSYS_URL: eqosys.url }, stdout: "ignore", stderr: "inherit" });
  chrome = await launchChrome();
  for (let i = 0; i < 300; i++) { if (await fetch(base).then((r) => r.ok, () => false)) break; await Bun.sleep(100); }
});
afterAll(() => { chrome?.stop(); server?.kill(); eqosys.stop(); });

/** What the page has asked of the galaxy's routes so far. */
const galaxyFetches = (tab: Tab) => tab.eval<string[]>(`performance.getEntriesByType("resource").map((e) => new URL(e.name).pathname).filter((p) => p.startsWith("/api/galaxy/"))`);
const pointAt = (tab: Tab) => tab.eval(`document.querySelector("[data-galaxy-tile]").dispatchEvent(new PointerEvent("pointerover", { bubbles: true }))`);
const tool = (tab: Tab, name: string, args: object) => tab.eval(`(async () => __commands.run(${JSON.stringify(name)}, ${JSON.stringify(args)}))()`);

test("landing to world to galaxy: one bright next step on each screen, and the galaxy ready before the click", async () => {
  const tab = await openTab(chrome.cdp, { w: 1024, h: 720 }, false, true);
  await load(chrome.cdp, tab, base, 0);
  await waitFor(tab, "the landing", `!!document.querySelector(".landing")`, 60_000);
  expect(await tab.eval<string[]>(`[...document.querySelectorAll(".landing .bright")].map((b) => b.textContent)`)).toEqual([expect.stringContaining("Create your world")]);

  // Create your world, signed in at the stand-in eqosys: back on your world, and the next step has the focus: Pick your
  // land (Copy quiet under it), then, the desert kept, Copy prompt.
  eqosys.as({ id: "u_ada", email: "ada@example.com", name: "Ada" });
  const room = await signIn(tab, eqosys.url);
  await waitFor(tab, "Pick your land focused", `document.activeElement?.matches(".pick [data-land]")`);
  expect(await tab.eval<string>(`document.querySelector(".strip .next").textContent`)).toBe("Next: pick your land");
  expect(await tab.eval<boolean>(`document.querySelector(".dock button.big").classList.contains("quiet")`)).toBe(true);
  await tab.eval(`document.querySelector(".pick-keep").click()`);
  await waitFor(tab, "Copy focused", `document.activeElement?.matches(".dock button.big:not(.quiet)")`);
  expect(await tab.eval<boolean>(`!!document.querySelector(".landing")`)).toBe(false);

  // Signed in, world not made: the tile is locked, and pointing at it gets nothing ready.
  await pointAt(tab);
  await Bun.sleep(1500);
  expect(await galaxyFetches(tab)).toEqual([]);

  // The AI: looks, says what it's doing, then changes the starter with one edit (no whole-file write).
  await waitFor(tab, "the relay", `!!document.querySelector(".live.on")`, 20_000);
  await tool(tab, "page_read", {});
  await tool(tab, "page_status", { text: "Asking about your world" });
  expect(await tab.eval<string>(`document.querySelector(".strip .said")?.textContent`)).toContain("Asking about your world");
  // A note typed in the console goes to the agent with the reply to its next call.
  await tab.eval(`(() => { const i = document.querySelector(".note input"); i.value = "add a pond"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await tab.eval(`document.querySelector(".note button").click()`);
  await waitFor(tab, "the note waiting", `document.querySelector(".note-says")?.textContent.includes("add a pond")`);
  expect(await tool(tab, "page_edit_file", { path: "world.js", find: "cactus(18,", replace: "cactus(30," })).toMatchObject({ ok: true, user_note: "add a pond" });
  await waitFor(tab, "the note taken", `document.querySelector(".term-out").textContent.includes("your agent got your note")`);

  // The world is up: the Galaxy tile unlocks and is the one bright control; the strip says what's next.
  await waitFor(tab, "the galaxy unlocked", `!!document.querySelector("[data-galaxy-tile].next")`, 45_000);
  // The focus goes on from Copy to the Galaxy tile, the next step.
  await waitFor(tab, "the Galaxy tile focused", `document.activeElement?.matches("[data-galaxy-tile].next")`);
  expect(await tab.eval<string>(`document.querySelector(".strip .next").textContent`)).toBe("Next: open the galaxy");
  expect(await tab.eval<boolean>(`document.querySelector(".dock button.big").classList.contains("quiet")`)).toBe(true);

  // Pointing at it gets the galaxy ready. Not signed for your land yet, so no plot is claimed, but three.js, the scene
  // and your own land are ready before any click.
  await pointAt(tab);
  await waitFor(tab, "the galaxy ready", `agentGalaxy.state().preload.now === "ready"`, 45_000, "agentGalaxy.state()");
  const first = await galaxyFetches(tab);
  expect(first).toContain("/api/galaxy/sign");
  expect(first.includes("/api/galaxy/claim")).toBe(false);
  expect(await tab.eval<boolean>(`agentGalaxy.state().preload.early`)).toBe(true);

  // The click: sign for your land on the pad, and you're in on your own land, drawn in 3D.
  type In = { ready: boolean; me: { id: string; x: number; y: number }; live: { kind: string }; shows: Record<string, string> };
  await tab.eval(`document.querySelector("[data-galaxy-tile]").click()`);
  await waitFor(tab, "the sign pad", `agentGalaxy.state().signing`, 10_000, "agentGalaxy.state()");
  await scrawlOnPad(tab);
  await tab.eval(`document.querySelector(".sign-done").click()`);
  const yours = `(() => { const s = agentGalaxy.state(); return s.ready && s.shows[s.me.x + "," + s.me.y] === "land"; })()`;
  await waitFor(tab, "your land", yours, 15_000, "agentGalaxy.state()");
  const s = await tab.eval<In>(`agentGalaxy.state()`);
  expect(s.live.kind).toBe("mine");

  // East off your plot, onto the one next door.
  const east = await tab.eval<{ plot: { x: number; y: number } }>(`agentGalaxy.walk(0.6, 0)`);
  expect(east.plot).toEqual({ x: s.me.x + 1, y: s.me.y });

  // Next visit, signed: the page gets the galaxy ready by itself (your plot claimed, the plots around it and your land
  // read), and the click only shows it.
  await load(chrome.cdp, tab, `${base}/r/${room}`, 0);
  await waitFor(tab, "the galaxy ready again", `agentGalaxy.state().preload.now === "ready"`, 45_000, "agentGalaxy.state()");
  expect(await galaxyFetches(tab)).toEqual(expect.arrayContaining(["/api/galaxy/claim", "/api/galaxy/plots"]));
  expect(await tab.eval<string[]>(`agentGalaxy.state().preload.lands`)).toContain(s.me.id);
  await tab.eval(`document.querySelector("[data-galaxy-tile]").click()`);
  await waitFor(tab, "your land at once", yours, 2_000, "agentGalaxy.state()");
  // Back to your world and in again, twice: the layer goes with the galaxy's element and comes back, one at a time.
  for (const n of [1, 2]) {
    await tab.eval(`document.querySelector(".galaxy-back").click()`);
    await waitFor(tab, `the layer gone (${n})`, `!document.querySelector(".galaxy-layer") && !!document.querySelector(".dock")`);
    await tab.eval(`document.querySelector("[data-galaxy-tile]").click()`);
    await waitFor(tab, `your land again (${n})`, yours, 15_000, "agentGalaxy.state()");
    expect(await tab.eval<number>(`document.querySelectorAll(".galaxy-layer").length`)).toBe(1);
  }

  // Back at the root another day, signed in: straight to your world, no landing.
  await load(chrome.cdp, tab, base, 0);
  await waitFor(tab, "your world", `location.pathname === "/r/${room}" && !!document.querySelector(".dock")`, 30_000);
  expect(await tab.eval<boolean>(`!!document.querySelector(".landing")`)).toBe(false);
  expect(tab.noise.filter((n) => !n.startsWith("HTTP "))).toEqual([]);
});

test("signed out, pointing at or touching the Galaxy tile gets nothing ready", async () => {
  const tab = await openTab(chrome.cdp, { w: 390, h: 844 }, true, true);
  await load(chrome.cdp, tab, base, 0);
  await waitFor(tab, "the landing", `!!document.querySelector(".l-skip")`, 60_000);
  await tab.eval(`document.querySelector(".l-skip").click()`);
  await waitFor(tab, "the console", `!!document.querySelector("[data-galaxy-tile].locked")`);
  await tab.eval(`document.querySelector("[data-galaxy-tile]").dispatchEvent(new Event("touchstart", { bubbles: true }))`);
  await pointAt(tab);
  await Bun.sleep(1500);
  expect(await galaxyFetches(tab)).toEqual([]);
  expect(await tab.eval<string>(`agentGalaxy.state().preload.now`)).toBe("none");
});
