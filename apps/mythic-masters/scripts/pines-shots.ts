// The Pine Barrens from six fixed spots, for the world depth climb (#5622): `bun scripts/pines-shots.ts <outdir> <label>`.
// Atsion Lake from its beach, a stream where it crosses the sand road, the road itself, the woods off it, the cranberry
// bogs, and the road again at phone size, all at 11 in the morning with the weather held clear and the wild ones at peace.
// Writes <outdir>/<label>-<spot>.png. The spots come from pines.ts and the rivers, so they are the same on every branch
// that has them: shoot main as `before`, your branch as `after`, and hand a fresh judge both sets.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";
import { SIGHTS, lineDist } from "../src/world/pines.ts";
import { TRAILS, WORLD } from "../src/world/trail.ts";
import { dry, riverAt } from "../src/world/world.ts";

const [dir, label = "now"] = process.argv.slice(2);
if (!dir) { console.error("usage: bun scripts/pines-shots.ts <outdir> <label>"); process.exit(2); }
const out = resolve(dir);
mkdirSync(out, { recursive: true });

type Spot = { name: string; at: [number, number]; face: [number, number]; phone?: boolean };
const tr = TRAILS.get(1)!, st = tr.stones;
const sight = (id: string) => SIGHTS.find((s) => s.id === id)!;
/** A sight's own (x, z), turned into the world. */
const local = (id: string, x: number, z: number): [number, number] => { const s = sight(id), c = Math.cos(s.yaw), n = Math.sin(s.yaw); return [s.x + x * c + z * n, s.z - x * n + z * c]; };
/** The river nearest the trail, midstream, and a dry spot on its bank 16 m off. */
function stream(): Spot {
  let best: [number, number] = [0, 0], d = Infinity;
  for (let x = 21000; x < 25000; x += 10) for (let z = 1500; z < 7000; z += 10) {
    if (riverAt(x, z) < 0.95) continue;
    const e = lineDist(tr.pts, x, z);
    if (e > 20 && e < d) { d = e; best = [x, z]; }
  }
  for (let a = 0; a < 16; a++) {
    const x = best[0] + Math.cos(a * 0.39) * 16, z = best[1] + Math.sin(a * 0.39) * 16;
    if (dry(WORLD, x, z, 0.5) && riverAt(x, z) === 0) return { name: "stream", at: [x, z], face: best };
  }
  return { name: "stream", at: best, face: [best[0] + 20, best[1]] };
}
const mid = (a: { x: number; z: number }, b: { x: number; z: number }, u: number): [number, number] => [a.x + (b.x - a.x) * u, a.z + (b.z - a.z) * u];
const road = mid(st[5]!, st[6]!, 0.5), woods = mid(st[8]!, st[9]!, 0.5);
const SPOTS: Spot[] = [
  { name: "atsion", at: local("atsion", 4, 30), face: local("atsion", 0, -10) },
  stream(),
  { name: "road", at: road, face: [st[6]!.x, st[6]!.z] },
  { name: "woods", at: [woods[0] + 70, woods[1] - 40], face: [woods[0] + 170, woods[1] - 60] },
  { name: "bogs", at: local("bogs", -8, 42), face: local("bogs", 0, 0) },
  { name: "phone-road", at: road, face: [st[6]!.x, st[6]!.z], phone: true },
];

const vite = await startVite(resolve(import.meta.dir, ".."));
const { cdp, stop } = await launchChrome();
try {
  for (const phone of [false, true]) {
    const tab = await openTab(cdp, phone ? { w: 390, h: 844 } : { w: 1280, h: 720 }, phone);
    await load(cdp, tab, `${vite.url}?world=1&a=jackalope`, 2500);
    await tab.eval(`(() => { const w = mythicMasters.world; w.peace(true); w.setHour(11); w.setWeather({ rain: 0, snow: 0, mist: 0 }); w.travel(1); mythicMasters.director.cut(); })()`);
    for (const s of SPOTS.filter((s) => !!s.phone === phone)) {
      const moved = await tab.eval<boolean>(`mythicMasters.world.teleport(${s.at[0]}, ${s.at[1]})`);
      await tab.eval(`mythicMasters.world.eye(null); mythicMasters.world.face(${s.face[0]}, ${s.face[1]})`);
      await Bun.sleep(6000);
      for (let i = 0; i < 40 && await tab.eval<boolean>("mythicMasters.world.state().shot"); i++) await Bun.sleep(500);
      await tab.eval(`mythicMasters.world.face(${s.face[0]}, ${s.face[1]})`);
      await Bun.sleep(1200);
      const shot = await tab.call("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(out, `${label}-${s.name}.png`), Buffer.from(shot.data, "base64"));
      console.log(`${label}-${s.name}.png at ${s.at.map(Math.round).join(", ")}${moved ? "" : " (teleport refused)"}`);
    }
    await tab.close();
  }
} finally { stop(); vite.stop(); }
