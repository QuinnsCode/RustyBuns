// The studio builder as someone uses it: start from a room, put up a booth, move the drums into it and hear the kit
// go dry, line the room and hear it tighten, get told why an edit that would break the room can't be done, and
// keep a studio /jam.html can load back. Then every room the builder ships: buildable, and ringing as it says.
import { DESERT_GATHERING } from "../src/studio/rooms/desert-gathering.ts";
import { expect, test } from "bun:test";
import { check } from "@rustybuns/util/guard";
import { Edit, edit, furnish, problems, Studio } from "../src/studio/builder.ts";
import type { StudioDef } from "../src/studio/room.ts";
import { BARN, BASEMENT, ROOM_LIST, ROOMS } from "../src/studio/rooms/index.ts";
import { type Acoustics, acoustics, impulse } from "../src/studio/sound.ts";
import { cameraPose, keyNote, nearSpot, newJam, RADIUS, sit, solids, stand, walkTo, type Jam } from "../src/studio/jam.ts";
import { pushOut } from "../src/studio/walk.ts";
import { prop } from "../src/studio/props.ts";
import { demoProject } from "../src/presets.ts";

const ok = (r: StudioDef, e: unknown) => {
  const out = edit(r, check(Edit, e)!);
  if (!out.ok) throw new Error(out.why);
  return out.def;
};
const at = (r: StudioDef, id: string) => r.spots.find((s) => s.id === id)!;
const heard = (r: StudioDef, id: string) => acoustics(r, at(r, id));

test("put up a drum booth, line the barn, and an edit that would break the room says why", () => {
  let r = structuredClone(BARN);
  const roomy = heard(r, "drums");
  expect(roomy.word).toBe("live");

  // A booth by the back wall, and the kit dragged into it: the drums now hear the booth, not the barn.
  r = ok(r, { t: "booth", id: "drum-booth", at: [-3, -5], w: 3, d: 3 });
  r = ok(r, { t: "move", id: "drums", at: [-3, -5] });
  const dry = heard(r, "drums");
  expect(dry).toMatchObject({ word: "dead", space: { closed: true } });
  expect(dry.mid).toBeLessThan(roomy.mid / 5);
  // The booth moves with the kit inside it.
  r = ok(r, { t: "moveBooth", id: "drum-booth", at: [-3, -4.5] });
  expect(at(r, "drums").at).toEqual([-3, -4.5]);

  // Absorbers on the front wall and a carpet: the barn rings for less, the highs most of all.
  const before = heard(r, "bass");
  r = ok(r, { t: "panel", wall: "front", material: "foam", m2: 30 });
  r = ok(r, { t: "surface", surface: "floor", material: "carpet" });
  const after = heard(r, "bass");
  expect(after.mid).toBeLessThan(before.mid);
  expect(after.rt60[5] / before.rt60[5]).toBeLessThan(after.rt60[0] / before.rt60[0]);

  // Edits that would leave the room half built hand back the same room and why.
  expect(edit(r, { t: "size", w: 7, d: 10, h: 7 })).toMatchObject({ ok: false, def: r, why: expect.stringContaining("booth sticks out of the room") });
  expect(edit(r, { t: "move", id: "keys", at: [9, 0] })).toMatchObject({ ok: false, why: "keys is outside the room's walls" });
  expect(edit(r, { t: "move", id: "keys", at: [-2.5, -1.5] })).toMatchObject({ ok: false, why: "bass and keys are on top of each other" });
  expect(edit(r, { t: "move", id: "keys", at: [-1.5, -4.5] })).toMatchObject({ ok: false, why: "keys is in a wall" });
  expect(edit(r, { t: "panel", wall: "front", material: "glass", m2: 50 })).toMatchObject({ ok: false });
  // An edit from the wire is checked before it is done.
  expect(check(Edit, { t: "surface", surface: "roof", material: "foam" })).toBeNull();
  expect(check(Edit, { t: "spot", id: "Kick Drum!", kind: "drums", at: [0, 0] })).toBeNull();

  // What the builder keeps comes back through the same check /jam.html?studio=yours reads it with.
  expect(check(Studio, JSON.parse(JSON.stringify(r)))).toEqual(JSON.parse(JSON.stringify(r)));
  expect(check(Studio, { ...r, size: { w: 900, d: 9, h: 3 } })).toBeNull();

  // Taking the booth down leaves the kit standing in the barn again.
  r = ok(r, { t: "unbooth", id: "drum-booth" });
  expect(heard(r, "drums").space.closed).toBe(false);
  expect(problems(r)).toEqual([]);
});

