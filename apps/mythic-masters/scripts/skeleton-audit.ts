// How far each bone bends from its rest pose in every animation state: `bun scripts/skeleton-audit.ts [beast-id]`.
// A bone's bend is the angle between its rest direction and its direction now, measured in its parent's frame; a
// good pose keeps the spine under about 35 degrees and no bone ever stretches. Run it after touching beasts.ts.
import { join } from "node:path";
import * as THREE from "three";
import { rigFromWire } from "@rustybuns/rig";
import { loadGlb } from "@rustybuns/rig/model";
import { BeastRig, Puppet, type Beast } from "../src/beasts.ts";
import { body, ROSTER } from "../src/roster.ts";
import { newMatch, type Fighter } from "../src/sim.ts";

const APP = join(import.meta.dir, "..");
const id = process.argv[2] ?? "black-shuck";
const sheet = BeastRig(await Bun.file(join(APP, "public/models", `${id}.rig.json`)).json());
const model = await loadGlb(await Bun.file(join(APP, "public/models", `${id}.glb`)).arrayBuffer(), id);
const t3 = (a: number[]): [number, number, number] => [a[0]!, a[1]!, a[2]!];
const beast: Beast = { model, sheet, rig: rigFromWire({ ...sheet, grid: { ...sheet.grid, dims: t3(sheet.grid.dims), origin: t3(sheet.grid.origin) } }) };
const c = ROSTER.find((x) => x.id === id)!;
const parents = beast.rig.parents;
const rest = Array.from({ length: parents.length }, (_, j) => new THREE.Vector3(beast.rig.joints[j * 3]!, beast.rig.joints[j * 3 + 1]!, beast.rig.joints[j * 3 + 2]!));

// joints that belong to a leg: each foot and its ancestors while they hang below the hips
const legs = new Set<number>();
for (const ft of beast.sheet.feet) for (let j = ft; j >= 0 && rest[j]!.y < rest[0]!.y - 0.05; j = parents[j]!) legs.add(j);

type Setup = (f: Fighter, i: number) => void;
const states: Record<string, Setup> = {
  idle: () => {},
  run: (f) => { f.vel = { x: f.b.topSpeed, y: 0, z: 0 }; },
  guard: (f) => { f.state = "guard"; },
  charge: (f) => { f.state = "charge"; },
  dash: (f) => { f.state = "dash"; f.vel = { x: 9, y: 0, z: 0 }; },
  stun: (f) => { f.state = "stun"; f.stun = 20; },
  jump: (f) => { f.onGround = false; f.pos.y = 1.5; f.vel = { x: 2, y: 5, z: 0 }; },
  fall: (f) => { f.onGround = false; f.pos.y = 1.5; f.vel = { x: 2, y: -7, z: 0 }; },
};
for (const m of c.moves) for (const ph of ["wind", "strike"]) {
  states[`${m.slot}:${m.name}:${ph}`] = (f) => {
    f.state = "attack"; f.act = { move: m, hit: false, dive: false };
    const startup = Math.round(4 + m.power / 10) + (m.slot === "ultimate" ? 12 : 0);
    f.t = ph === "wind" ? Math.round(startup * 0.65) : startup + 2;
  };
}

const p = new Puppet(beast, body(c), c.archetype);
const out: string[] = [];
for (const [name, setup] of Object.entries(states)) {
  const f = newMatch(c, c).f[0];
  setup(f, 0);
  for (let i = 0; i < 90; i++) { p.update(f, 1 / 60, i * 3, { x: 3, y: 0.5, z: 0 }); }
  const J = Array.from({ length: parents.length }, (_, j) => new THREE.Vector3(...p.jointLocal(j)));
  let worst = 0, worstJ = 0, stretch = 0, spine = 0, spineJ = 0;
  for (let j = 1; j < parents.length; j++) {
    const par = parents[j]!;
    const a = rest[j]!.clone().sub(rest[par]!), b = J[j]!.clone().sub(J[par]!);
    stretch = Math.max(stretch, Math.abs(b.length() / a.length() - 1));
    // direction change relative to the parent bone's own turn, so only the joint's bend counts
    const gp = parents[par]!;
    const ra = gp >= 0 ? rest[par]!.clone().sub(rest[gp]!) : null, rb = gp >= 0 ? J[par]!.clone().sub(J[gp]!) : null;
    const turn = ra && rb ? new THREE.Quaternion().setFromUnitVectors(ra.normalize(), rb.normalize()) : new THREE.Quaternion();
    const ang = a.normalize().applyQuaternion(turn).angleTo(b.normalize());
    if (ang > worst) { worst = ang; worstJ = j; }
    if (!legs.has(j) && ang > spine) { spine = ang; spineJ = j; }
  }
  out.push(`${name.padEnd(34)} legs/all ${(worst * 57.3).toFixed(0).padStart(3)}° @${String(worstJ).padStart(2)}  body ${(spine * 57.3).toFixed(0).padStart(3)}° @${String(spineJ).padStart(2)}   stretch ${(stretch * 100).toFixed(0)}%`);
}
console.log(out.join("\n"));
