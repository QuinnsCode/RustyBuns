// Load In's gear: every id in #4849's table builds at its real size, sits on the floor, carries the jacks the
// sound and power math wires up (each on the outside, facing out) and a grab point, and stays cheap to draw.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { GEAR_IDS, GEAR_SIZES, RIG_IDS, RIG_SIZES, STOMP_SIZE, type GearId, gear, gearJacks, gearParts, gearPieces, rigging, stompbox } from "../src/gear.ts";
import { triangles } from "../src/index.ts";
import { LINEUP } from "../src/lineup.ts";
import { GEAR_IDS as catalogIds, gear as catalogGear, jackNames } from "../../gear/src/catalog.ts";

// The sound and power math's catalog (lane B). It imports nothing, so the models package can read it without a
// dependency on it; this pins the join: the same ids, sizes and jack names on both sides.
// The band night's mics, stage box, fan and backline are in the catalog only: Load In draws them itself (`hasModel`).
const UNMODELLED = ["mic-dynamic", "mic-kick", "stage-box-12", "snake-fan-12", "drum-kit", "bass-amp", "guitar-combo"];
const book = new Map(catalogIds.map((id) => [id, catalogGear(id)]));

test("the models and the catalog list the same gear at the same sizes", () => {
  expect<string[]>([...GEAR_IDS, ...UNMODELLED].sort()).toEqual([...catalogIds].sort());
  for (const id of GEAR_IDS) { const { w, h, d } = book.get(id)!.size; expect<number[]>([...GEAR_SIZES[id]]).toEqual([w, h, d]); }
});

test.each(GEAR_IDS)("%s builds at its size, on the floor, with its jacks facing out and a grab", (id) => {
  const g = gear(id);
  g.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(g), size = box.getSize(new THREE.Vector3()).toArray();
  size.forEach((s, i) => expect(Math.abs(s - GEAR_SIZES[id][i]) / GEAR_SIZES[id][i]).toBeLessThan(0.1));
  expect(Math.abs(box.min.y)).toBeLessThan(0.005);
  // the DJ table's mixer is seen from 40 cm under the DJ's hands, every control of the decks page's Qone face on it
  // and the touring rack carries its amps' real fronts
  expect(triangles(g)).toBeLessThan(id === "mixer-club-4" || id === "amp-rack-12u" ? 7000 : 5000);

  const jacks = gearJacks(g);
  expect([...jacks.keys()].sort()).toEqual(jackNames(book.get(id)!).sort());
  const centre = box.getCenter(new THREE.Vector3());
  for (const [name, j] of jacks) {
    const out = new THREE.Vector3(0, 0, 1).applyQuaternion(j.quaternion);
    // out of the box, not buried: a plug coming in along -z reaches it from outside the model, clear of the box, or
    // (a box lying tilted, as a floor monitor on its flat does) with nothing of it in the 10 cm in front of the jack
    expect(j.position.clone().sub(centre).dot(out), name).toBeGreaterThan(0);
    const from = j.position.clone().addScaledVector(out, 0.1), hit = new THREE.Raycaster(from, out.clone().negate()).intersectObject(g, true)[0];
    expect(box.distanceToPoint(j.position.clone().addScaledVector(out, 0.05)) > 0.03 || (hit?.distance ?? 1) > 0.095, name).toBe(true);
  }
  expect(g.getObjectByName("grab")).toBeDefined();
});

// The lineup (#5942): a new speaker gets its real product's row, and a model built to a product's sheet keeps its size.
test("every speaker copies a real product, at its published size once built to it", () => {
  const speakers = catalogIds.filter((id) => book.get(id)!.speaker).sort();
  expect(Object.keys(LINEUP).sort()).toEqual(speakers);
  for (const id of GEAR_IDS) {
    const published = LINEUP[id]?.published;
    if (published) expect<number[]>([...GEAR_SIZES[id]]).toEqual([...published]);
  }
});

