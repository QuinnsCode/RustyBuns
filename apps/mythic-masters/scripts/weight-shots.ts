// Before/after shots of the weighty-attack changes (#2946, #2950, shipped in #2959): the same bot fight, side camera, one
// shot the first time a fighter winds up an attack, one the first time one is stunned by a hit. Run it once on a checkout of the
// commit before #2959 and once on this one, into the same folder, and read the pairs side by side.
//
//   bun scripts/weight-shots.ts --label before --root /path/to/older/apps/mythic-masters
//   bun scripts/weight-shots.ts --label after
// Needs Chrome (CHROME=/path overrides where it looks). Saves docs/shots-<date>/weight-<label>-<pair>-<moment>.jpg.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";

const argv = process.argv.slice(2);
const opt = (n: string, d: string) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1]! : d);
const label = opt("label", "after"), root = resolve(opt("root", resolve(import.meta.dir, "..")));
const out = resolve(import.meta.dir, "../docs", `shots-${opt("date", new Date().toISOString().slice(0, 10))}`);
mkdirSync(out, { recursive: true });
const PAIRS: [string, string][] = [["hodag", "squonk"], ["red-dragon", "champ"]];

const vite = await startVite(root);
const { cdp, stop } = await launchChrome();
try {
  for (const [a, b] of PAIRS) {
    const tab = await openTab(cdp, { w: 1280, h: 720 });
    try {
      await load(cdp, tab, `${vite.url}?a=${a}&b=${b}&watch=1`, 1500);
      await tab.eval(`mythicMasters.camera("side")`).catch((e: Error) => { throw new Error(`${e.message} (page said: ${[...new Set(tab.noise)].slice(0, 4).join("; ")})`); });
      const want = new Set(["attack", "stun"]);
      const log: string[] = [];
      for (let i = 0; i < 1200 && want.size; i++) {
        const s = await tab.eval<{ tick: number; fighters: { state: string }[] } | null>(`mythicMasters.state()`);
        const hit = s?.fighters.map((f) => f.state).find((st) => want.has(st));
        if (hit) {
          want.delete(hit);
          const shot = await tab.call("Page.captureScreenshot", { format: "jpeg", quality: 85 });
          writeFileSync(join(out, `weight-${label}-${a}-vs-${b}-${hit === "attack" ? "windup" : "stagger"}.jpg`), Buffer.from(shot.data, "base64"));
          log.push(`${hit} at tick ${s!.tick}`);
        }
        await Bun.sleep(30);
      }
      console.log(label, a, b, log.join(", ") || "no moment caught");
    } finally { await tab.close(); }
  }
} finally { stop(); vite.stop(); }
