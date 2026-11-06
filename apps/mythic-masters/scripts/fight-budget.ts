// A busy fight's frame budget (#2830): `bun scripts/fight-budget.ts [--seconds 20] [a b]`. Opens a watched fight (two bots,
// default the Red Dragon against the Jersey Devil, both heavy on effects) on desktop (1280x720) and on a phone (390x844 at 2x
// with touch, the CPU slowed 4x), lets it settle, then times every frame for `--seconds`. Prints the median, 95th
// percentile and worst frame, the frames over 50 ms, and the most move-effect particles alive against the page's cap
// (src/fx.ts MAX_LIVE, MAX_LIVE_PHONE on a narrow screen), so the phone cap can be judged on numbers.
import { resolve } from "node:path";
import { launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";

const argv = process.argv.slice(2), flag = (k: string) => { const i = argv.indexOf(k); return i < 0 ? undefined : argv.splice(i, 2)[1]; };
const seconds = Number(flag("--seconds") ?? 20);
const [a = "red-dragon", b = "jersey-devil"] = argv;
const vite = await startVite(resolve(import.meta.dir, ".."));
const { cdp, stop } = await launchChrome();
interface Run { ms: number[]; peak: number; cap: number; over: number }
/** Times frames in the page for `s` seconds, sampling the particle count every frame. */
const TIME = (s: number) => `new Promise((ok) => {
  const ms = [], end = performance.now() + ${s * 1000}; let last = performance.now(), peak = 0, cap = 0;
  const f = () => { const now = performance.now(); ms.push(now - last); last = now;
    const p = mythicMasters.perf(); peak = Math.max(peak, p.particles); cap = p.cap;
    if (now < end) requestAnimationFrame(f); else ok({ ms, peak, cap, over: ms.filter((x) => x > 50).length }); };
  requestAnimationFrame(f);
})`;
const pct = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(xs.length * p))]!;
try {
  for (const phone of [false, true]) {
    const tab = await openTab(cdp, phone ? { w: 390, h: 844 } : { w: 1280, h: 720 }, phone);
    if (phone) await tab.call("Emulation.setCPUThrottlingRate", { rate: 4 });
    await load(cdp, tab, `${vite.url}?a=${a}&b=${b}&skin=stadium&watch=1`, phone ? 8000 : 4000); // past the intro and the first shader compiles
    const r = await tab.eval<Run>(TIME(seconds)), xs = [...r.ms].sort((p, q) => p - q);
    console.log(`${phone ? "phone 4x CPU" : "desktop     "}  ${xs.length} frames  median ${pct(xs, 0.5).toFixed(1)} ms  p95 ${pct(xs, 0.95).toFixed(1)} ms  worst ${xs.at(-1)!.toFixed(0)} ms  over 50 ms ${r.over}  particles peak ${r.peak} of ${r.cap}`);
    if (tab.noise.length) console.log(`  page noise: ${tab.noise.slice(0, 3).join(" | ")}`);
    await tab.close();
  }
} finally { stop(); vite.stop(); }
