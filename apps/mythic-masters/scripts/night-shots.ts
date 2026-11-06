// The night (#3773), from where you stand: `bun scripts/night-shots.ts <outdir>`. In the Pine Barrens, shoots dusk, midnight
// out in the open beside one of the night ones, and midnight at a lit campfire with the wilds waiting at its light's edge,
// as <outdir>/night-<dusk|open|fire>.jpg, and prints what the world says of each (dark, shelter, the wilds near you).
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";
import { NIGHT } from "../src/tiers.ts";

const dir = process.argv[2];
if (!dir) { console.error("usage: bun scripts/night-shots.ts <outdir>"); process.exit(2); }
const out = resolve(dir);
mkdirSync(out, { recursive: true });
const vite = await startVite(resolve(import.meta.dir, ".."));
const { cdp, stop } = await launchChrome();
const QUIET = "(() => { const m = mythicMasters; for (const f of [() => m.book.close(), () => m.witch.close(), () => m.director.cut()]) try { f(); } catch {} })()";
interface Seen { x: number; z: number; day: { hour: number; dark: boolean; shelter: string | null }; wilds: { id: string; x: number; z: number }[]; places: { id: string; kind: string; x: number; z: number }[] }
try {
  const tab = await openTab(cdp, { w: 1280, h: 720 }, false);
  await load(cdp, tab, `${vite.url}?world=1&a=jackalope`, 2500);
  await tab.eval(`(() => { const m = mythicMasters; m.world.travel(1); m.book.close(); m.witch.close(); m.director.cut(); m.world.setWeather({ rain: 0, snow: 0, mist: 0 }); })()`);
  const state = () => tab.eval<Seen>("mythicMasters.world.state()");
  const shoot = async (name: string) => {
    // a fire lit for the first time may open a talk, which holds the world still: close it, then let it run
    for (let i = 0; i < 4; i++) { await tab.eval(QUIET); await Bun.sleep(1000); }
    for (let i = 0; i < 40 && await tab.eval<boolean>("mythicMasters.world.state().shot"); i++) await Bun.sleep(500);
    const s = await state(), near = s.wilds.filter((c) => Math.hypot(c.x - s.x, c.z - s.z) < 60).map((c) => `${c.id}@${Math.round(Math.hypot(c.x - s.x, c.z - s.z))}m`);
    const shot = await tab.call("Page.captureScreenshot", { format: "jpeg", quality: 82 });
    writeFileSync(join(out, `night-${name}.jpg`), Buffer.from(shot.data, "base64"));
    console.log(`night-${name}.jpg  hour ${s.day.hour} dark ${s.day.dark} shelter ${s.day.shelter ?? "-"}  near: ${near.join(", ") || "none"}`);
  };
  await tab.eval("mythicMasters.world.setHour(18.2)");
  await shoot("dusk");
  // Midnight: walk up beside a night one (stepping back a little so it isn't met), out in the open.
  await tab.eval("mythicMasters.world.setHour(0); mythicMasters.world.peace(true)");
  await Bun.sleep(1500);
  // Walk out from the arena until a night one is in sight, then stand back from it.
  const home = await state();
  let c: Seen["wilds"][number] | undefined;
  for (let k = 1; k <= 30 && !c; k++) {
    const a = k * 2.4, r = 250 + k * 120;
    await tab.eval(`mythicMasters.world.teleport(${home.x + Math.cos(a) * r}, ${home.z + Math.sin(a) * r})`);
    await Bun.sleep(600);
    c = (await state()).wilds.find((w) => NIGHT.has(w.id));
  }
  if (c) await tab.eval(`mythicMasters.world.teleport(${c.x + 12}, ${c.z})`);
  await shoot("open");
  // A campfire: walk up to light it, then stand in its light.
  const fire = (await state()).places.find((p) => p.kind === "fire");
  if (fire) { await tab.eval(`mythicMasters.world.teleport(${fire.x + 2}, ${fire.z})`); await Bun.sleep(1500); await tab.eval(`mythicMasters.world.teleport(${fire.x + 6}, ${fire.z + 4})`); }
  await shoot("fire");
  await tab.close();
} finally { stop(); vite.stop(); }
