// A DJ plugs a controller into the decks on /decks.html: its jog plays deck B's wheel out of the box, the connections
// show as tags over the decks without moving anything, a click on the mixer's channel 2 fader and a move of a fader on
// the controller pairs them (kept across a reload), a knob and a pad pair the same way, the tag's x forgets a pairing,
// and pulling the controller out shows it gone.
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

type Midi = { devices: { name: string; connected: boolean }[]; mappings: Record<string, Record<string, string>>; shown: boolean; armed: string | null; tags: string[] };

test.skipIf(!hasChrome)("a controller: the jog out of the box, tags that move nothing, learn a fader, a knob and a pad, forget one, unplug", async () => {
  const tab = await openTab(chrome.cdp, { w: 1280, h: 720 });
  const page = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
  const until = async (what: string, expr: string, ms = 30_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(50)) if (await page(expr).catch(() => false)) return;
    throw new Error(`never saw ${what}`);
  };
  const open = async () => {
    await load(chrome.cdp, tab, `${vite.url}/decks.html`, 0);
    await until("the decks", "!!window.qdecks");
    await page("qdecks.start()");
    await until("the demo tracks on", "qdecks.state().decks.every((d) => d.name)");
  };
  const midi = () => page<Midi>("qdecks.state().midi");
  const send = (bytes: number[]) => page(`qdecks.midi.feed("DDJ-400", ${JSON.stringify(bytes)})`);
  const id = (starts: string, has = "") => page<string>(`qdecks.midi.controls().find((c) => c.id.startsWith(${JSON.stringify(starts)}) && c.id.includes(${JSON.stringify(has)})).id`);

  await open();
  await page("localStorage.removeItem('qdj.midi.map')");
  // out of the box: channel 2's ring CC turns deck B's wheel
  await send([0xb1, 33, 16]);
  expect(await page<number>("qdecks.state().decks[1].pos")).toBeGreaterThan(0);
  expect((await midi()).devices).toEqual([{ name: "DDJ-400", connected: true }]);

  // the tags float: every box on the decks and the mixer stays where it was
  const boxes = `[...document.querySelectorAll(".dj-deck *, .mx *")].map((e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].join(); })`;
  const before = await page<string[]>(boxes);
  await page("qdecks.midi.show(true)");
  await Bun.sleep(100);
  expect(await page<string[]>(boxes)).toEqual(before);
  expect(await page<string[]>("[...document.querySelectorAll('.dj-midi-tag')].map((t) => t.textContent)")).toEqual(["DDJ-400 · CC 33/34, Note 54 ch1", "DDJ-400 · CC 33/34, Note 54 ch2"]);

  // a click on channel 2's fader picks it; the controller's next move pairs it and is not played
  await page(`document.querySelector('.mx [aria-label="Channel 2 fader"]').dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))`);
  expect((await midi()).armed).toBe("mixer: Channel 2 fader");
  const fader = await page<number>("qdecks.state().channels[1].fader");
  await send([0xb1, 19, 0]);
  expect(await page<number>("qdecks.state().channels[1].fader")).toBe(fader);
  await send([0xb1, 19, 127]);
  expect(await page<number>("qdecks.state().channels[1].fader")).toBe(1);

  // a knob (channel 2's HI) and deck A's play pad, through the probe's learn
  const hi = await id("mixer: HI", "channel 2"), play = await id("A: Play");
  await page(`qdecks.midi.learn(${JSON.stringify(hi)})`);
  await send([0xb1, 7, 0]);
  await send([0xb1, 7, 127]);
  expect(await page<number>("qdecks.state().channels[1].high")).toBeCloseTo(1, 2);
  await send([0xb1, 7, 0]);
  expect(await page<number>("qdecks.state().channels[1].high")).toBeCloseTo(-1, 2);
  await page(`qdecks.midi.learn(${JSON.stringify(play)})`);
  await send([0x90, 11, 127]);
  await send([0x90, 11, 127]);
  await send([0x80, 11, 0]);
  expect(await page<boolean>("qdecks.state().decks[0].playing")).toBe(true);
  expect((await midi()).mappings).toEqual({ "DDJ-400": { "cc:1:19": "mixer: Channel 2 fader", "cc:1:7": hi, "note:0:11": play } });

  // kept across a reload
  await open();
  await send([0xb1, 19, 0]);
  expect(await page<number>("qdecks.state().channels[1].fader")).toBe(0);

  // the tag's x forgets the fader; the controller pulled out shows gone
  await page("qdecks.midi.show(true)");
  await until("the fader's tag", "document.querySelectorAll('.dj-midi-forget').length === 2");
  await page(`[...document.querySelectorAll('.dj-midi-forget')].find((b) => b.title.includes("CC 19")).click()`);
  expect(Object.keys((await midi()).mappings["DDJ-400"]!)).toEqual(["cc:1:7", "note:0:11"]);
  await page(`qdecks.midi.plug("DDJ-400", false)`);
  expect((await midi()).devices).toEqual([{ name: "DDJ-400", connected: false }]);
  await until("the gone tag", "[...document.querySelectorAll('.dj-midi-tag')].some((t) => t.textContent.includes('(gone)'))");
});
