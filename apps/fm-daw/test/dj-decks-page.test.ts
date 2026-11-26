// The QDJ decks in headless Chrome on /decks.html, a DJ's set on deck A: LOOP IN, LOOP OUT, and it plays round; OUT
// again and the jog stretches the loop clockwise and shortens it back; OUT once more is done, RELOOP plays on out of
// it. Then +8% with master tempo on still sounds (the stretch in the deck's worklet), filter 1's LFO keeps to deck A's
// beat, and with the BRAKE knob up, pause coasts the record to a stop instead of cutting it.
import { expect, setDefaultTimeout, test } from "bun:test";
import { load, openTab } from "../../../scripts/chrome.ts";
import { chrome, hasChrome, useBrowser, vite, waitFor } from "./browser-kit.ts";

setDefaultTimeout(120_000); // vite serves the decks page cold, then plays audio in headless Chrome
useBrowser("--autoplay-policy=no-user-gesture-required");

type Deck = { playing: boolean; pos: number; rate: number; speed: number; loop: { start: number; end: number } | null; loopIn: number | null; adjust: string | null; grid: { bpm: number; offset: number } | null };

test.skipIf(!hasChrome)("deck A: loop in and out, the jog stretching the loop, master tempo, the LFO on the beat, the brake", async () => {
  const tab = await openTab(chrome.cdp, { w: 1280, h: 900 });
  await load(chrome.cdp, tab, `${vite.url}/decks.html`, 0);
  const page = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
  const until = (what: string, expr: string, ms?: number) => waitFor(tab, what, expr, ms, "window.qdecks?.state()?.decks");
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
  await tab.close();
});

test.skipIf(!hasChrome)("loading tracks: deck B's upload button, a drop on lane A, then a folder into the library", async () => {
  const tab = await openTab(chrome.cdp, { w: 1280, h: 900 });
  await load(chrome.cdp, tab, `${vite.url}/decks.html`, 0);
  const page = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
  const until = (what: string, expr: string, ms?: number) => waitFor(tab, what, expr, ms, "({ decks: qdecks.state()?.decks.map((d) => d.name), library: qdecks.state()?.library, waiting: qdecks.state()?.waiting })");
  await until("the decks", "!!window.qdecks");
  await page("qdecks.start()");
  await until("the demo tracks on", "qdecks.state().decks.every((d) => d.name)");
  // a second of clicks as a WAV file, the way a file from this computer comes in
  await page(`(window.wav = (name) => {
    const rate = 22050, n = rate, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
    const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, i % 5512 < 400 ? Math.sin(i * 0.3) * 12000 : 0, true);
    return new File([b], name, { type: "audio/wav" });
  }, window.give = (input, files) => { const dt = new DataTransfer(); for (const f of files) dt.items.add(f); input.files = dt.files; input.dispatchEvent(new Event("change")); }, true)`);

  // deck B's upload button, then the file it asks for: onto B
  await page(`(document.querySelector(".dj-b .dj-load").click(), give(document.querySelector('#dj input[type=file]:not([multiple])'), [wav("bee.wav")]), true)`);
  await until("bee.wav on deck B", `qdecks.state().decks[1].name === "bee.wav"`);
  // a file dropped on the close-up's top lane: onto A
  await page(`(() => { const z = document.querySelector(".dj-zoom"), r = z.getBoundingClientRect(), dt = new DataTransfer(); dt.items.add(wav("ay.wav")); z.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, clientX: r.left + 50, clientY: r.top + 5, bubbles: true, cancelable: true })); return true; })()`);
  await until("ay.wav on deck A", `qdecks.state().decks[0].name === "ay.wav"`);

  // a folder: its tracks read into the library (both decks are full, so they wait there), the cover art left out
  await page(`(give(document.querySelector("#dj input[webkitdirectory]"), [wav("02 two.wav"), wav("01 one.wav"), new File(["x"], "cover.jpg", { type: "image/jpeg" }), wav("03 three.wav")]), true)`);
  await until("the folder in the library", `["01 one.wav", "02 two.wav", "03 three.wav"].every((n) => qdecks.state().library.includes(n)) && !qdecks.state().waiting.reading`);
  const s = await page<{ library: string[]; waiting: { names: string[] } }>("qdecks.state()");
  expect(s.library).not.toContain("cover.jpg");
  expect(s.library.indexOf("01 one.wav")).toBeLessThan(s.library.indexOf("02 two.wav"));
  expect(s.waiting.names).toEqual([]);
  await tab.close();
});

