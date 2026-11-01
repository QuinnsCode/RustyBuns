// One close-up per field, for judging a field's look by eye (#3145): the gallery with one legendary or mythic of each
// field in the frame, three-quarter view, saved as a small JPEG in the folder given (default docs/shots-<date>/).
//   bun scripts/field-shots.ts [outdir] [field ...]
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ROSTER } from "../src/roster.ts";
import { PAGE } from "../src/gallery.ts";
import { launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";

const SHOW: Record<string, string> = {
  ember: "red-dragon", tide: "champ", gale: "tengu", stone: "sphinx", frost: "yeti", storm: "raiju", grove: "leshy",
  venom: "mapinguari", spirit: "qilin", shadow: "hidebehind", iron: "oni", wild: "sasquatch",
};
const [dir, ...only] = process.argv.slice(2);
const out = resolve(dir ?? join(import.meta.dir, "../docs", `shots-${new Date().toISOString().slice(0, 10)}`));
mkdirSync(out, { recursive: true });
const vite = await startVite(resolve(import.meta.dir, ".."));
const { cdp, stop } = await launchChrome();
try {
  for (const [field, id] of Object.entries(SHOW)) {
    if (only.length && !only.includes(field)) continue;
    const tab = await openTab(cdp, { w: 800, h: 800 });
    try {
      const page = Math.floor(ROSTER.findIndex((c) => c.id === id) / PAGE);
      await load(cdp, tab, `${vite.url}?gallery=${page}`, 1500);
      const ok = await tab.eval<boolean>(`(async () => { const g = mythicMasters.shelf(); await g.ready(); return g.focus(${JSON.stringify(id)}, "three-quarter"); })()`);
      if (!ok) { console.log(`${field}: ${id} not found`); continue; }
      await tab.eval(`document.querySelectorAll("#hud, button, .shelf").forEach((e) => e.style.display = "none")`);
      await Bun.sleep(4000);
      const shot = await tab.call("Page.captureScreenshot", { format: "jpeg", quality: 82 });
      writeFileSync(join(out, `field-${field}.jpg`), Buffer.from(shot.data, "base64"));
      console.log(`${field}: ${id} -> field-${field}.jpg`);
    } catch (e) { console.log(`${field}: ${String(e).slice(0, 80)}`); } finally { await tab.close().catch(() => {}); }
  }
} finally { stop(); vite.stop(); }
