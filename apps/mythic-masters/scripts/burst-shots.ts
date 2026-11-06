// Bursts for the animation and graphics hill climb (#2943): bot fights from the side camera, four frames 0.3 s apart
// starting when a strike goes live (or a flyer is up), one burst of frames 0.1 s apart from the moment a hit lands (its
// sparks and flash last a few tenths, too short for the 0.3 s bursts to catch), plus a three-quarter close-up of the beasts the judge reads
// anatomy and hide on. A fresh judge compares a BEFORE folder with a NOW folder.
//   bun scripts/burst-shots.ts <outdir> [prefix]     prefix names the files (default "now"): <prefix>-<scene>-b<n>.jpg
//   --combat   the combat-feel climb (#3465): one fight per archetype, a burst cued on a wind-up near the other and
//              one cued on a hit landing (a fighter stunned), frames 0.2 s apart, no close-ups; and six frames from a heavy
//              swing locking near the other (its dodge and the punish after, #3511 round 3)
//   --fly      only the winged bipeds held in flight in the gallery, from the side, flying forward at speed: two
//              frames 0.45 s apart each (a bot fight rarely catches a flyer in the air)
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ROSTER } from "../src/roster.ts";
import { PAGE } from "../src/gallery.ts";
import { launchChrome, load, openTab, startVite, type Tab } from "../../../scripts/chrome.ts";

/** scene name, the pair, what starts a burst, how many bursts */
type Cue = "strike" | "fly" | "stun" | "locked";
const ART: [string, string, string, Cue, number][] = [
  ["wings", "jersey-devil", "wampus-cat", "fly", 2],
  ["contact", "rougarou", "black-shuck", "strike", 2],
  ["dragon", "red-dragon", "champ", "strike", 1],
  ["hit", "rougarou", "black-shuck", "stun", 1],
];
/** One fight per archetype; each scene is shot three times: on a wind-up, on a locked heavy swing, on a landed hit. */
const COMBAT: [string, string, string][] = [
  ["bruiser", "rougarou", "sasquatch"],
  ["tank", "hodag", "yeti"],
  ["skirmisher", "wampus-cat", "black-shuck"],
  ["flyer", "jersey-devil", "rougarou"],
];
const combat = process.argv.includes("--combat"), fly = process.argv.includes("--fly");
const FIGHTS: [string, string, string, Cue[]][] = fly ? [] : combat
  ? COMBAT.map(([s, a, b]) => [s, a, b, ["strike", "locked", "stun"]])
  : ART.map(([s, a, b, k, n]) => [s, a, b, Array<Cue>(n).fill(k)]);
const CLOSE = fly ? ["jersey-devil", "mothman", "sasabonsam"] : combat ? [] : ["black-shuck", "rougarou", "jersey-devil"];
const GAP = combat ? 200 : 300, HIT_GAP = 100;

const [dir, prefix = "now"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!dir) throw new Error("usage: bun scripts/burst-shots.ts <outdir> [prefix]");
const out = resolve(dir);
mkdirSync(out, { recursive: true });

const shoot = async (tab: Tab, name: string) => {
  const shot = await tab.call("Page.captureScreenshot", { format: "jpeg", quality: 82 });
  writeFileSync(join(out, `${prefix}-${name}.jpg`), Buffer.from(shot.data, "base64"));
};
/** Waits (up to 15 s) for either fighter to start a strike near the other, lock a heavy swing near the other, or land a hit,
 * or for fighter 0 to be off the ground and flying. */
const cue = (kind: Cue) => `new Promise((ok) => { const end = performance.now() + 15000; const tick = () => {
  const s = mythicMasters.state(); const [a, b] = s?.fighters ?? [];
  const near = a && b && Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) < 3.2; // inside melee reach
  const hit = ${JSON.stringify(kind)} === "stun" ? a?.state === "stun" || b?.state === "stun"
    : ${JSON.stringify(kind)} === "locked" ? (a?.swing === "locked" || b?.swing === "locked") && near
    : ${JSON.stringify(kind)} === "strike" ? (a?.state === "attack" || b?.state === "attack") && near : a?.flying && !a.onGround;
  if (hit || performance.now() > end) ok(!!hit); else requestAnimationFrame(tick); }; tick(); })`;

const vite = await startVite(resolve(import.meta.dir, ".."));
const { cdp, stop } = await launchChrome();
try {
  for (const [scene, a, b, cues] of FIGHTS) {
    const tab = await openTab(cdp, { w: 1280, h: 720 });
    try {
      await load(cdp, tab, `${vite.url}?a=${a}&b=${b}&skin=stadium&watch=1`, 2500);
      await tab.eval(`mythicMasters.camera("side")`);
      await Bun.sleep(2500); // intro, first approach
      for (const [n, kind] of cues.entries()) {
        const ok = await tab.eval<boolean>(cue(kind));
        const name = combat ? `${scene}-${kind === "stun" ? "hit" : kind === "locked" ? "dodge" : "windup"}` : `${scene}${cues.length > 1 ? n + 1 : ""}`;
        for (let i = 0; i < (kind === "locked" ? 6 : 4); i++) { await shoot(tab, `${name}-b${i}`); await Bun.sleep(kind === "stun" && !combat ? HIT_GAP : GAP); }
        console.log(`${name}: ${ok ? "cued" : "timed out, shot anyway"}`);
        await Bun.sleep(2500);
      }
      if (tab.noise.length) console.log(`${scene} noise: ${[...new Set(tab.noise)].slice(0, 3).join("; ")}`);
    } finally { await tab.close(); }
  }
  for (const id of CLOSE) {
    const tab = await openTab(cdp, { w: 800, h: 800 });
    try {
      await load(cdp, tab, `${vite.url}?gallery=${Math.floor(ROSTER.findIndex((c) => c.id === id) / PAGE)}`, 1500);
      const ok = await tab.eval<boolean>(`(async () => { const g = mythicMasters.shelf(); await g.ready(); const ok = g.focus(${JSON.stringify(id)}, ${fly ? '"side"' : '"three-quarter"'});
        const s = g.stands.find((x) => x.id === ${JSON.stringify(id)});
        if (${fly} && s) { s.f.flying = true; s.f.onGround = false; s.f.vel = { x: s.f.b.topSpeed * 0.8, y: 0, z: 0 }; }
        return ok; })()`);
      if (!ok) { console.log(`${id}: not found`); continue; }
      await tab.eval(`document.querySelectorAll("#hud, button, .shelf").forEach((e) => e.style.display = "none")`);
      await Bun.sleep(fly ? 3000 : 4000);
      if (fly) for (let i = 0; i < 2; i++) { await shoot(tab, `fly-${id}-${i}`); await Bun.sleep(450); }
      else await shoot(tab, `close-${id}`);
    } finally { await tab.close(); }
  }
} finally { stop(); vite.stop(); }
console.log(`shots in ${out}`);