test.skipIf(!hasChrome)("a flick of deck A's close-up coasts on and slows to a stop; a drag let go still stops dead; a new press stops the coast", async () => {
  const tab = await openTab(chrome.cdp, { w: 1280, h: 900 });
  await load(chrome.cdp, tab, `${vite.url}/decks.html`, 0);
  const page = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
  await waitFor(tab, "the demo tracks", "window.qdecks?.start()?.decks.every((d) => d.length)");
  await page(`(window.hand = ${HAND}, true)`);
  // the coast runs on the page's frames: a starved runner gets a clear word, not a wrong position
  const frames = await page<number>("new Promise((k) => { let n = 0; const f = () => (++n < 10 ? requestAnimationFrame(f) : k(n)); requestAnimationFrame(f); setTimeout(() => k(n), 3000); })");
  expect(frames, "the page drew no frames in 3 s").toBe(10);
  type Seen = { moved: number; coasting: boolean; touched: boolean }[];
  for (const grab of ["vinyl", "slide"]) {
    // a hard flick left (on): it keeps going after the hand lets go, then settles inside a second and lets go of the platter
    const flick = await page<Seen>(`hand("${grab}", 8, -30, 0)`);
    const coasted = flick.filter((x) => x.coasting), end = flick.at(-1)!;
    expect(coasted.length).toBeGreaterThan(0);
    expect(end.moved).toBeGreaterThan(coasted[0]!.moved);
    expect(end).toMatchObject({ coasting: false, touched: false });
    expect(end.moved).toBeCloseTo(flick.at(-3)!.moved, 3);
    // the same drag, held still before letting go: no coast, the deck stays where the hand left it
    const still = await page<Seen>(`hand("${grab}", 8, -30, 150)`);
    expect(still.every((s) => !s.coasting && Math.abs(s.moved) < 1e-6)).toBe(true);
  }
  // a fresh press on the lane catches a coasting deck at once
  expect(await page<boolean>(`(async () => { qdecks.flick(0, -3000); await new Promise((k) => setTimeout(k, 80)); const z = document.querySelector(".dj-zoom"), r = z.getBoundingClientRect(), at = { pointerId: 8, clientX: r.left + 100, clientY: r.top + 5, bubbles: true }; z.dispatchEvent(new PointerEvent("pointerdown", at)); const c = qdecks.state().coasting[0]; z.dispatchEvent(new PointerEvent("pointerup", at)); return c; })()`)).toBe(false);
});

test.skipIf(!hasChrome)("deck A's overview: paused, a click puts the track there and a drag scrubs it; playing, a press leaves it be", async () => {
  const tab = await openTab(chrome.cdp, { w: 1280, h: 900 });
  await load(chrome.cdp, tab, `${vite.url}/decks.html`, 0);
  const page = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
  await waitFor(tab, "the demo tracks", "window.qdecks?.start()?.decks.every((d) => d.length)");
  // a hand on deck A's overview at each fraction of its width in turn (down on the first, up after the last); deck A's spot after
  await page(`(window.over = async (...xs) => {
    const c = document.querySelector(".dj-a .dj-over"), r = c.getBoundingClientRect(), y = r.top + r.height / 2;
    const fire = (type, f) => c.dispatchEvent(new PointerEvent(type, { pointerId: 9, clientX: r.left + r.width * f, clientY: y, bubbles: true, cancelable: true }));
    xs.forEach((f, i) => fire(i ? "pointermove" : "pointerdown", f));
    fire("pointerup", xs.at(-1));
    await new Promise((k) => setTimeout(k, 50));
    const d = qdecks.state().decks[0];
    return d.pos / d.length;
  }, true)`);
  expect(await page<number>("over(0.5)")).toBeCloseTo(0.5, 1);
  expect(await page<number>("over(0.2, 0.4, 0.7)")).toBeCloseTo(0.7, 1);
  await page("qdecks.play(0)");
  await waitFor(tab, "deck A playing", "qdecks.state().decks[0].playing", 5000);
  const before = await page<number>("qdecks.state().decks[0].pos / qdecks.state().decks[0].length");
  const after = await page<number>("over(0.1, 0.2)");
  expect(Math.abs(after - before)).toBeLessThan(0.05);
  await tab.close();
});

/** A hand on deck A's lane of the close-up: down, `moves` drags of `dx` px 10 ms apart, `rest` ms still, up; then deck A over the next 2.5 s. */
const HAND = `async (grab, moves, dx, rest) => {
  qdecks.prefs({ grab });
  const z = document.querySelector(".dj-zoom"), r = z.getBoundingClientRect(), y = r.top + r.height / 4, wait = (ms) => new Promise((k) => setTimeout(k, ms));
  let x = r.left + r.width * 0.8;
  const fire = (type) => z.dispatchEvent(new PointerEvent(type, { pointerId: 7, clientX: x, clientY: y, bubbles: true, cancelable: true }));
  fire("pointerdown");
  for (let i = 0; i < moves; i++) { await wait(10); x += dx; fire("pointermove"); }
  await wait(rest); fire("pointerup");
  const at = () => qdecks.state().decks[0].pos, p0 = at(), seen = [];
  for (let t = 0; t < 2500; t += 100) { await wait(100); seen.push({ moved: at() - p0, coasting: qdecks.state().coasting[0], touched: qdecks.state().players[0].touched }); }
  return seen;
}`;
