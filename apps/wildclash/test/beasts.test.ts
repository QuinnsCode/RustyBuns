import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { loadGlb } from "../../auto-rig/src/ui/model.ts";
import { rigFromWire } from "../../auto-rig/src/rig/codec.ts";
import { BEASTS, BeastRig, Puppet, type Beast } from "../src/beasts.ts";
import { body, ROSTER } from "../src/roster.ts";
import { IDLE, newMatch, type Fighter } from "../src/sim.ts";

// Every sheet in beasts/ has been built (bun scripts/beasts.ts): a GLB and a rig sidecar whose feet match the
// sheet. Blender isn't needed here; the files are checked in.
const APP = join(import.meta.dir, "..");
const ids = readdirSync(join(APP, "beasts")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));

async function beast(id: string): Promise<Beast> {
  const sheet = BeastRig(await Bun.file(join(APP, "public", "models", `${id}.rig.json`)).json());
  const model = await loadGlb(await Bun.file(join(APP, "public", "models", `${id}.glb`)).arrayBuffer(), id);
  const t = (a: number[]): [number, number, number] => [a[0]!, a[1]!, a[2]!];
  return { model, sheet, rig: rigFromWire({ ...sheet, grid: { ...sheet.grid, dims: t(sheet.grid.dims), origin: t(sheet.grid.origin) } }) };
}

describe("every beast sheet is built and rigged", () => {
  test.each(ids)("%s: a GLB, and a rig whose feet match the sheet", async (id) => {
    const expected = (await Bun.file(join(APP, "beasts", `${id}.json`)).json()) as { feet: number };
    const b = await beast(id);
    expect(b.model.triangles).toBeGreaterThan(100);
    expect(b.sheet.feet.length).toBe(expected.feet);
    expect(b.rig.skinWeight.length).toBe(b.model.positions.length / 3 * 4);
  });
  test("every archetype's beast is a sheet", () => {
    for (const id of Object.values(BEASTS)) expect(ids).toContain(id);
  });
});

describe("a puppet follows its fighter", () => {
  const c = ROSTER.find((x) => x.archetype === "tank")!;
  const fighter = (): Fighter => newMatch(c, c).f[0];

  test("standing still the feet stay planted; walking, they step and keep up", async () => {
    const b = await beast(BEASTS.tank!);
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
    expect(p.drift()).toBeLessThan(2 * p.stride());
    // and all the bones moved into place: the root rides the fighter
    expect(p.group.position.x).toBeCloseTo(f.pos.x, 5);
  }, 30_000);

  test("in the air the feet let go of the ground", async () => {
    const b = await beast(BEASTS.tank!);
    const p = new Puppet(b, body(c));
    const f = fighter();
    f.pos = { x: 0, y: 0, z: 0 }; f.vel = { x: 0, y: 0, z: 0 }; f.onGround = true;
    for (let i = 0; i < 20; i++) p.update(f, 1 / 60, i);
    f.onGround = false; f.pos.y = 2; f.vel.y = 3;
    for (let i = 20; i < 60; i++) p.update(f, 1 / 60, i);
    for (const v of p.feetWorld()) expect(v.y).toBeGreaterThan(1);
  }, 30_000);
});

// The sim's input type is what a puppet never sees; keep the import honest.
void IDLE;
