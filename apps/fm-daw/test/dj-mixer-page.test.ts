// The decks' mixer in headless Chrome (scripts/chrome.ts) on /decks.html, a DJ's first minute on it: deck A plays
// into channel 2 and out of the master; a wheel turn on channel 2's LOW knob kills the bass and a double-click puts it
// back; filter 1 assigned and swept shut all but silences the channel; the crossfader slammed to Y drops A (on X) out of the
// master until its assign goes to THRU. On a phone the booth doesn't scroll sideways and both filters' sweep knobs are on screen.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromePath, launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";

setDefaultTimeout(120_000);
let chrome: Awaited<ReturnType<typeof launchChrome>>;
let vite: Awaited<ReturnType<typeof startVite>>;
const hasChrome = !!chromePath();
beforeAll(async () => {
  if (!hasChrome) return;
  const app = join(import.meta.dir, "..");
  if (!existsSync(join(app, ".rustybuns/vite.ts"))) {
    const made = Bun.spawnSync(["bunx", "rustybuns", "boundary"], { cwd: app, stdout: "pipe", stderr: "pipe" });
    if (made.exitCode !== 0) throw new Error(`rustybuns boundary: ${made.stderr.toString()}`);
  }
  [chrome, vite] = await Promise.all([launchChrome(["--disable-audio-output", "--autoplay-policy=no-user-gesture-required"]), startVite(app)]);
});
afterAll(() => { chrome?.stop(); vite?.stop(); });

test.skipIf(!hasChrome)("deck A through channel 2: kill, filter, crossfader assign; both filters in reach on a phone", async () => {
  const tab = await openTab(chrome.cdp, { w: 1280, h: 860 });
  await load(chrome.cdp, tab, `${vite.url}/decks.html`, 0);
  const page = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
  const until = async (what: string, expr: string, ms = 30_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(50)) if (await page(expr).catch(() => false)) return;
    throw new Error(`never saw ${what}; state: ${JSON.stringify(await page("window.qdecks?.state()").catch(() => null))}`);
  };
  /** The loudest a meter reads over 400 ms: `which` is "channels[1]" or "master[0]". */
  const loudest = (which: string) => page<number>(`(async () => { let m = 0; for (let i = 0; i < 20; i++) { m = Math.max(m, qdecks.state().meters.${which}); await new Promise((r) => setTimeout(r, 20)); } return m; })()`);
  const centre = (sel: string) => page<{ x: number; y: number }>(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);

  await until("the decks", "!!window.qdecks");
  await page("qdecks.start()");
  await until("the demo tracks on", "qdecks.state().decks.every((d) => d.name)");
  const s0 = await page<{ channels: { xf: string }[] }>("qdecks.state()");
  expect(s0.channels.map((c) => c.xf)).toEqual(["off", "x", "y", "off"]);
  await page("qdecks.play(0)");
  await until("A in channel 2 and the master", "qdecks.state().meters.channels[1] > 0.05 && qdecks.state().meters.master[0] > 0.05");
  expect(await loudest("channels[2]")).toBeLessThan(0.01); // B isn't playing

  // the LOW knob on channel 2, by the wheel: down to a kill; a double-click puts it back to the middle
  const low = await centre('.mx-dial[aria-label^="LOW:"][aria-label$="channel 2"]');
  for (let i = 0; i < 45; i++) await tab.call("Input.dispatchMouseEvent", { type: "mouseWheel", x: low.x, y: low.y, deltaX: 0, deltaY: 100 });
  expect(await page<number>("qdecks.state().channels[1].low")).toBe(-1);
  for (const clickCount of [1, 2]) for (const type of ["mousePressed", "mouseReleased"]) await tab.call("Input.dispatchMouseEvent", { type, x: low.x, y: low.y, button: "left", clickCount });
  await until("LOW back in the middle", "qdecks.state().channels[1].low === 0");

  // filter 1 on channel 2, a low-pass swept all the way down: the channel drops to under a quarter, and comes back off
  const open = await loudest("channels[1]");
  await page(`(qdecks.assignFilter(1, 1), qdecks.filter(0, { on: true, types: ["lp"], freq: 0, res: 0 }))`);
  await until("the low-pass shut", "qdecks.state().filters[0].on");
  await Bun.sleep(200);
  expect(await loudest("channels[1]")).toBeLessThan(open / 4);
  await page("qdecks.filter(0, { on: false })");
  await until("the filter off", "qdecks.state().meters.channels[1] > 0.05");

  // the crossfader to Y: A (on X) leaves the master; on THRU it's back whatever the crossfader says
  await page("qdecks.cross(1)");
  await Bun.sleep(200);
  expect(await loudest("master[0]")).toBeLessThan(0.01);
  await page(`qdecks.assignX(1, "off")`);
  await until("A back in the master on THRU", "qdecks.state().meters.master[0] > 0.05");
  await until("THRU lit on channel 2 (the face draws on the next frame)", `document.querySelector(".mx-strip:nth-child(2) .mx-x button:nth-child(2)").classList.contains("on")`);

  // a phone: the mixer takes the width (its strips scroll inside it if they must), the booth never sideways
  const phone = await openTab(chrome.cdp, { w: 390, h: 844 }, true);
  await load(chrome.cdp, phone, `${vite.url}/decks.html`, 0);
  for (const end = Date.now() + 30_000; Date.now() < end && !(await phone.eval<boolean>("!!window.qdecks").catch(() => false)); ) await Bun.sleep(50);
  await phone.eval("qdecks.start()");
  await Bun.sleep(300);
  const fit = await phone.eval<{ dj: number; djW: number; freq: number[][] }>(`(() => { const d = document.getElementById("dj"); return { dj: d.scrollWidth, djW: d.clientWidth, freq: [...document.querySelectorAll(".mx-l .mx-dial")].map((k) => { const r = k.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; }) }; })()`);
  expect(fit.dj).toBeLessThanOrEqual(fit.djW + 1);
  expect(fit.freq.length).toBe(2);
  for (const [l, r] of fit.freq) { expect(l).toBeGreaterThanOrEqual(0); expect(r).toBeLessThanOrEqual(390); }
});