test("build mode: wall a corner off round the keys, knock a doorway through, turn the keys, and take the wall down again", () => {
  let r = structuredClone(BARN);
  expect(heard(r, "keys").space.closed).toBe(false);
  // two walls from the outside walls meet in the room: the keys' corner is a room of its own
  r = ok(r, { t: "addWall", from: [1, -7], to: [1, 0] });
  r = ok(r, { t: "addWall", from: [1, 0], to: [5, 0] });
  const corner = heard(r, "keys").space;
  expect(corner.closed).toBe(true);
  expect(corner.floor).toBeLessThan(r.size.w * r.size.d / 2);
  // a doorway in the middle of the second wall, and bricked up again
  const last = r.walls.length - 1;
  r = ok(r, { t: "door", index: last });
  expect(r.walls[last]!.gaps).toEqual([[1.55, 2.45]]);
  expect(ok(r, { t: "door", index: last }).walls[last]!.gaps).toBeUndefined();
  // a quarter turn is two eighths
  r = ok(r, { t: "turn", id: "keys", by: 2 });
  expect(at(r, "keys").yaw).toBeCloseTo(at(BARN, "keys").yaw + Math.PI / 2, 6);
  // what can't be built says why: a stub of a wall, a wall through a seat, one side of a booth
  expect(edit(r, { t: "addWall", from: [0, 0], to: [0.2, 0] })).toMatchObject({ ok: false, why: "a wall is at least 50 cm long" });
  expect(edit(r, { t: "addWall", from: [-3.5, -1.5], to: [-1.5, -1.5] })).toMatchObject({ ok: false, why: "bass is in a wall" });
  expect(edit(r, { t: "unwall", index: r.walls.findIndex((x) => x.booth) })).toMatchObject({ ok: false, why: expect.stringContaining("take the booth down") });
  // dress it: a plant at real size, turned a quarter, moved, and taken out again
  const n = r.props?.length ?? 0;
  r = ok(r, { t: "addProp", kind: "plant", at: [4.2, -1] });
  expect(r.props![n]).toMatchObject({ kind: "plant", at: [4.2, -1], w: 0.6, h: 1.4 });
  r = ok(r, { t: "turnProp", index: n, by: 2 });
  r = ok(r, { t: "moveProp", index: n, at: [4.2, -1.5] });
  expect(r.props![n]!.at).toEqual([4.2, -1.5]);
  expect(r.props![n]!.yaw).toBeCloseTo(Math.PI / 2, 6);
  expect(edit(r, { t: "moveProp", index: n + 5, at: [0, 0] })).toMatchObject({ ok: false, why: "there is no such thing" });
  r = ok(r, { t: "unprop", index: n });
  expect(r.props?.length ?? 0).toBe(n);
  // a window in the back wall, facing in; none too near a corner; the way in moved along the front
  const w0 = r.props?.length ?? 0;
  r = ok(r, { t: "window", side: "back", along: -2 });
  expect(r.props![w0]).toMatchObject({ kind: "window", at: [-2, -r.size.d / 2 + 0.06], y: 1 });
  expect(r.props![w0]!.yaw).toBeCloseTo(Math.PI, 6);
  expect(edit(r, { t: "window", side: "back", along: r.size.w / 2 - 0.3 })).toMatchObject({ ok: false, why: "a window needs 80 cm of wall either side of it" });
  r = ok(r, { t: "moveDoor", at: [-3, 6] });
  expect(r.door.at).toEqual([-3, 6]);
  expect(edit(r, { t: "moveDoor", at: [30, 0] })).toMatchObject({ ok: false, why: "the way in is outside the room" });
  // what stands at the keys and the bass: a combo organ and the bass-line box
  r = ok(r, { t: "instruments", keys: "combo", bass: "box" });
  expect([r.keys, r.bass]).toEqual(["combo", "box"]);
  expect(check(Edit, { t: "instruments", keys: "theremin" })).toBeNull();
  // a rig only stands out of doors: indoors it's refused, on the sand the stacks become it
  expect(edit(r, { t: "instruments", rig: "synergy" })).toMatchObject({ ok: false, why: "a rig stands out of doors" });
  expect(ok(DESERT_GATHERING, { t: "instruments", rig: "synergy" }).outdoor?.rig).toBe("synergy");
  // a camper van and a fire pit park only out of doors
  expect(edit(r, { t: "addProp", kind: "van", at: [0, 0] })).toMatchObject({ ok: false, why: "that stands out of doors" });
  expect(ok(DESERT_GATHERING, { t: "addProp", kind: "firePit", at: [6, 12] }).props?.at(-1)?.kind).toBe("firePit");
  // the first new wall down: the corner opens back onto the barn
  r = ok(r, { t: "unwall", index: r.walls.findIndex((x) => x.from[0] === 1 && x.from[1] === -7) });
  expect(heard(r, "keys").space.closed).toBe(false);
  expect(check(Studio, JSON.parse(JSON.stringify(r)))).toEqual(JSON.parse(JSON.stringify(r)));
});

