// Frame-rate and screenshot check for the move effects (#2820, #2830): bot-vs-bot fights in headless Chrome, side camera,
// at a phone size with the CPU slowed and at desktop size as the reference. Prints frame-time percentiles per pairing and
// saves screenshots to docs/fx-check-<date>/ to be scored by eye. Needs Chrome (CHROME=/path overrides where it looks).
//
//   bun scripts/fx-check.ts                 every pairing below, phone (4x slower CPU) and desktop
//   bun scripts/fx-check.ts --throttle 6    a different CPU slowdown for the phone run
//   bun scripts/fx-check.ts --seconds 20    seconds timed per run (default 10)
// Headless Chrome draws in software (SwiftShader), so the GPU share is slower than any phone's: read the numbers as
// a ceiling, and the throttle as the CPU side only.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";

/** One pairing per field whose look #2820 changed. */
const PAIRS: [string, string][] = [["yeti", "mapinguari"], ["raiju", "oni"], ["red-dragon", "champ"], ["jersey-devil", "wampus-cat"]];
const argv = process.argv.slice(2);
const opt = (n: string, d: number) => (argv.includes(`--${n}`) ? Number(argv[argv.indexOf(`--${n}`) + 1]) : d);
const THROTTLE = opt("throttle", 4), SECONDS = opt("seconds", 10);
const out = resolve(import.meta.dir, "../docs", `fx-check-${new Date().toISOString().slice(0, 10)}`);
mkdirSync(out, { recursive: true });

const pct = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(xs.length * p))]!;

const vite = await startVite(resolve(import.meta.dir, ".."));
const { cdp, stop } = await launchChrome();
const rows: string[] = [];
try {
  for (const [label, size, mobile, rate] of [["phone", { w: 390, h: 844 }, true, THROTTLE], ["desktop", { w: 1280, h: 720 }, false, 1]] as const) {
    for (const [a, b] of PAIRS) {
      const tab = await openTab(cdp, size, mobile);
      try {
        await tab.call("Emulation.setCPUThrottlingRate", { rate });
        await load(cdp, tab, `${vite.url}?a=${a}&b=${b}&watch=1`, 1500);
        await tab.eval(`mythicMasters.camera("side")`);
        const cap = await tab.eval<number>(`matchMedia("(max-width: 700px)").matches ? 400 : 700`);
        // time every animation frame for SECONDS; the first 30 are shader compile, left out
        const times = await tab.eval<number[]>(`new Promise((ok) => { const t = []; let last = performance.now(); const end = last + ${SECONDS * 1000};
          const step = (now) => { t.push(now - last); last = now; if (now < end) requestAnimationFrame(step); else ok(t); };
          requestAnimationFrame(step); })`);
        for (let i = 0; i < 3; i++) {
          await Bun.sleep(i ? 2500 : 1500);
          const shot = await tab.call("Page.captureScreenshot", { format: "jpeg", quality: 80 });
          writeFileSync(join(out, `${label}-${a}-vs-${b}-${i + 1}.jpg`), Buffer.from(shot.data, "base64"));
        }
        const s = times.slice(30).sort((x, y) => x - y);
        const over = s.filter((x) => x > 33.4).length / s.length;
        rows.push(`| ${label}${rate > 1 ? ` (${rate}x CPU)` : ""} | ${a} vs ${b} | ${cap} | ${pct(s, 0.5).toFixed(1)} | ${pct(s, 0.95).toFixed(1)} | ${s.at(-1)!.toFixed(0)} | ${(over * 100).toFixed(0)}% |`);
        if (tab.noise.length) rows.push(`|  | noise: ${[...new Set(tab.noise)].slice(0, 3).join("; ")} | | | | | |`);
      } finally { await tab.close(); }
    }
  }
} finally { stop(); vite.stop(); }
const table = ["| run | pairing | particle cap | median ms | p95 ms | max ms | frames over 33 ms |", "|---|---|---|---|---|---|---|", ...rows].join("\n");
writeFileSync(join(out, "frames.md"), table + "\n");
console.log(table, `\nshots in ${out}`);
