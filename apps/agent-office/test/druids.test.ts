import { expect, test } from "bun:test";
import { CAST, ENEMIES, PLAYER, RACES, bareClip, clipName, personRole, raceFor, roleFor, type Pose, type Role } from "../druids/cast.ts";
import { MODELS } from "../druids/assets.ts";
import { forestColor, hexToHsl } from "../druids/palette.ts";
import { DESK_TOP, fitDesks } from "../druids/room.ts";

const at = (p: Partial<Pose>): Pose =>
  ({ status: "idle", bouncing: false, bounceT: 0, cheerT: 0, walking: false, dancing: null, leaving: null, jailed: null, ...p });

test("office poses map to roles", () => {
  expect(roleFor(at({}))[0]).toBe("idle");
  expect(roleFor(at({ status: "working" }))[0]).toBe("cast");
  expect(roleFor(at({ status: "working", action: "test" }))[0]).toBe("test");
  expect(roleFor(at({ status: "working", action: "read" }))[0]).toBe("read");
  expect(roleFor(at({ status: "done", bouncing: true }))[0]).toBe("victory");
  expect(roleFor(at({ status: "needs_input", bounceT: 1 }))[0]).toBe("jump");
  expect(roleFor(at({ status: "working", walking: true }))[0]).toBe("walk");
  expect(roleFor(at({ leaving: {}, walking: true }))[0]).toBe("carry");
  expect(roleFor(at({ jailed: { dead: true } }))).toEqual(["death", false]);
});

test("workers are enemies, every one of them before anyone doubles up; you're Qoa", () => {
  const names = Array.from({ length: ENEMIES.length + 2 }, (_, i) => `Worker ${i}`);
  const taken: string[] = [];
  for (const n of names) taken.push(raceFor(n, taken));
  expect(new Set(taken.slice(0, ENEMIES.length)).size).toBe(ENEMIES.length);
  expect(taken).not.toContain(PLAYER);
  expect(taken).not.toContain("druid");
  expect(raceFor("Pixel")).toBe(raceFor("Pixel"));
  expect(personRole(true, false, 2)).toBe("run");
  expect(clipName(PLAYER, "run")).toBe("running");
});

test("the palette turns the office's pastels into the forest", () => {
  const green = (hex: number) => { const { h } = hexToHsl(hex); return h > 60 && h < 160; };
  expect(green(forestColor(0x8ecae6))).toBe(true); // sky blue → moss
  expect(green(forestColor(0x7c5cff))).toBe(true); // purple → fern
  expect(hexToHsl(forestColor(0xfff6ea, "wall")).l).toBeLessThan(0.5); // cream walls → timber
  expect(hexToHsl(forestColor(0xffffff)).l).toBeGreaterThan(0.6); // whites stay light: birch
});

// these read the downloaded models, so they need `bun scripts/rustybunsify.ts` to have run
const dir = `${import.meta.dir}/../office/dist/public/druids/models`;
const glb = async (path: string) => {
  const f = Bun.file(`${dir}/${path}.glb`);
  if (!(await f.exists())) return null;
  const b = new Uint8Array(await f.arrayBuffer());
  return JSON.parse(new TextDecoder().decode(b.subarray(20, 20 + new DataView(b.buffer).getUint32(12, true))));
};

test("every model is there", async () => {
  if (!(await glb(CAST.druid.file))) return console.warn("no ./office yet; run bun scripts/rustybunsify.ts");
  for (const m of MODELS) expect(await glb(m), m).not.toBeNull();
});

test("every clip a race is given is in its model", async () => {
  const roles: Role[] = ["idle", "walk", "run", "cast", "test", "read", "victory", "jump", "hit", "carry", "defeat", "death"];
  for (const race of RACES) {
    const json = await glb(CAST[race].file);
    if (!json) return;
    const clips = new Set(json.animations.map((a: { name: string }) => bareClip(a.name)));
    expect(roles.map((r) => clipName(race, r)).filter((c) => !clips.has(c)), race).toEqual([]);
  }
});

test("desk colliders shrink to the Druid Panel lectern on each desk, and the desk is still in reach", () => {
  // a pod as the office lays it out: two back-to-back 2.2 x 1.1 m desks, and its collider for each (DESK_SIZE)
  const desk = (z: number) => ({ minX: -1.05, maxX: 1.05, minZ: z - 0.53, maxZ: z + 0.53, bottom: 0, top: DESK_TOP });
  const back = desk(-0.55), front = desk(0.55);
  const kiosk = { minX: -0.4, maxX: 0.4, minZ: -0.25, maxZ: 0.9, bottom: 0, top: 1.5, fence: true };
  const away = desk(10);
  const colliders = [back, front, kiosk, away];
  // a 1.2 m lectern on each desk, 5 cm back from its agent
  const lectern = (z: number) => ({ minX: -0.6, maxX: 0.6, minZ: z - 0.6, maxZ: z + 0.6 });
  const lecterns = [lectern(-0.5), lectern(0.5)];
  fitDesks(colliders, lecterns, 1.4);
  expect(back).toMatchObject({ minX: -0.6, maxX: 0.6, top: 1.4 });
  expect(back.minZ).toBeCloseTo(-1.08);
  expect(back.maxZ).toBeCloseTo(-0.02);
  expect(front).toMatchObject({ minX: -0.6, maxX: 0.6, top: 1.4 });
  expect(front.minZ).toBeCloseTo(0.02);
  expect(front.maxZ).toBeCloseTo(1.08);
  expect(kiosk.top).toBe(1.5);
  expect(away).toEqual(desk(10));
  // again, as the 2 s sweep does: nothing moves
  fitDesks(colliders, lecterns, 1.4);
  expect(front.maxZ).toBeCloseTo(1.08);
  // the desk's interact zone (1.25 m out from the desk, 1.3 m round) reaches past the collider's edge
  expect(0.55 + 1.25 - 1.3).toBeLessThan(front.maxZ + 0.32);
});
