// The decks as club media players (src/dj/player-panel.ts), in headless Chrome over CDP: open /decks.html, play deck
// A, grab the top platter and drag it back (the track stops under the hand, scratches back, plays on when let go),
// spin the side ring (a nudge that lets go), switch to CD (the platter only nudges now), hold CUE stopped (plays from
// the mark, back on letting go), and zoom the close-up right in. Then the arithmetic under it: a MIDI jog's messages,
// and the close-up's bars, which stay a screen's worth at every zoom so it draws at 60 fps on a long track. Then the
// nudge (a tap a press, the 10x one held), a hand on the waveform holding the track like a record, a key of your own
// from Settings (src/dj/prefs.ts), and the waveform's colours: a kick at the bass end, a clap at the highs.
import { expect, setDefaultTimeout, test } from "bun:test";
import { load, openTab } from "../../../scripts/chrome.ts";
import { chrome, hasChrome, useBrowser, vite, waitFor } from "./browser-kit.ts";
import { bars, BEND_MAX, midiJog, peakLevels, TICKS_PER_TURN, toneOf, ZOOMS } from "../src/dj/player.ts";
import { actionOf, bindKey, DEFAULT_PREFS, Prefs } from "../src/dj/prefs.ts";
import { check } from "@rustybuns/util/guard";

setDefaultTimeout(120_000); // vite serves the decks page cold, then plays audio in headless Chrome
useBrowser();

interface Deck { playing: boolean; pos: number; rate: number; cue: number }
interface Player { mode: "vinyl" | "cd"; touched: boolean; bend: number }

