// The studio builder as someone uses it: start from a room, put up a booth, move the drums into it and hear the kit
// go dry, line the room and hear it tighten, get told why an edit that would break the room can't be done, and
// keep a studio /jam.html can load back. Then every room the builder ships: buildable, and ringing as it says.
import { expect, test } from "bun:test";
import { check } from "@rustybuns/util/guard";
import { Edit, edit, problems, Studio } from "../src/studio/builder.ts";
import type { StudioDef } from "../src/studio/room.ts";
import { BARN, BASEMENT, ROOM_LIST, ROOMS } from "../src/studio/rooms/index.ts";
import { type Acoustics, acoustics, impulse } from "../src/studio/sound.ts";
import { keyNote, nearSpot, newJam, RADIUS, sit, solids, stand, walkTo, type Jam } from "../src/studio/jam.ts";
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
  for (const id of ["desk-concert", "orchestra-room", "console-room"]) {
    const room = ROOMS[id], j = newJam(room);
    for (const s of room.spots) {
      expect({ id, seat: s.id, reached: walkUpTo(j, s.id) }).toEqual({ id, seat: s.id, reached: true });
      expect(nearSpot(j)?.id).toBe(s.id);
      expect(sit(j, s.id)).toEqual({ ok: true });
      // at an instrument, a key plays its track
      if (s.kind === "keys" || s.kind === "bass" || s.kind === "drums") expect(keyNote(j, groove, "KeyA")).not.toBeNull();
      stand(j);
    }
    // the dressing builds, and its lamps and screens glow for the look to light
    const glows = (room.props ?? []).map((p) => prop(p)).flatMap((g) => g.children).filter((o) => o.userData.glow);
    expect({ id, glows: glows.length > 0 }).toEqual({ id, glows: true });
  }
});