test("the impulse response follows the space: the floor's bounce first, then a tail as long as it rings", () => {
  const rate = 16000;
  const room = impulse(BASEMENT, "keys", rate), booth = impulse(BASEMENT, "drums", rate);
  expect(room.l.length).toBeGreaterThan(booth.l.length * 2);
  // The floor is the nearest surface to a source 1.2 m up.
  expect([...room.early].sort((a, b) => a.ms - b.ms)[0].face).toBe("floor");
  // The tail dies away: the last quarter is far quieter than the first.
  const energy = (a: Float32Array, from: number, to: number) => a.subarray(Math.floor(from * a.length), Math.floor(to * a.length)).reduce((t, x) => t + x * x, 0);
  expect(energy(room.l, 0.75, 1)).toBeLessThan(energy(room.l, 0.02, 0.25) / 100);
  // Seeded: the same room gives the same response; left and right differ.
  expect(impulse(BASEMENT, "keys", rate).l).toEqual(room.l);
  expect(room.r).not.toEqual(room.l);
});

test("every room can be built, loads in /jam.html, and rings as it says", () => {
  // The room's middle, and the seat walled off from it.
  const rings: Record<string, [Acoustics["word"], string, Acoustics["word"]]> = {
    "live-room": ["tight", "booth", "dead"], "scoring-hall": ["big", "desk", "warm"], basement: ["warm", "drums", "dead"],
    "stone-room": ["huge", "vocal", "huge"], barn: ["live", "vocal", "dead"], "desk-concert": ["tight", "vocal", "tight"], "orchestra-room": ["big", "piano", "big"], "console-room": ["tight", "vocal", "tight"],
    "sound-stage": ["tight", "vocal", "tight"],
    // out on the sand under open sky only the ground throws anything back: short and dry
    "desert-gathering": ["tight", "dj", "tight"],
  };
  for (const r of ROOM_LIST) {
    expect({ id: r.id, problems: problems(r), loads: check(Studio, r) !== null }).toEqual({ id: r.id, problems: [], loads: true });
    const [middle, seat, there] = rings[r.id];
    expect({ id: r.id, middle: acoustics(r).word, [seat]: heard(r, seat).word }).toEqual({ id: r.id, middle, [seat]: there });
  }
});

