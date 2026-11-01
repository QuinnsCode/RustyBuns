import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { rigFromWire } from "@rustybuns/rig";
import { int, obj, opt } from "@rustybuns/util/guard";
import { loadGlb } from "@rustybuns/rig/model";
import { BeastRig, headAndTail, Puppet, wingsOf, type Beast } from "../src/beasts.ts";
import { body, ROSTER } from "../src/roster.ts";
import { frames, IDLE, newMatch, type Fighter } from "../src/sim.ts";

// Every sheet in beasts/ has been built (bun scripts/beasts.ts): a GLB and a rig sidecar whose feet match the
// sheet. Blender isn't needed here; the files are checked in.
const APP = join(import.meta.dir, "..");
const Expected = obj({ feet: int(0, 8), wings: opt(int(0, 8)) });
const ids = readdirSync(join(APP, "beasts")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));

async function beast(id: string): Promise<Beast> {
  const sheet = BeastRig(await Bun.file(join(APP, "public", "models", `${id}.rig.json`)).json());
  const model = await loadGlb(await Bun.file(join(APP, "public", "models", `${id}.glb`)).arrayBuffer(), id);
  const t = (a: number[]): [number, number, number] => [a[0]!, a[1]!, a[2]!];
  return { model, sheet, rig: rigFromWire({ ...sheet, grid: { ...sheet.grid, dims: t(sheet.grid.dims), origin: t(sheet.grid.origin) } }) };
}

describe("every beast sheet is built and rigged", () => {
  test.each(ids)("%s: a GLB, and a rig whose feet match the sheet", async (id) => {
    const expected = Expected(await Bun.file(join(APP, "beasts", `${id}.json`)).json());
    const b = await beast(id);
    expect(b.model.triangles).toBeGreaterThan(100);
    expect(b.sheet.feet.length).toBe(expected.feet);
    if (expected.wings !== undefined) expect(b.sheet.wings.length).toBe(expected.wings);
    expect(b.rig.skinWeight.length).toBe(b.model.positions.length / 3 * 4);
  });
  test("every sheet is a fighter in the roster, and every fighter wears its own sheet", () => {
    expect(ROSTER.map((c) => c.id).sort()).toEqual([...ids].sort());
  });
});

describe("wings are the tips high up and out to the side", () => {
  // a 2 m tall, 2 m wide beast: joint 0 its root, then tips at (x, y, z)
  const rig = (tips: readonly (readonly [number, number, number])[]) => ({ rig: { joints: new Float32Array([0, 1, 0, ...tips.flat()]) }, tips: tips.map((_, i) => i + 1) });
  test.each([
    ["a wide pair counts with or without the sheet's count", [[-0.3, 1.5, 0.8], [-0.3, 1.5, -0.8]], [1, 2], [1, 2]],
    ["a pair folded upright over the back only with the sheet's count", [[-0.3, 1.9, 0.3], [-0.3, 1.9, -0.3]], [], [1, 2]],
    ["a lone horn on the centreline never", [[0.5, 1.9, 0.05], [-0.3, 1.9, 0.3], [-0.3, 1.9, -0.3]], [], [2, 3]],
    ["the count prefers the wide pair over a folded one", [[-0.3, 1.9, 0.3], [-0.3, 1.9, -0.3], [0, 1.2, 0.9], [0, 1.2, -0.9]], [3, 4], [3, 4]],
  ] as const)("%s", (_what, tips, loose, counted) => {
    const r = rig(tips);
    expect(wingsOf(r.rig, r.tips, 2, 2)).toEqual([...loose]);
    expect(wingsOf(r.rig, r.tips, 2, 2, 2)).toEqual([...counted]);
  });
});

type D = Record<"headX" | "headY" | "spread" | "frontX" | "frontY" | "rootY" | "tailY" | "h", number>;