test.skipIf(!hasChrome)("a night on the club players: scratch, nudge, CD mode, cue, and the close-up's zoom", async () => {
  const tab = await openTab(chrome.cdp, { w: 1280, h: 900 });
  await load(chrome.cdp, tab, `${vite.url}decks.html`, 0);
  const page = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
  const until = (what: string, expr: string, ms?: number) => waitFor(tab, what, expr, ms, "window.qdecks?.state()");
  const mouse = (type: string, x: number, y: number) => tab.call("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
  const centre = (sel: string) => page<{ x: number; y: number; r: number }>(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, r: b.width / 2 }; })()`);
  const deck = () => page<Deck>("qdecks.state().decks[0]");
  const player = () => page<Player>("qdecks.state().players[0]");
  /** Grab deck A's wheel at `at` of its radius, drag `turns` round (negative: anticlockwise, back), let go; `down` runs with the hand on it, before it moves. */
  const drag = async (at: number, turns: number, during?: () => Promise<void>, down?: () => Promise<void>) => {
    const w = await centre(".dj-a .dj-wheel"), steps = 16, r = w.r * at, a0 = -Math.PI / 2;
    await mouse("mousePressed", w.x + Math.cos(a0) * r, w.y + Math.sin(a0) * r);
    await down?.();
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
  // measured from where the hand stopped it: read any earlier, a slow runner's playhead has moved on by the touch
  await drag(0.4, -0.25, async () => { held = await deck(); heldBy = await player(); }, async () => { before = (await deck()).pos; });
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

test.skipIf(!hasChrome)("the nudge, a hand on the waveform, and a key of your own", async () => {
  const tab = await openTab(chrome.cdp, { w: 1280, h: 900 });
  await load(chrome.cdp, tab, `${vite.url}decks.html`, 0);
  const page = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
  const until = (what: string, expr: string, ms?: number) => waitFor(tab, what, expr, ms, "window.qdecks?.state()");
  const mouse = (type: string, x: number, y: number) => tab.call("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
  const click = async (sel: string) => { const b = await box(sel); await mouse("mousePressed", b.x, b.y); await mouse("mouseReleased", b.x, b.y); };
  const box = (sel: string) => page<{ x: number; y: number; w: number; h: number; top: number }>(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height, top: b.y }; })()`);
  const key = (type: "keyDown" | "keyUp", code: string, autoRepeat = false) => tab.call("Input.dispatchKeyEvent", { type, code, key: code.slice(3).toLowerCase(), autoRepeat });
  const deck = () => page<Deck & { speed: number }>("qdecks.state().decks[0]");

  const open = await box("#start button");
  await mouse("mousePressed", open.x, open.y); await mouse("mouseReleased", open.x, open.y);
  await until("the demo tracks", "qdecks.state()?.decks.every((d) => d.name)");
  await page("qdecks.prefs({ nudgeMs: 25, keys: {} })");

  // a tap of the nudge moves the stopped track 25 ms on, each press; a key held down is still one press
  const p0 = (await deck()).pos;
  await click(".dj-a .dj-nudge button:nth-child(3)"); await click(".dj-a .dj-nudge button:nth-child(3)");
  expect((await deck()).pos).toBeCloseTo(p0 + 0.05, 3);
  await key("keyDown", "KeyS"); await key("keyDown", "KeyS", true); await key("keyDown", "KeyS", true); await key("keyUp", "KeyS");
  expect((await deck()).pos).toBeCloseTo(p0 + 0.075, 3);

  // the 10x nudge held: playing, the deck runs 250 ms a second fast (the jog's most) until it's let go
  await page("qdecks.play(0)");
  const fast = await box(".dj-a .dj-nudge button:nth-child(4)");
  await mouse("mousePressed", fast.x, fast.y);
  expect((await deck()).rate).toBeCloseTo(1 + BEND_MAX, 3);
  await mouse("mouseReleased", fast.x, fast.y);
  expect((await deck()).rate).toBe(1);

  // a hand on deck A's lane of the close-up holds the track; dragged a quarter of the way left it goes on half the
  // view's span; let go, it plays on
  const z = await box(".dj-zoom"), seconds = (await page<{ seconds: number }>("qdecks.state().zoom")).seconds;
  const y = z.top + z.h / 4;
  await mouse("mousePressed", z.x, y);
  const before = await deck();
  expect(before.playing).toBe(false);
  await mouse("mouseMoved", z.x - z.w / 4, y);
  expect((await deck()).pos - before.pos).toBeCloseTo(seconds / 2, 1);
  await mouse("mouseReleased", z.x - z.w / 4, y);
  expect((await deck()).playing).toBe(true);

  // Settings: nudge back on J instead of A, and J nudges back
  await page("qdecks.play(0)");
  await click(".dj-prefs-open");
  await click(".dj-prefs-keys button:nth-of-type(7)");
  await key("keyDown", "KeyJ"); await key("keyUp", "KeyJ");
  expect(await page<Record<string, string>>("qdecks.prefs().keys")).toEqual({ nudgeBackA: "KeyJ" });
  const p1 = (await deck()).pos;
  await key("keyDown", "KeyJ"); await key("keyUp", "KeyJ");
  expect((await deck()).pos).toBeCloseTo(p1 - 0.025, 3);
});

test("a kick sits at the bass end of the waveform's colours, a clap at the highs", () => {
  const rate = 48000, n = rate / 4, kick = new Float32Array(n), clap = new Float32Array(n);
  let seed = 1;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    seed = (seed * 16807) % 2147483647;
    kick[i] = Math.sin(2 * Math.PI * 55 * t) * Math.exp(-t * 8) * 0.9;
    clap[i] = ((seed / 2147483647) * 2 - 1) * Math.exp(-t * 20) * 0.5;
  }
  const tone = (m: Float32Array) => { const l = peakLevels(m, rate)[3]!; let sum = 0; for (let i = 0; i < 20; i++) sum += toneOf(l.lo[i]!, l.hi[i]!); return sum / 20; };
  expect(tone(kick)).toBeLessThan(0.2);
  expect(tone(clap)).toBeGreaterThan(0.8);
});

test("a key belongs to one action, and settings from an older page or by hand fall back to the defaults", () => {
  const p = bindKey(DEFAULT_PREFS, "nudgeBackA", "KeyQ");
  expect(actionOf(p, "KeyQ")).toBe("nudgeBackA");
  expect(actionOf(p, "KeyA")).toBeNull(); // the old nudge key is free
  expect(actionOf(bindKey(p, "playA", "KeyQ"), "KeyQ")).toBe("playA"); // and back again
  expect(check(Prefs, { nudgeMs: 9999, wave: "neon" })).toBeNull();
  expect(check(Prefs, {})).toEqual(DEFAULT_PREFS);
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