// The boxes built from a maker's drawing piece by piece (`gearPieces`): put back together, the pieces are the box.
test("a box built piece by piece: its pieces fill the box's size, each one named and drawn", () => {
  const built = GEAR_IDS.flatMap((id) => { const p = gearPieces(id); return p ? [[id, p] as const] : []; });
  expect(built.map(([id]) => id)).toEqual(expect.arrayContaining(["stack-mid-high", "stack-mid-bass", "horn-sub-21"]));
  for (const [id, pieces] of built) {
    const all = new THREE.Box3();
    for (const { name, group } of pieces) {
      group.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(group);
      expect(b.isEmpty(), `${id}~${name}`).toBe(false);
      all.union(b);
    }
    all.getSize(new THREE.Vector3()).toArray().forEach((s, i) => expect(Math.abs(s - GEAR_SIZES[id][i]) / GEAR_SIZES[id][i], id).toBeLessThan(0.05));
    expect(new Set(pieces.map((p) => p.name)).size).toBe(pieces.length);
  }
});

test("copies share geometry; a stand opens to the height asked, kept between 1.2 and 2 m", () => {
  const a = gear("sub-18"), b = gear("sub-18");
  expect((a.children[0] as THREE.Mesh).geometry).toBe((b.children[0] as THREE.Mesh).geometry);
  for (const [ask, got] of [[1.6, 1.6], [3, 2]]) {
    const s = gear("stand-tripod", { height: ask });
    expect(new THREE.Box3().setFromObject(s).max.y).toBeCloseTo(got, 2);
    expect(s.getObjectByName("pole")!.position.y).toBeCloseTo(got, 5);
  }
});

test("a line array box hinges at its front, one box height between its top and bottom pins", () => {
  const g = gear("line-array-10"), top = g.getObjectByName("hinge-top")!.position, bottom = g.getObjectByName("hinge-bottom")!.position;
  expect(top.z).toBeGreaterThan(GEAR_SIZES["line-array-10"][2] / 4);
  expect(top.z).toBeCloseTo(bottom.z, 5);
  expect(top.y - bottom.y).toBeGreaterThan(GEAR_SIZES["line-array-10"][1] * 0.85);
});

test("ramps link end to end: one's b end meets the next one's a end", () => {
  const r = gear("cable-ramp-2ch"), a = r.getObjectByName("link-a")!, b = r.getObjectByName("link-b")!;
  expect(b.position.x - a.position.x).toBeCloseTo(GEAR_SIZES["cable-ramp-2ch"][0], 3);
});

test("a speaker's perforated grille is one flat sheet; its edge bends back as a solid lip, so no holes run round it", () => {
  for (const id of ["top-12-powered", "sub-18", "wedge-12"] as const) {
    const g = gear(id), sheet = g.getObjectByName(`${id}-grille`) as THREE.Mesh;
    const n = sheet.geometry.getAttribute("normal"), first = new THREE.Vector3().fromBufferAttribute(n, 0);
    for (let i = 0; i < n.count; i++) expect(new THREE.Vector3().fromBufferAttribute(n, i).dot(first), id).toBeGreaterThan(0.999);
    expect(first.z, id).toBeGreaterThan(0.5);
  }
});

// How far into a model a ray from outside gets past `face` (a coordinate along `dir`) before it hits something
// other than the grille's sheet.
function reach(id: GearId, from: readonly [number, number, number], dir: readonly [number, number, number], face: number) {
  const g = gear(id);
  g.updateMatrixWorld(true);
  const d = new THREE.Vector3(...dir), hits = new THREE.Raycaster(new THREE.Vector3(...from), d).intersectObject(g, true).filter((h) => !h.object.name.endsWith("-grille"));
  return hits[0].point.dot(d) - face;
}

test.each([
  // [what, id, from, along, the face's own coordinate along it, how deep a real one goes at least]
  ["the PA top's woofer, back behind its grille", "top-12-powered", [0, 0.3, 1], [0, 0, -1], -0.175, 0.03],
  ["the PA top's handle, a well sunk in its top behind the grip bar", "top-12-powered", [0, 1, -0.04], [0, -1, 0], -0.593, 0.025],
  ["the front fill's woofer, back behind its grille", "fill-8-powered", [0, 0.2, 1], [0, 0, -1], -0.1345, 0.03],
  ["the sub's port, one of two slots across the bottom of its front", "sub-18", [0.12, 0.086, 1], [0, 0, -1], -0.392, 0.1],
  ["the sub's side handle", "sub-18", [1, 0.365, 0.1], [-1, 0, 0], -0.26, 0.03],
] as const)("%s is a hollow you see into", (_, id, from, dir, face, deep) => {
  expect(reach(id, from, dir, face)).toBeGreaterThan(deep);
});

