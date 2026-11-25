// REC on the QDJ decks in headless Chrome on /decks.html: a set of the two demo tracks (deck A at 124, then deck B at
// 128 brought in on the crossfader) is recorded from the master. The take decodes, its first half has A's tempo and
// its second half B's, and the track list names both with the time each came in. Then the set out and a line in
// through the sound card (Chrome's fake one): the master plays to an output, and an input sounds on channel 1.
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
  [chrome, vite] = await Promise.all([launchChrome(["--disable-audio-output", "--autoplay-policy=no-user-gesture-required", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"]), startVite(app)]);
});
afterAll(() => { chrome?.stop(); vite?.stop(); });

type Take = { type: string; bytes: number; seconds: number; decoded: number; cues: { at: number; side: number; name: string }[]; list: string; name: string; bpm: (number | null)[] };

test.skipIf(!hasChrome)("record ten seconds of a two-track set: both tracks' sound and the track list", async () => {
  const tab = await openTab(chrome.cdp, { w: 1280, h: 900 });
  await load(chrome.cdp, tab, `${vite.url}/decks.html`, 0);
  const page = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
  const until = async (what: string, expr: string, ms = 30_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(50)) if (await page(expr).catch(() => false)) return;
    throw new Error(`never saw ${what}`);
  };
  await until("the decks", "!!window.qdecks");
  await page("qdecks.start()");
  await until("the demo tracks on", "qdecks.state().decks.every((d) => d.name)");
  await page("(qdecks.quantize(false), qdecks.cross(-1), qdecks.play(0))");
  await until("A sounding", "qdecks.state().meters.channels[1] > 0.05");

  // REC by its button; A alone for five seconds, then B in on the crossfader and A stopped
  await page(`document.querySelector("#dj .dj-rec").click()`);
  await until("recording", `document.querySelector("#dj .dj-rec").classList.contains("on")`);
  await Bun.sleep(5000);
  await page("(qdecks.play(1), qdecks.cross(1), qdecks.play(0))");
  await Bun.sleep(5000);
  const take = (await page<Take>("qdecks.record(false, [[0.5, 4.5], [5.8, 9.8]])"))!;

  expect(take.seconds).toBeGreaterThan(9.5);
  expect(take.decoded).toBeGreaterThan(9);
  // tempo read off ~4 s of recorded sound lands within a beat-per-minute (CI read 127.5 for the 128 track)
  expect(Math.abs(take.bpm[0] - 124)).toBeLessThan(1);
  expect(Math.abs(take.bpm[1] - 128)).toBeLessThan(1);
  expect(take.cues.map((c) => [c.side, c.name])).toEqual([[0, "Night drive (124)"], [1, "Dune runner (128)"]]);
  expect(take.cues[0]!.at).toBeLessThan(0.5);
  expect(take.cues[1]!.at).toBeGreaterThan(4.5);
  expect(take.cues[1]!.at).toBeLessThan(6);
  expect(take.list).toMatch(/0:00 {2}A {2}Night drive \(124\)\n0:0[56] {2}B {2}Dune runner \(128\)/);
  expect(await page<boolean>(`document.querySelector("#dj .dj-rec").classList.contains("on")`)).toBe(false);
});

test.skipIf(!hasChrome)("the sound card: the master out to an output, a line in on channel 1 from the Audio in and out panel", async () => {
  const tab = await openTab(chrome.cdp, { w: 1280, h: 900 });
  await load(chrome.cdp, tab, `${vite.url}/decks.html`, 0);
  const page = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
  for (const end = Date.now() + 30_000; Date.now() < end && !(await page<boolean>("!!window.qdecks").catch(() => false)); await Bun.sleep(50));
  await page("qdecks.start()");
  const { inputs, outputs } = await page<{ inputs: { id: string }[]; outputs: { id: string }[] }>("qdecks.io.devices(true)");
  expect(inputs.length).toBeGreaterThan(0);

  // the panel: pick the first input for channel 1, as a DJ does
  await page(`document.querySelector("#dj .dj-io-open").click()`);
  for (const end = Date.now() + 5000; Date.now() < end && !(await page<boolean>(`document.querySelectorAll("#dj .dj-io-pick").length >= 2`)); await Bun.sleep(50));
  await page(`(() => { const s = document.querySelector('#dj .dj-io-pick[aria-label="Line in to channel 1"]'); s.value = ${JSON.stringify(inputs[0]!.id)}; s.dispatchEvent(new Event("change")); })()`);
  const loudest = await page<number>(`(async () => { let m = 0; for (let i = 0; i < 150 && m < 0.01; i++) { m = Math.max(m, qdecks.state().meters.channels[0]); await new Promise((r) => setTimeout(r, 20)); } return m; })()`);
  expect(loudest).toBeGreaterThan(0.01);
  expect(await page<Record<string, string>>("qdecks.io.state().ins")).toEqual({ 0: inputs[0]!.id });

  // the master to an output, and off again
  const out = outputs[0]?.id ?? "default";
  expect(await page<boolean>(`qdecks.io.out(${JSON.stringify(out)})`)).toBe(true);
  expect(await page<{ out: string; playing: boolean }>("qdecks.io.state()")).toMatchObject({ out, playing: true });
  await page("qdecks.io.out(null)");
  await page("qdecks.io.lineIn(0, null)");
  expect(await page<unknown>("qdecks.io.state()")).toEqual({ out: null, playing: false, ins: {} });
});
