// The decks as club media players (src/dj/player-panel.ts), in headless Chrome over CDP: open /decks.html, play deck
// A, grab the top platter and drag it back (the track stops under the hand, scratches back, plays on when let go),
// spin the side ring (a nudge that lets go), switch to CD (the platter only nudges now), hold CUE stopped (plays from
// the mark, back on letting go), and zoom the close-up right in. Then the arithmetic under it: a MIDI jog's messages,
// and the close-up's bars, which stay a screen's worth at every zoom so it draws at 60 fps on a long track.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromePath, launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";
import { bars, midiJog, peakLevels, TICKS_PER_TURN, ZOOMS } from "../src/dj/player.ts";

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
  [chrome, vite] = await Promise.all([launchChrome(["--disable-audio-output"]), startVite(app)]);
});
afterAll(() => { chrome?.stop(); vite?.stop(); });

interface Deck { playing: boolean; pos: number; rate: number; cue: number }
interface Player { mode: "vinyl" | "cd"; touched: boolean; bend: number }

test.skipIf(!hasChrome)("a night on the club players: scratch, nudge, CD mode, cue, and the close-up's zoom", async () => {
  const tab = await openTab(chrome.cdp, { w: 1280, h: 900 });
  await load(chrome.cdp, tab, `${vite.url}decks.html`, 0);
  const page = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
  const until = async (what: string, expr: string, ms = 30_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(50)) if (await page(expr).catch(() => false)) return;
    throw new Error(`never saw ${what}; state: ${JSON.stringify(await page("window.qdecks?.state()").catch(() => null))}`);
  };
  const mouse = (type: string, x: number, y: number) => tab.call("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
  const centre = (sel: string) => page<{ x: number; y: number; r: number }>(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, r: b.width / 2 }; })()`);
  const deck = () => page<Deck>("qdecks.state().decks[0]");
  const player = () => page<Player>("qdecks.state().players[0]");
  /** Grab deck A's wheel at `at` of its radius, drag `turns` round (negative: anticlockwise, back), let go. */
  const drag = async (at: number, turns: number, during?: () => Promise<void>) => {
    const w = await centre(".dj-a .dj-wheel"), steps = 16, r = w.r * at, a0 = -Math.PI / 2;
    await mouse("mousePressed", w.x + Math.cos(a0) * r, w.y + Math.sin(a0) * r);
    for (let i = 1; i <= steps; i++) { const a = a0 + (turns * 2 * Math.PI * i) / steps; await mouse("mouseMoved", w.x + Math.cos(a) * r, w.y + Math.sin(a) * r); await Bun.sleep(10); }
    await during?.();
    await mouse("mouseReleased", w.x + Math.cos(a0 + turns * 2 * Math.PI) * r, w.y + Math.sin(a0 + turns * 2 * Math.PI) * r);
  };

  const open = await centre("#start button");
  await mouse("mousePressed", open.x, open.y); await mouse("mouseReleased", open.x, open.y);
  await until("the decks with the demo tracks", `qdecks.state()?.decks[0].name !== null && qdecks.state().decks[1].name !== null`);
  expect((await page<Player[]>("qdecks.state().players")).map((p) => p.mode)).toEqual(["vinyl", "vinyl"]);

  await page("qdecks.play(0)");
  await until("deck A two seconds in", "qdecks.state().decks[0].pos > 2");

  // VINYL: the hand on the platter stops the track and drags it back a quarter turn (0.45 s); let go, it plays on
  let held: Deck | null = null, heldBy: Player | null = null, before = 0;
  before = (await deck()).pos;
  await drag(0.4, -0.25, async () => { held = await deck(); heldBy = await player(); });
  expect(held!.playing).toBe(false);
  expect(heldBy!.touched).toBe(true);
  expect(held!.pos).toBeLessThan(before - 0.3);
  expect(held!.pos).toBeGreaterThan(before - 0.7);
  expect((await deck()).playing).toBe(true);

  // the side ring: a spin nudges the speed while it moves, and lets go after
  let nudged = 1;
  await drag(0.92, 0.3, async () => { nudged = (await deck()).rate; });
  expect(nudged).toBeGreaterThan(1);
  await until("the nudge let go", "qdecks.state().decks[0].rate === 1");

  // CD: the platter doesn't hold the track any more, it nudges
  await page(`qdecks.jogMode(0, "cd")`);
  let cdHeld: Deck | null = null;
  await drag(0.4, -0.2, async () => { cdHeld = await deck(); });
  expect(cdHeld!.playing).toBe(true);
  expect(cdHeld!.rate).toBeLessThan(1);

  // CUE playing: back to the mark and stop; held stopped: plays from the mark; let go: back to the mark
  await page("qdecks.cue(0, true)"); await page("qdecks.cue(0, false)");
  const marked = await deck();
  expect(marked.playing).toBe(false);
  expect(marked.pos).toBeCloseTo(marked.cue, 2);
  const cue = await centre(".dj-a .dj-cue");
  await mouse("mousePressed", cue.x, cue.y);
  await Bun.sleep(400);
  expect((await deck()).playing).toBe(true);
  expect((await deck()).pos).toBeGreaterThan(marked.cue + 0.2);
  await mouse("mouseReleased", cue.x, cue.y);
  expect(await deck()).toMatchObject({ playing: false, pos: marked.cue });

  // the close-up's zoom, from the buttons over it
  const start = await page<{ at: number }>("qdecks.state().zoom");
  const zin = await centre(`.dj-zoombar button[title="Zoom the waveform in"]`);
  await mouse("mousePressed", zin.x, zin.y); await mouse("mouseReleased", zin.x, zin.y);
  expect((await page<{ at: number }>("qdecks.state().zoom")).at).toBe(start.at - 1);
});

test("a MIDI jog's touch and turns, deck by MIDI channel", () => {
  const cases: [number[], ReturnType<typeof midiJog>][] = [
    [[0x90, 54, 127], { side: 0, touch: true }],
    [[0x91, 54, 0], { side: 1, touch: false }],
    [[0x80, 54, 0], { side: 0, touch: false }],
    [[0xb0, 34, 3], { side: 0, part: "top", turns: 3 / TICKS_PER_TURN }],
    [[0xb1, 33, 126], { side: 1, part: "ring", turns: -2 / TICKS_PER_TURN }],
    [[0xb0, 34, 0], null],
    [[0xb2, 34, 3], null],
    [[0xb0, 7, 100], null],
  ];
  for (const [msg, want] of cases) expect(midiJog(msg)).toEqual(want);
});

test("the close-up draws about a screen's worth of bars at every zoom, from a five-minute track", () => {
  const rate = 44100, mono = new Float32Array(rate * 300);
  for (let i = 0; i < mono.length; i++) mono[i] = Math.sin(i / 20) * ((i % rate) < rate / 8 ? 1 : 0.2);
  const levels = peakLevels(mono, rate), w = 1200;
  for (const span of ZOOMS) {
    let n = 0, lastX = -Infinity, loud = 0;
    bars(levels, 150, span, w, (x, _bw, v) => { n++; expect(x).toBeGreaterThan(lastX); lastX = x; loud = Math.max(loud, v); });
    expect(n).toBeGreaterThan(w / 4);
    expect(n).toBeLessThanOrEqual(w + 2);
    expect(loud).toBeGreaterThan(0.9);
  }
});