/** Walk from where you stand to within reach of seat `id`, round whatever is in the way: a path over a 10 cm grid. */
function walkUpTo(j: Jam, id: string) {
  const { w, d } = j.def.size, g = 0.1, nx = Math.round(w / g), nz = Math.round(d / g), solid = solids(j.def);
  const mid = (i: number, n: number, size: number) => -size / 2 + (i + 0.5) * size / n;
  const free = (x: number, z: number) => { const p = { x, z }; pushOut(p, solid, w / 2, d / 2, RADIUS); return Math.hypot(p.x - x, p.z - z) < 1e-6; };
  const s = j.def.spots.find((x) => x.id === id)!, cellOf = (x: number, z: number) => Math.floor((z + d / 2) / g) * nx + Math.floor((x + w / 2) / g);
  const from = new Map<number, number>([[cellOf(j.me.x, j.me.z), -1]]), queue = [cellOf(j.me.x, j.me.z)];
  let end = -1;
  while (queue.length && end < 0) {
    const c = queue.shift()!, cx = c % nx, cz = Math.floor(c / nx);
    // close enough that it's the seat Space sits you at: in reach, and nearer than any other
    const near = (t: { at: number[] }) => Math.hypot(mid(cx, nx, w) - t.at[0], mid(cz, nz, d) - t.at[1]);
    if (near(s) < 1.1 && j.def.spots.every((t) => t === s || near(t) > near(s) + 0.3)) end = c;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = cx + dx, z = cz + dz, n = z * nx + x;
      if (x < 0 || z < 0 || x >= nx || z >= nz || from.has(n) || !free(mid(x, nx, w), mid(z, nz, d))) continue;
      from.set(n, c); queue.push(n);
    }
  }
  if (end < 0) return false;
  const path: number[] = [];
  for (let c = end; c >= 0; c = from.get(c)!) path.unshift(c);
  for (const c of path) walkTo(j, mid(c % nx, nx, w), mid(Math.floor(c / nx), nz, d));
  return true;
}

test("the new studios: walk in at the door, round the furniture to every seat, sit and play", () => {
  const groove = demoProject();
  for (const id of ["desk-concert", "orchestra-room", "console-room", "sound-stage", "desert-gathering"]) {
    const room = ROOMS[id], j = newJam(room);
    for (const s of room.spots) {
      expect({ id, seat: s.id, reached: walkUpTo(j, s.id) }).toEqual({ id, seat: s.id, reached: true });
      expect(nearSpot(j)?.id).toBe(s.id);
      expect(sit(j, s.id)).toEqual({ ok: true });
      // at an instrument, a key plays its track
      if (s.kind === "keys" || s.kind === "bass" || s.kind === "drums") expect(keyNote(j, groove, "KeyA")).not.toBeNull();
      // up on the sound stage's band riser, your eyes ride half a metre higher than at the floor mix desk
      if (id === "sound-stage") expect({ seat: s.id, eye: Math.round((cameraPose(j).at[1] - 1.35) * 10) / 10 + 0 }).toEqual({ seat: s.id, eye: ({ desk: 0, couch: 0.3 } as Record<string, number>)[s.id] ?? 0.5 });
      stand(j);
    }
    // the dressing builds, and its lamps and screens glow for the look to light
    const glows = (room.props ?? []).map((p) => prop(p)).flatMap((g) => g.children).filter((o) => o.userData.glow);
    if (!room.outdoor) expect({ id, glows: glows.length > 0 }).toEqual({ id, glows: true }); // out of doors the rig is the light (open-air.ts)
  }
});

test("Furnish dresses a room as a working studio, every piece one the builder could have put there, and it rings less", () => {
  for (const r of ROOM_LIST.filter((x) => !x.outdoor)) {
    const f = furnish(r), kinds = f.done.flatMap((e) => (e.t === "addProp" ? [e.kind] : []));
    expect(kinds, r.id).toContain("lamp");
    if (r.spots.some((s) => s.kind === "drums")) expect(kinds, r.id).toContain("rug");
    expect(problems(f.def), r.id).toEqual([]);
    expect(check(Studio, JSON.parse(JSON.stringify(f.def))), r.id).toEqual(JSON.parse(JSON.stringify(f.def)));
    expect(acoustics(f.def, f.def.spots[0]).mid, r.id).toBeLessThanOrEqual(acoustics(r, r.spots[0]).mid + 1e-9);
  }
});
