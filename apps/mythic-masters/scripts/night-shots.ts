// The night (#3773, #3779), from where you stand: `bun scripts/night-shots.ts <outdir>`. On a fresh journey in the Pine
// Barrens: dusk on one of tonight's lit paths, the first night with Gary (his warning, him going off the path, his
// lantern going out), stalked out in the dark off the path, safe on it again, and at a lit campfire. Shots go to
// <outdir>/night-<name>.jpg, and each prints what the world says then (hour, dread, the stalker, Gary).
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";
import { safePaths } from "../src/world/night.ts";

const dir = process.argv[2];
if (!dir) { console.error("usage: bun scripts/night-shots.ts <outdir>"); process.exit(2); }
const out = resolve(dir);
mkdirSync(out, { recursive: true });
const vite = await startVite(resolve(import.meta.dir, ".."));
const { cdp, stop } = await launchChrome();
const QUIET = "(() => { const m = mythicMasters; for (const f of [() => m.book.close(), () => m.witch.close(), () => m.director.cut()]) try { f(); } catch {} })()";
interface Seen {
  x: number; z: number; shot: boolean; places: { kind: string; x: number; z: number }[];
  day: { hour: number; dark: boolean; shelter: string | null };
  night: { night: number; dread: number; safe: number; stalker: string | null; lamps: number; gary: { t: number; off: boolean } | null } | null;
}
try {
  const tab = await openTab(cdp, { w: 1280, h: 720 }, false);
  await load(cdp, tab, `${vite.url}?world=1&a=jackalope`, 2500);
  await tab.eval(`(() => { const m = mythicMasters; m.world.travel(1); m.director.cut(); m.world.setWeather({ rain: 0, snow: 0, mist: 0 }); })()`);
  const state = () => tab.eval<Seen>("mythicMasters.world.state()");
  const go = (x: number, z: number) => tab.eval(`mythicMasters.world.teleport(${x}, ${z})`);
  const shoot = async (name: string, wait = 3) => {
    // a fire lit for the first time may open a talk, which holds the world still: close it, then let it run
    for (let i = 0; i < wait; i++) { await tab.eval(QUIET); await Bun.sleep(1000); }
    for (let i = 0; i < 40 && (await state()).shot; i++) await Bun.sleep(500);
    const s = await state(), n = s.night;
    const shot = await tab.call("Page.captureScreenshot", { format: "jpeg", quality: 82 });
    writeFileSync(join(out, `night-${name}.jpg`), Buffer.from(shot.data, "base64"));
    console.log(`night-${name}.jpg  hour ${s.day.hour} dark ${s.day.dark}${n ? `  lamps ${n.lamps} safe ${n.safe} m dread ${n.dread} stalker ${n.stalker ?? "-"} gary ${n.gary ? `${n.gary.t}s${n.gary.off ? " off the path" : ""}` : "-"}` : ""}`);
  };
  // Dusk, the lights coming up: stand on the middle of tonight's first path.
  await tab.eval("mythicMasters.world.setHour(18.4)");
  await Bun.sleep(1500);
  const night = (await state()).night?.night;
  if (night === undefined) throw new Error("no night at 18:24");
  const path = safePaths(1, night).paths[0]!, [mx, mz] = path.pts[Math.floor(path.pts.length / 2)]!;
  await go(mx, mz);
  await shoot("dusk-path");
  // The first night: Gary walks it with you, warns you, and goes off after something.
  await tab.eval("mythicMasters.world.setHour(18.8)");
  await shoot("gary-warns", 11);
  await shoot("gary-goes", 9);
  for (let i = 0; i < 40 && (await state()).night?.gary; i++) await Bun.sleep(1000);
  await shoot("gary-gone", 1);
  // Off the path, out in the dark: something comes.
  const [ax, az] = path.pts[Math.max(0, Math.floor(path.pts.length / 2) - 1)]!, len = Math.hypot(mx - ax, mz - az) || 1;
  await go(mx - ((mz - az) / len) * 120, mz + ((mx - ax) / len) * 120);
  await shoot("stalked", 6);
  // Back on the path: it fades.
  await go(mx, mz);
  await shoot("path-safe", 6);
  // A campfire: walk up to light it, then stand in its light.
  const fire = (await state()).places.find((p) => p.kind === "fire");
  if (fire) { await go(fire.x + 2, fire.z); await Bun.sleep(1500); await go(fire.x + 6, fire.z + 4); }
  await shoot("fire", 4);
  await tab.close();
} finally { stop(); vite.stop(); }