test.each(RIG_IDS)("the rig's %s builds at its size and stays cheap to draw", (id) => {
  const g = rigging(id);
  g.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3()).toArray();
  size.forEach((s, i) => expect(Math.abs(s - RIG_SIZES[id][i])).toBeLessThan(0.01));
  expect(triangles(g)).toBeLessThan(5000);
});

test("a frame pins onto the top box, and the motor's hook bites its shackle with the jacks facing out", () => {
  const box = gear("line-array-10"), frame = rigging("flying-frame"), motor = rigging("chain-motor");
  frame.position.y = GEAR_SIZES["line-array-10"][1];
  // hang the motor over the pick-up, its chain plumb, and run the hook down to it
  frame.updateMatrixWorld(true);
  const pickup = frame.getObjectByName("pickup")!.getWorldPosition(new THREE.Vector3()), chain = motor.getObjectByName("chain")!.position;
  motor.position.set(pickup.x - chain.x, 4, pickup.z - chain.z);
  const hook = motor.getObjectByName("part:hook")!;
  hook.position.y = pickup.y - motor.position.y + motor.userData.bite;
  for (const o of [box, frame, motor]) o.updateMatrixWorld(true);

  const at = (o: THREE.Object3D, name: string) => o.getObjectByName(name)!.getWorldPosition(new THREE.Vector3());
  expect(at(frame, "hinge-bottom").distanceTo(at(box, "hinge-top"))).toBeLessThan(0.002);
  const bite = hook.getWorldPosition(new THREE.Vector3()).setY(hook.getWorldPosition(new THREE.Vector3()).y - motor.userData.bite);
  expect(bite.distanceTo(pickup)).toBeLessThan(0.002);
  // the hook hangs under the motor's chain guide, and the motor's own hook is at its top
  expect(at(motor, "hang").y).toBeCloseTo(motor.position.y + 0.74, 3);
  const jacks = gearJacks(motor), centre = new THREE.Box3().setFromObject(motor).getCenter(new THREE.Vector3());
  expect([...jacks.keys()].sort()).toEqual(["control-in", "power-in"]);
  for (const j of jacks.values()) expect(j.getWorldPosition(new THREE.Vector3()).sub(centre).dot(new THREE.Vector3(0, 0, 1).applyQuaternion(j.quaternion))).toBeGreaterThan(0);
});

test("a stompbox builds at the size asked, its jacks out of each end and its footswitch on the lid", () => {
  for (const size of [STOMP_SIZE, [0.12, 0.06, 0.2] as THREE.Vector3Tuple]) {
    const g = stompbox(size);
    g.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g), got = box.getSize(new THREE.Vector3()).toArray();
    // each end's jack stands 8.5 mm proud of the box, so it is that much wider
    got.forEach((s, i) => expect(Math.abs(s - size[i] - (i === 0 ? 0.017 : 0))).toBeLessThan(0.004));
    expect(Math.abs(box.min.y)).toBeLessThan(0.001);
    const jacks = gearJacks(g);
    expect(jacks.get("in")!.position.x).toBeGreaterThan(size[0] / 2);
    expect(jacks.get("out")!.position.x).toBeLessThan(-size[0] / 2);
    expect(g.getObjectByName("switch")!.position.y).toBeGreaterThan(size[1] - 0.012);
    expect(triangles(g)).toBeLessThan(2000);
  }
});