describe("a puppet follows its fighter", () => {
  const c = ROSTER.find((x) => x.archetype === "tank")!;
  const fighter = (): Fighter => newMatch(c, c).f[0];

  test("standing still the feet stay planted; walking, they step and keep up", async () => {
    const b = await beast(c.id);
    const p = new Puppet(b, body(c));
    const f = fighter();
    f.pos = { x: 0, y: 0, z: 0 }; f.vel = { x: 0, y: 0, z: 0 }; f.yaw = 0; f.onGround = true;
    for (let i = 0; i < 30; i++) p.update(f, 1 / 60, i);
    const before = p.feetWorld();
    for (let i = 30; i < 60; i++) p.update(f, 1 / 60, i);
    for (const [k, v] of p.feetWorld().entries()) expect(v.distanceTo(before[k]!)).toBeLessThan(0.03);
    // walk 4 m/s along +x for two seconds: every foot steps, and ends within a stride of where it rests
    f.vel = { x: 4, y: 0, z: 0 };
    let stepped = 0;
    for (let i = 60; i < 180; i++) {
      f.pos.x += 4 / 60;
      const was = p.feetWorld();
      p.update(f, 1 / 60, i);
      if (p.feetWorld().some((v, k) => v.distanceTo(was[k]!) > 1e-4)) stepped++;
    }
    expect(stepped).toBeGreaterThan(10);
    expect(p.drift()).toBeLessThan(2 * p.stride(4));
    // and all the bones moved into place: the root rides the fighter
    expect(p.group.position.x).toBeCloseTo(f.pos.x, 5);
  }, 30_000);

  test("in the air the feet let go of the ground", async () => {
    const b = await beast(c.id);
    const p = new Puppet(b, body(c));
    const f = fighter();
    f.pos = { x: 0, y: 0, z: 0 }; f.vel = { x: 0, y: 0, z: 0 }; f.onGround = true;
    for (let i = 0; i < 20; i++) p.update(f, 1 / 60, i);
    f.onGround = false; f.pos.y = 2; f.vel.y = 3;
    for (let i = 20; i < 60; i++) p.update(f, 1 / 60, i);
    for (const v of p.feetWorld()) expect(v.y).toBeGreaterThan(1);
  }, 30_000);
});

