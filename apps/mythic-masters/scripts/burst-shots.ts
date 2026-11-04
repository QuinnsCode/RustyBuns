// Bursts for the animation and graphics hill climb (#2943): bot fights from the side camera, four frames 0.3 s apart
// starting when a strike goes live (or a flyer is up), plus a three-quarter close-up of the beasts the judge reads
// anatomy and hide on. A fresh judge compares a BEFORE folder with a NOW folder.
//   bun scripts/burst-shots.ts <outdir> [prefix]     prefix names the files (default "now"): <prefix>-<scene>-b<n>.jpg
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ROSTER } from "../src/roster.ts";
import { PAGE } from "../src/gallery.ts";
import { launchChrome, load, openTab, startVite, type Tab } from "../../../scripts/chrome.ts";

/** scene name, the pair, what starts a burst, how many bursts */
const FIGHTS: [string, string, string, "strike" | "fly", number][] = [
  ["wings", "jersey-devil", "wampus-cat", "fly", 2],
  ["contact", "rougarou", "black-shuck", "strike", 2],
  ["dragon", "red-dragon", "champ", "strike", 1],
];
const CLOSE = ["black-shuck", "rougarou", "jersey-devil"];

const [dir, prefix = "now"] = process.argv.slice(2);
if (!dir) throw new Error("usage: bun scripts/burst-shots.ts <outdir> [prefix]");
const out = resolve(dir);
mkdirSync(out, { recursive: true });

const shoot = async (tab: Tab, name: string) => {
  const shot = await tab.call("Page.captureScreenshot", { format: "jpeg", quality: 82 });
  writeFileSync(join(out, `${prefix}-${name}.jpg`), Buffer.from(shot.data, "base64"));
};
/** Waits (up to 15 s) for either fighter to start a strike near the other, or for fighter 0 to be off the ground and flying. */
const cue = (kind: "strike" | "fly") => `new Promise((ok) => { const end = performance.now() + 15000; const tick = () => {
  const s = mythicMasters.state(); const [a, b] = s?.fighters ?? [];
  const near = a && b && Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) < 3.2; // inside melee reach
  const hit = ${kind === "strike"} ? (a?.state === "attack" || b?.state === "attack") && near : a?.flying && !a.onGround;
  if (hit || performance.now() > end) ok(!!hit); else requestAnimationFrame(tick); }; tick(); })`;

const vite = await startVite(resolve(import.meta.dir, ".."));
const { cdp, stop } = await launchChrome();
try {
  for (const [scene, a, b, kind, bursts] of FIGHTS) {
    const tab = await openTab(cdp, { w: 1280, h: 720 });
    try {
      await load(cdp, tab, `${vite.url}?a=${a}&b=${b}&skin=stadium&watch=1`, 2500);
      await tab.eval(`mythicMasters.camera("side")`);
      await Bun.sleep(2500); // intro, first approach
      for (let n = 0; n < bursts; n++) {
        const ok = await tab.eval<boolean>(cue(kind));
        for (let i = 0; i < 4; i++) { await shoot(tab, `${scene}${bursts > 1 ? n + 1 : ""}-b${i}`); await Bun.sleep(300); }
        console.log(`${scene} burst ${n + 1}: ${ok ? "cued" : "timed out, shot anyway"}`);
        await Bun.sleep(2500);
      }
      if (tab.noise.length) console.log(`${scene} noise: ${[...new Set(tab.noise)].slice(0, 3).join("; ")}`);
    } finally { await tab.close(); }
  }
  for (const id of CLOSE) {
    const tab = await openTab(cdp, { w: 800, h: 800 });
    try {
      await load(cdp, tab, `${vite.url}?gallery=${Math.floor(ROSTER.findIndex((c) => c.id === id) / PAGE)}`, 1500);
      const ok = await tab.eval<boolean>(`(async () => { const g = mythicMasters.shelf(); await g.ready(); return g.focus(${JSON.stringify(id)}, "three-quarter"); })()`);
      if (!ok) { console.log(`${id}: not found`); continue; }
      await tab.eval(`document.querySelectorAll("#hud, button, .shelf").forEach((e) => e.style.display = "none")`);
      await Bun.sleep(4000);
      await shoot(tab, `close-${id}`);
    } finally { await tab.close(); }
  }
} finally { stop(); vite.stop(); }
console.log(`shots in ${out}`);
