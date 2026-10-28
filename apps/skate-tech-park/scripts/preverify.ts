// Headless pre-check for the hands-on rides (#2486, #2401): the numbers a person would otherwise eyeball.
// Run from apps/skate-tech-park: `bun scripts/preverify.ts [park]`. Prints one line per check.
import { DT, IDLE, start, step, type Input, type State } from "../src/sim.ts";
import { makeLevel } from "../src/level.ts";
import { spotFor } from "../src/scenario.ts";
import { level } from "../test/parks.ts";

const park = process.argv[2] ?? "el-capitan";
const l = await level(park), say = (k: string, v: unknown) => console.log(`${k.padEnd(46)} ${typeof v === "string" ? v : JSON.stringify(v)}`);
const run = (s: State, secs: number, inp: (s: State, t: number) => Partial<Input>, each?: (s: State) => void) => {
  for (let i = 0; i < secs / DT; i++) { step(s, { ...IDLE, ...inp(s, i * DT) }, l); each?.(s); }
};
const sp = l.spawns[0]!;

let top = 0;
const a = start(sp.x, sp.z, sp.yaw, l);
run(a, 20, () => ({ throttle: 1 }), (s) => { top = Math.max(top, Math.abs(s.speed)); });
say("push from standing, top km/h on this park's spawn", Math.round(top * 3.6));
const flat = makeLevel({ name: "flat", pieces: [], rails: [], spawns: [], bounds: { minX: -2000, maxX: 2000, minZ: -2000, maxZ: 2000 } });
const f = start(0, 0, 0, flat);
top = 0;
for (let i = 0; i < 30 / DT; i++) { step(f, { ...IDLE, throttle: 1 }, flat); top = Math.max(top, Math.abs(f.speed)); }
say("push from standing, top km/h on flat (target ~58)", Math.round(top * 3.6));

let apex = 0, ground = 0;
const b = Object.assign(start(sp.x, sp.z, sp.yaw, l), { speed: 8 });
run(b, 0.5, () => ({ throttle: 1 }));
ground = b.y;
run(b, 2, (s, t) => ({ throttle: 1, jump: t < 0.1 }), (s) => { apex = Math.max(apex, s.y - ground); });
say("ollie apex at 8 m/s, m", Math.round(apex * 100) / 100);

const wall = process.argv[3] ? l.spawns.find((p) => p.name === process.argv[3]) : spotFor(l, "vert");
if (wall) {
  const w = Object.assign(start(wall.x, wall.z, wall.yaw, l), { speed: 14 });
  let airs = 0, was = false, bail = false, last = 0;
  run(w, 15, () => ({ throttle: 1 }), (s) => { if (was && !s.air) { airs++; last = s.speed; } was = s.air; if (s.bail > 0) bail = true; });
  say(`?spawn=vert landings in 15 s held push`, { airs, bail, finalSpeedKmh: Math.round(Math.abs(w.speed) * 3.6) });
} else say("?spawn=vert", "no wall on this park");

for (const spot of ["rail", "balance"] as const) {
  const at = spotFor(l, spot);
  if (!at) { say(`?spawn=${spot}`, "no bar on this park"); continue; }
  // ollie at every moment along the 14 m run-up; keep the first pop that lands a grind, then hold it with and without counter-steering
  for (const hold of ["still", "counter"] as const) {
    let best: { jumpAt: number; kind: string; heldS: number; peak: number; fell: boolean } | null = null;
    for (let jumpAt = 0.8; jumpAt < 1.8 && !best; jumpAt += 0.05) {
      const s = Object.assign(start(at.x, at.z, at.yaw, l), { speed: 9 });
      let kind = "", peak = 0, heldS = 0, was = false, fell = false;
      run(s, 7, (st, t) => ({ throttle: st.speed < 9 ? 1 : 0, jump: t >= jumpAt && t < jumpAt + 0.1, steer: st.grind >= 0 && hold === "counter" ? Math.max(-1, Math.min(1, st.balance * 3)) : 0 }), (st) => {
        if (st.grind >= 0) { was = true; kind = st.grindKind; heldS += DT; peak = Math.max(peak, Math.abs(st.balance)); }
        else if (was && st.bail > 0) fell = true;
      });
      if (was) best = { jumpAt: Math.round(jumpAt * 100) / 100, kind, heldS: Math.round(heldS * 10) / 10, peak: Math.round(peak * 100) / 100, fell };
    }
    say(`?spawn=${spot} ollie, hands ${hold}`, best ?? "no grind landed at any pop time");
  }
}