describe("a puppet looks, swings its tail, and puts its body into an attack", () => {
  test("every beast has a head to look with; the long-tailed ones a tail", async () => {
    for (const id of ids) {
      const b = await beast(id);
      const { head, tail } = headAndTail(b.rig, b.sheet);
      expect(head.length).toBeGreaterThan(0);
      for (const t of head) expect(b.sheet.feet).not.toContain(t);
      if (id === "hodag" || id === "jersey-devil") expect(tail).not.toBeNull();
    }
  });

  // Hold an attack at the end of its wind-up and compare the head and front feet with the same beast standing.
  test.each([
    ["heavy", "the head thrusts forward", (head: number, _front: number) => expect(head).toBeGreaterThan(0.03)],
    ["launcher", "the front feet leave the ground", (_head: number, front: number) => expect(front).toBeGreaterThan(0.03)],
  ] as const)("%s: %s", async (slot, _what, check) => {
    const c = ROSTER.find((x) => x.archetype === "tank")!;
    const b = await beast(c.id);
    const pose = (attack: boolean) => {
      const p = new Puppet(b, body(c));
      const f = newMatch(c, c).f[0];
      f.pos = { x: 0, y: 0, z: 0 }; f.vel = { x: 0, y: 0, z: 0 }; f.yaw = 0; f.onGround = true;
      let head = -Infinity, front = -Infinity;   // the peak while held: the strike is the extreme of the pose, not any one frame
      for (let i = 0; i < 80; i++) {
        if (attack) { f.state = "attack"; f.act = { move: f.moves[slot], hit: false, dive: false }; f.t = Math.min(i, frames(f.moves[slot]).startup); }
        p.update(f, 1 / 60, i, { x: 5, y: 0, z: 0 });
        head = Math.max(head, ...p.headWorld().map((v) => v.x)); front = Math.max(front, ...p.feetWorld().filter((v) => v.x > 0).map((v) => v.y));
      }
      return { head, front };
    };
    const rest = pose(false), hit = pose(true);
    check(hit.head - rest.head, hit.front - rest.front);
  }, 30_000);


  // A signature's own motion, held at `at` of its wind-up (1 is the strike) and compared with the same beast
  // throwing the same move without it.
  const measure = async (id: string, at: number, motion: boolean) => {
    const c = ROSTER.find((x) => x.id === id)!;
    const p = new Puppet(await beast(id), body(c), c.archetype);
    const f = newMatch(c, c).f[0];
    f.pos = { x: 0, y: 0, z: 0 }; f.vel = { x: 0, y: 0, z: 0 }; f.yaw = 0; f.onGround = true;
    const move = motion ? f.moves.ultimate : { ...f.moves.ultimate, motion: undefined };
    const { startup } = frames(move);
    for (let i = 0; i < 40; i++) {
      f.state = "attack"; f.act = { move, hit: false, dive: false }; f.t = Math.round(startup * at);
      p.update(f, 1 / 60, i, { x: 5, y: 0, z: 0 });
    }
    const head = p.headWorld(), front = p.feetWorld().filter((v) => v.x > 0), tail = p.tailWorld();
    return {
      headX: Math.max(...head.map((v) => v.x)), headY: Math.max(...head.map((v) => v.y)),
      spread: Math.max(...head.map((v) => v.z)) - Math.min(...head.map((v) => v.z)),
      frontX: Math.max(...front.map((v) => v.x)), frontY: Math.max(...front.map((v) => v.y)),
      rootY: p.rootWorld().y, tailY: tail?.y ?? 0, h: body(c).height,
    };
  };
  test.each([
    ["kelpie", "a grab reaches out through the wind-up", 0.65, (d: D) => { expect(d.headX).toBeGreaterThan(0.03 * d.h); expect(d.frontX).toBeGreaterThan(0.03 * d.h); }],
    ["kelpie", "a grab pulls the feet back on the strike", 1, (d: D) => { expect(d.frontX).toBeLessThan(0); }],
    ["hydra", "a shake swings the head tips apart", 1, (d: D) => { expect(Math.abs(d.spread)).toBeGreaterThan(0.03 * d.h); }],
    ["tanuki", "a drum bounces the body and beats the belly", 1, (d: D) => { expect(d.frontY).toBeGreaterThan(0.03 * d.h); expect(d.rootY).not.toBe(0); }],
    ["manticore", "a volley rears the tail", 0.65, (d: D) => { expect(d.tailY).toBeGreaterThan(0.1 * d.h); }],
    ["jersey-devil", "a shriek throws the head back and rears up", 1, (d: D) => { expect(d.headY).toBeGreaterThan(0.05 * d.h); expect(d.frontY).toBeGreaterThan(0.03 * d.h); }],
    ["tarasque", "a roll dips the body", 1, (d: D) => { expect(d.rootY).toBeLessThan(-0.02 * d.h); }],
  ] as const)("%s: %s", async (id, _what, at, check) => {
    const rest = await measure(id, at, false), hit = await measure(id, at, true);
    check({ ...(Object.fromEntries(Object.keys(rest).map((k) => [k, hit[k as keyof typeof hit] - rest[k as keyof typeof rest]])) as D), h: rest.h });
  }, 30_000);

  test("a heavy coils before it strikes: mid wind-up the head is behind where it rests, at the strike ahead of it", async () => {
    const c = ROSTER.find((x) => x.archetype === "bruiser")!;
    const b = await beast(c.id);
    const headAt = (t: number | null) => {
      const p = new Puppet(b, body(c), c.archetype);
      const f = newMatch(c, c).f[0];
      f.pos = { x: 0, y: 0, z: 0 }; f.vel = { x: 0, y: 0, z: 0 }; f.yaw = 0; f.onGround = true;
      for (let i = 0; i < 40; i++) {
        if (t !== null) { f.state = "attack"; f.act = { move: f.moves.heavy, hit: false, dive: false }; f.t = t; }
        p.update(f, 1 / 60, i, { x: 5, y: 0, z: 0 });
      }
      return Math.max(...p.headWorld().map((v) => v.x));
    };
    const { startup } = frames(c.moves.find((m) => m.slot === "heavy")!);
    const rest = headAt(null);
    expect(headAt(Math.round(startup * 0.6))).toBeLessThan(rest - 0.02);
    expect(headAt(startup)).toBeGreaterThan(rest + 0.03);
  }, 30_000);

  test("a strike stops where the bodies meet: with the other fighter close, the head stays on its own side", async () => {
    const c = ROSTER.find((x) => x.archetype === "bruiser")!;
    const b = await beast(c.id);
    const strikeHead = (foe: number) => {
      const p = new Puppet(b, body(c), c.archetype);
      const f = newMatch(c, c).f[0];
      f.pos = { x: 0, y: 0, z: 0 }; f.vel = { x: 0, y: 0, z: 0 }; f.yaw = 0; f.onGround = true;
      let head = -Infinity;
      for (let i = 0; i < 60; i++) {
        f.state = "attack"; f.act = { move: f.moves.heavy, hit: false, dive: false }; f.t = Math.min(i, frames(f.moves.heavy).startup);
        p.update(f, 1 / 60, i, { x: foe, y: 0, z: 0 });
        head = Math.max(head, ...p.headWorld().map((v) => v.x));
      }
      return head;
    };
    const far = strikeHead(8);
    const near = far * 1.6;   // the other's middle: half of it is less than the open strike reaches
    expect(strikeHead(near)).toBeLessThan(near / 2 + 0.05);
    expect(far).toBeGreaterThan(near / 2 + 0.05);
  }, 30_000);
});

