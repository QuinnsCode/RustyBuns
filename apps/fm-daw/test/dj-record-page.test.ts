// REC on the QDJ decks in headless Chrome on /decks.html: a set of the two demo tracks (deck A at 124, then deck B at
// 128 brought in on the crossfader) is recorded from the master. The take decodes, its first half has A's tempo and
// its second half B's, and the track list names both with the time each came in.
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
  expect(take.bpm[0]).toBeCloseTo(124, 0);
  expect(take.bpm[1]).toBeCloseTo(128, 0);
  expect(take.cues.map((c) => [c.side, c.name])).toEqual([[0, "Night drive (124)"], [1, "Dune runner (128)"]]);
  expect(take.cues[0]!.at).toBeLessThan(0.5);
  expect(take.cues[1]!.at).toBeGreaterThan(4.5);
  expect(take.cues[1]!.at).toBeLessThan(6);
  expect(take.list).toMatch(/0:00 {2}A {2}Night drive \(124\)\n0:0[56] {2}B {2}Dune runner \(128\)/);
  expect(await page<boolean>(`document.querySelector("#dj .dj-rec").classList.contains("on")`)).toBe(false);
});