test("the club pair moves as a DJ plays it: the mixer's faders, meters, crossfader and filters, the player's platter and ring apart", () => {
  const mixer = gear("mixer-club-4"), parts = gearParts(mixer);
  for (const name of ["fader-1", "fader-2", "fader-3", "fader-4", "meter-1", "meter-2", "meter-3", "meter-4", "cross", "filter-1", "filter-2"]) expect(parts.has(name), name).toBe(true);
  // laid out as the decks page's Qone mixer: long faders, the crossfader under the four channels, the black master panel at the right
  expect(mixer.userData.faderTravel).toBeGreaterThan(0.08);
  expect(mixer.userData.crossTravel).toBeGreaterThan(0.1);
  // a meter full is a bar running back from its front end along the face; the filters sit either side of the crossfader
  mixer.updateMatrixWorld(true);
  const bar = new THREE.Box3().setFromObject(parts.get("meter-1")!);
  expect(bar.max.z - bar.min.z).toBeGreaterThan(0.08);
  expect(bar.max.y - bar.min.y).toBeLessThan(0.002);
  const [f1, f2, cross] = ["filter-1", "filter-2", "cross"].map((n) => parts.get(n)!.position);
  expect(f1!.x).toBeLessThan(cross!.x - 0.05);
  expect(f2!.x).toBeGreaterThan(cross!.x + 0.05);
  expect(cross!.z).toBeGreaterThan(parts.get("fader-1")!.position.z);
  expect(f2!.x).toBeLessThan(0.16 - 0.04);

  const deck = gear("deck-cd"), dp = gearParts(deck);
  for (const name of ["platter", "ring", "screen", "cue", "play", "tempo"]) expect(dp.has(name), name).toBe(true);
  expect(dp.get("platter")!.position.distanceTo(dp.get("ring")!.position)).toBeLessThan(1e-9);
  // the screen tilts up toward the DJ more than the top does, and play is nearer them than cue
  expect(dp.get("screen")!.rotation.x).toBeGreaterThan(dp.get("platter")!.rotation.x + 0.1);
  expect(dp.get("play")!.position.z).toBeGreaterThan(dp.get("cue")!.position.z);
  expect(deck.userData.tempoTravel).toBeGreaterThan(0.08);
});

// #6064: the left box of an Air Motion pair is Void's left-handed one, and the Void subs stand on their skids.
test("the left-handed Air Motion is the right-handed one mirrored: its LF horn on the right seen from the front", () => {
  const lfAt = (id: GearId) => new THREE.Box3().setFromObject(gearPieces(id)!.find((p) => p.name === "lf-horn")!.group).getCenter(new THREE.Vector3()).x;
  expect(lfAt("sculpted-3way")).toBeLessThan(-0.1);
  expect(lfAt("sculpted-3way-lh")).toBeCloseTo(-lfAt("sculpted-3way"), 6);
});

// #6160: the Air Motion's frame is square tube behind the horns, with no post or foot plate down to the floor.
test.each(["sculpted-3way", "sculpted-3way-lh"] as const)("%s's frame is up at the horns' centres, and its sockets are under the MF horn's side", (id) => {
  const box = (name: string) => new THREE.Box3().setFromObject(gearPieces(id)!.find((p) => p.name === name)!.group);
  expect(box("frame").min.y).toBeGreaterThan(0.2);
  const side = (name: string) => Math.sign(box(name).getCenter(new THREE.Vector3()).x);
  expect(side("jacks")).toBe(side("mf-horn"));
});

test.each([["triple-21-sub", 0.0075], ["arc-sub-18", 0.015]] as const)("%s stands on %f m skids inside its published height", (id, skid) => {
  const box = (name: string) => new THREE.Box3().setFromObject(gearPieces(id)!.find((p) => p.name === name)!.group);
  expect(box("skids").min.y).toBeCloseTo(0, 6);
  expect(box("skids").max.y).toBeCloseTo(skid, 6);
  expect(box("cabinet").min.y).toBeCloseTo(skid, 3);
  expect(new THREE.Box3().setFromObject(gear(id)).max.y).toBeCloseTo(GEAR_SIZES[id][1], 2);
});

test("the Incubus Sub's horn walls slant back at about 45 degrees to its grille, the braces in front of it", () => {
  const box = (name: string) => new THREE.Box3().setFromObject(gearPieces("triple-21-sub")!.find((p) => p.name === name)!.group);
  const walls = box("horn-walls"), grille = box("grille"), front = GEAR_SIZES["triple-21-sub"][2] / 2;
  // from a divider in to the grille's edge is as far across as it is back
  const across = walls.max.x - grille.max.x, back = front - grille.max.z;
  expect(back / across).toBeGreaterThan(0.9);
  expect(back / across).toBeLessThan(1.15);
  expect(box("braces").min.z).toBeGreaterThan(grille.max.z);
});