test("a landing squashes the body, which springs back; each step is reported where the foot came down", async () => {
  const c = ROSTER.find((x) => x.archetype === "tank")!;
  const p = new Puppet(await beast(c.id), body(c), c.archetype);
  const steps: number[] = [];
  p.onStep = (at) => steps.push(at.x);
  const f = newMatch(c, c).f[0];
  f.pos = { x: 0, y: 2, z: 0 }; f.vel = { x: 0, y: -8, z: 0 }; f.yaw = 0; f.onGround = false;
  for (let i = 0; i < 20; i++) p.update(f, 1 / 60, i);
  f.pos.y = 0; f.vel.y = 0; f.onGround = true;
  p.update(f, 1 / 60, 20);
  const landed = p.rootWorld().y;
  for (let i = 21; i < 80; i++) p.update(f, 1 / 60, i);
  expect(p.rootWorld().y).toBeGreaterThan(landed + 0.02);
  expect(steps.length).toBe(0);
  f.vel = { x: 4, y: 0, z: 0 };
  for (let i = 80; i < 200; i++) { f.pos.x += 4 / 60; p.update(f, 1 / 60, i); }
  expect(steps.length).toBeGreaterThan(4);
  for (const x of steps) expect(x).toBeGreaterThan(0);
}, 30_000);

test("a glowing part keeps its glow after a hit's flash fades", async () => {
  const c = ROSTER.find((x) => x.id === "jersey-devil")!;
  const p = new Puppet(await beast(c.id), body(c));
  const eye = p.materials.find((m) => m.emissiveIntensity > 1)!;
  const red = eye.emissive.getHex();
  expect(eye.emissive.r).toBeGreaterThan(eye.emissive.g * 4);
  p.flash(0xffffff, 0.6);
  expect(eye.emissive.getHex()).toBe(0xffffff);
  p.flash(0xffffff, 0);
  expect(eye.emissive.getHex()).toBe(red);
  expect(eye.emissiveIntensity).toBeGreaterThan(1);
});

// The sim's input type is what a puppet never sees; keep the import honest.
void IDLE;
