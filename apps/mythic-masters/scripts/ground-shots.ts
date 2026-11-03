// The ground, from where you stand: `bun scripts/ground-shots.ts <outdir> <label> [--perf]`. Walks to the Pine Barrens, a
// forest, the Southwest desert and the bayou at midday and shoots each twice, from the walking camera and from the
// ground (a metre up, looking along it), as <outdir>/<label>-<place>-<walk|ground>.jpg. With --perf, also times frames
// at phone size with the CPU 4x slower, in the walking camera at the same four places, and prints the percentiles.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";

const PLACES: [string, number][] = [["pine-barrens", 1], ["forest", 3], ["desert", 6], ["bayou", 7]];
const argv = process.argv.slice(2);
const [dir, label = "now"] = argv.filter((a) => !a.startsWith("--"));
if (!dir) { console.error("usage: bun scripts/ground-shots.ts <outdir> <label> [--perf]"); process.exit(2); }
const out = resolve(dir);
mkdirSync(out, { recursive: true });
const vite = await startVite(resolve(import.meta.dir, ".."));
const { cdp, stop } = await launchChrome();
const pct = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(xs.length * p))]!;
try {
  for (const phone of argv.includes("--perf") ? [false, true] : [false]) {
    const tab = await openTab(cdp, phone ? { w: 390, h: 844 } : { w: 1280, h: 720 }, phone);
    if (phone) await tab.call("Emulation.setCPUThrottlingRate", { rate: 4 });
    await load(cdp, tab, `${vite.url}?world=1&a=jackalope`, 2500);
    await tab.eval(`(() => { const w = mythicMasters.world; for (const n of [1, 2, 3, 6, 7]) w.beat(n); w.setHour(11); w.setWeather({ rain: 0, snow: 0, mist: 0 }); })()`);
    for (const [place, n] of PLACES) {
      await tab.eval(`mythicMasters.world.travel(${n}); mythicMasters.director.cut()`);
      for (const view of phone ? ["walk"] : ["walk", "ground"]) {
        await tab.eval(`mythicMasters.world.eye(${view === "walk" ? "null" : "{ back: 3, up: 1.1, look: 0.7 }"})`);
        await Bun.sleep(phone ? 6000 : 4500);
        // a piece that has just opened rises under a high camera shot: wait for it to hand the camera back
        for (let i = 0; i < 40 && await tab.eval<boolean>("mythicMasters.world.state().shot"); i++) await Bun.sleep(500);
        if (phone) {
          const ms = await tab.eval<number[]>(`new Promise((ok) => { const t: number[] = []; let last = performance.now(); const f = () => { const now = performance.now(); t.push(now - last); last = now; t.length < 90 ? requestAnimationFrame(f) : ok(t.slice(5).sort((a, b) => a - b)); }; requestAnimationFrame(f); })`.replace(": number[]", ""));
          console.log(`${label} phone ${place}: median ${pct(ms, 0.5).toFixed(1)} ms, p90 ${pct(ms, 0.9).toFixed(1)} ms`);
        } else {
          const shot = await tab.call("Page.captureScreenshot", { format: "jpeg", quality: 82 });
          writeFileSync(join(out, `${label}-${place}-${view}.jpg`), Buffer.from(shot.data, "base64"));
          console.log(`${label}-${place}-${view}.jpg`);
        }
      }
    }
    await tab.close();
  }
} finally { stop(); vite.stop(); }
