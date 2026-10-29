import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { rigFromWire } from "@rustybuns/rig";
import { int, obj, opt } from "@rustybuns/util/guard";
import { loadGlb } from "@rustybuns/rig/model";
import { BeastRig, headAndTail, Puppet, type Beast } from "../src/beasts.ts";
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
    for (const [k, v] of p.feetWorld().entries()) expect(v.distanceTo(before[k]!)).toBeLessThan(0.02);
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
      for (let i = 0; i < 40; i++) {
        if (attack) { f.state = "attack"; f.act = { move: f.moves[slot], hit: false, dive: false }; f.t = Math.min(i, frames(f.moves[slot]).startup); }
        p.update(f, 1 / 60, i, { x: 5, y: 0, z: 0 });
      }
      return { head: Math.max(...p.headWorld().map((v) => v.x)), front: Math.max(...p.feetWorld().filter((v) => v.x > 0).map((v) => v.y)) };
    };
    const rest = pose(false), hit = pose(true);
    check(hit.head - rest.head, hit.front - rest.front);
  }, 30_000);
});

test("a glowing part keeps its glow after a hit's flash fades", async () => {
  const c = ROSTER.find((x) => x.archetype === "flyer")!;
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
