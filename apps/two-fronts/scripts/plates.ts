// Bakes the menu plates (#3565): `bun scripts/plates.ts` paints them in headless Chrome (scripts/plates-paint.js, a
// seeded procedural canvas, so a rerun gives the same files) and writes public/plates/*.webp, printing each file's bytes.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launchChrome, openTab } from "../../../scripts/chrome.ts";
import { MATCH_MODES } from "../src/battle/contract.ts";
import { icon } from "../src/ui/icons.ts";
import { MODE_INFO } from "../src/ui/vote.ts";

const app = resolve(import.meta.dir, ".."), out = join(app, "public", "plates");
mkdirSync(out, { recursive: true });
const paint = readFileSync(join(import.meta.dir, "plates-paint.js"), "utf8").replace(/^\s*\/\/.*$/gm, "").trim();
const insignia = readFileSync(join(app, "src", "ui", "plate", "insignia.svg"), "utf8");
const medals = Object.fromEntries(MATCH_MODES.map((m) => [m, icon(MODE_INFO[m].icon, 24)]));

const chrome = await launchChrome();
try {
  const tab = await openTab(chrome.cdp, { w: 800, h: 600 });
  const images = await tab.eval<Record<string, string>>(`(${paint})(${JSON.stringify(insignia)}, ${JSON.stringify(medals)})`);
  let total = 0;
  for (const [name, url] of Object.entries(images)) {
    const bytes = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
    writeFileSync(join(out, `${name}.webp`), bytes);
    total += bytes.length;
    console.log(`public/plates/${name}.webp  ${(bytes.length / 1024).toFixed(1)} KB`);
  }
  console.log(`total ${(total / 1024).toFixed(1)} KB`);
  await tab.close();
} finally {
  chrome.stop();
}
