// The QDJ decks in headless Chrome on /decks.html, a DJ's set on deck A: LOOP IN, LOOP OUT, and it plays round; OUT
// again and the jog stretches the loop clockwise and shortens it back; OUT once more is done, RELOOP plays on out of
// it. Then +8% with master tempo on still sounds (the stretch in the deck's worklet), filter 1's LFO keeps to deck A's
// beat, and with the BRAKE knob up, pause coasts the record to a stop instead of cutting it.
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

type Deck = { playing: boolean; pos: number; rate: number; speed: number; loop: { start: number; end: number } | null; loopIn: number | null; adjust: string | null; grid: { bpm: number; offset: number } | null };

test.skipIf(!hasChrome)("deck A: loop in and out, the jog stretching the loop, master tempo, the LFO on the beat, the brake", async () => {
  const tab = await openTab(chrome.cdp, { w: 1280, h: 900 });
  await load(chrome.cdp, tab, `${vite.url}/decks.html`, 0);
  const page = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
  const until = async (what: string, expr: string, ms = 30_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(50)) if (await page(expr).catch(() => false)) return;
    throw new Error(`never saw ${what}; state: ${JSON.stringify(await page("window.qdecks?.state()?.decks").catch(() => null))}`);
  };
  const a = () => page<Deck>("qdecks.state().decks[0]");
  const loudest = () => page<number>(`(async () => { let m = 0; for (let i = 0; i < 20; i++) { m = Math.max(m, qdecks.state().meters.channels[1]); await new Promise((r) => setTimeout(r, 20)); } return m; })()`);

  await until("the decks", "!!window.qdecks");
  await page("qdecks.start()");
  await until("the demo tracks on", "qdecks.state().decks.every((d) => d.name)");
  await page("(qdecks.quantize(false), qdecks.play(0))");
  await until("A sounding through its worklet", "qdecks.state().meters.channels[1] > 0.05");

  // IN, then OUT 0.6 s later: it plays round inside the loop
  await page("qdecks.loopIn(0)");
  expect((await a()).loopIn).not.toBeNull();
  await Bun.sleep(600);
  await page("qdecks.loopOut(0)");
  const l = (await a()).loop!;
  expect(l.end - l.start).toBeGreaterThan(0.4);
  await Bun.sleep(1500);
  const inside = await a();
  expect(inside.pos).toBeGreaterThanOrEqual(l.start - 0.01);
  expect(inside.pos).toBeLessThanOrEqual(l.end + 0.01);

  // OUT again: the jog moves the out point, clockwise longer (half a second a turn), back shorter
  await page("qdecks.loopOut(0)");
  expect((await a()).adjust).toBe("out");
  await page(`qdecks.turn(0, "ring", 0.5)`);
  expect((await a()).loop!.end).toBeCloseTo(l.end + 0.25, 3);
  await page(`qdecks.turn(0, "top", -0.2)`);
  expect((await a()).loop!.end).toBeCloseTo(l.end + 0.15, 3);
  expect((await a()).playing).toBe(true); // the platter moved the loop, it didn't stop the record
  // OUT on the face once more: done; RELOOP: out of the loop and on
  await page(`document.querySelector(".dj-a .dj-loopio button:nth-child(2)").click()`);
  expect((await a()).adjust).toBeNull();
  await page("qdecks.reloop(0)");
  expect((await a()).loop).toBeNull();

  // +8% with master tempo: still the deck's sound in channel 2, at 1.08
  await page("(qdecks.range(0, 8), qdecks.pitch(0, 1), qdecks.keylock(0, true))");
  await Bun.sleep(300);
  expect((await a()).rate).toBeCloseTo(1.08, 3);
  expect(await loudest()).toBeGreaterThan(0.05);

  // filter 1's LFO follows deck A: its tempo, and a round starts on a downbeat (4 beats a round)
  const lfo = await page<{ deck: Deck; lfo: { phase: number; bpm: number }[] }>("({ deck: qdecks.state().decks[0], lfo: qdecks.lfo() })");
  const g = lfo.deck.grid!;
  expect(lfo.lfo[0]!.bpm).toBeCloseTo(g.bpm * 1.08, 1);
  const want = ((((lfo.deck.pos - g.offset) * g.bpm) / 60 / 4) % 1 + 1) % 1;
  expect(Math.abs(((lfo.lfo[0]!.phase - want + 1.5) % 1) - 0.5)).toBeLessThan(0.05);

  // the BRAKE knob halfway is a 1 s brake: pause, and the record coasts on, slowing, to a stop
  await page(`qdecks.ramp(0, "brake", 0.5)`);
  const before = await a();
  await page("qdecks.play(0)");
  const braking = await a();
  expect(braking.playing).toBe(false);
  expect(braking.speed).toBeGreaterThan(0.5);
  await Bun.sleep(1400);
  const stopped = await a();
  expect(stopped.speed).toBe(0);
  // 1.08 coasting to 0 over a second covers about 0.54 s of track
  expect(stopped.pos - before.pos).toBeGreaterThan(0.4);
  expect(stopped.pos - before.pos).toBeLessThan(0.8);
});
