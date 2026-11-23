// Desert Gathering as a crew does it: over the sand from the truck (every step slower), the generator up on the
// sand cart because its own wheels dig in, four horn dance stacks (too heavy for anyone to lift) pushed down on their
// sand dollies and stood in a line, the amp racks, the distro and the mixer beside the wall, the long feed from the
// generator, and the wall patched. The fader is set for the floor full at the peak of the night, so the empty desert
// at dusk reads hot; the horns beam, so the camp sleeps. It passes once the joints on the sand are taped and a jerry
// can sits by the generator: on the 15 litres it came with the wall goes quiet at 3 am. Then how the bins stand decides
// the bass, and how high the mid-highs stand decides the back of a full floor. The same calls `window.loadIn` makes.
import { expect, setDefaultTimeout, test } from "bun:test";
import { SAND, WALK, holdOut, newWorld, pickUp, push, putDown, type World } from "../src/sim.ts";
import { type Cables, grabEnd, newCables, plug, settle, takeCable, walkWith } from "../src/cables/cables.ts";
import { cellsIn, master, mean } from "../src/venues/dive-bar.ts";
import { CAMP_LIMIT, DANCE_FLOOR, DESERT, GEN_QUIET, desertState, heat, score, wrap } from "../src/venues/desert.ts";

setDefaultTimeout(60_000);
const at = (w: World, k: string) => w.items.find((i) => i.key === k)!;
/** Walk to (x, z) however long it takes: 30 m of sand with a 45 kg bin is more than walkTo's two minutes. */
function go(w: World, c: Cables, x: number, z: number) {
  for (let k = 0; k < 5 && Math.hypot(x - w.you.x, z - w.you.z) > 0.02; k++) walkWith(w, c, x, z);
}

/** Walk up to `key` from the side you're on, take it (lift it, or push it if it rolls), and set it down at (x, z) facing the floor. */
function move(w: World, c: Cables, key: string, x: number, z: number, how: "lift" | "push" = "lift") {
  const i = at(w, key), side = w.you.z > i.z ? 1 : -1;
  go(w, c, i.x, i.z + side * (holdOut(i) + 0.1));
  expect(how === "push" ? push(w, key) : pickUp(w, key)).toEqual({ ok: true });
  go(w, c, x, z + holdOut(i));
  w.you.yaw = 0;
  w.held!.rel = 0;
  expect(putDown(w)).toEqual({ ok: true });
  return at(w, key);
}

/** The crew patches the rest of the wall: power off the distro, a mixer send per amp channel, the bins daisy-chained in
 * pairs (4 ohms a channel), the mid-basses on one channel and the mid-highs on another, four to a channel (2 ohms). */
function patchWall(c: Cables) {
  const r = (kind: "power" | "xlr" | "speaker", a: [string, string], b: [string, string]) =>
    c.runs.push({ key: `${a.join(":")}-${b.join(":")}`, kind, lengthM: 5, a: { plug: a }, b: { plug: b }, rope: null });
  r("power", ["distro", "power-out-1"], ["rack-bins", "power-in"]);
  r("power", ["distro", "power-out-2"], ["rack-tops", "power-in"]);
  r("power", ["distro", "power-out-3"], ["mixer", "power-in"]);
  for (const [n, rack, ch] of [[1, "rack-bins", 1], [2, "rack-bins", 2], [3, "rack-tops", 1], [4, "rack-tops", 2]] as const) r("xlr", ["mixer", `xlr-out-${n}`], [rack, `xlr-in-${ch}`]);
  for (const ch of [1, 2]) {
    r("speaker", ["rack-bins", `speaker-out-${ch}`], [`bin-${ch * 2 - 1}`, "speaker-in"]);
    r("speaker", [`bin-${ch * 2 - 1}`, "speaker-out"], [`bin-${ch * 2}`, "speaker-in"]);
  }
  for (const [ch, kind] of [[1, "midbass"], [2, "top"]] as const) {
    r("speaker", ["rack-tops", `speaker-out-${ch}`], [`${kind}-1`, "speaker-in"]);
    for (const n of [1, 2, 3]) r("speaker", [`${kind}-${n}`, "speaker-out"], [`${kind}-${n + 1}`, "speaker-in"]);
  }
}

/** The four stacks shoulder to shoulder: a 21" bin is 1.1 m wide. */
const LINE = [-1.65, -0.55, 0.55, 1.65];
const PARTS = ["dolly", "bin", "midbass", "top"];

test("cart the generator over the sand, stack the wall, keep the camp asleep, and fuel it to sunrise", () => {
  const w = newWorld(DESERT), c = newCables(w);

  // Sand: even empty-handed you walk slower than on a floor.
  walkWith(w, c, 0, 33);
  expect(w.you.speed).toBeCloseTo(WALK * SAND, 2);

  // The generator's small wheels dig in; the cart's balloon tyres roll, and the generator rides it, slowly.
  walkWith(w, c, 0, 32.8);
  w.you.yaw = 0;
  expect(push(w, "generator")).toEqual({ ok: false, why: "the wheeled generator's small wheels dig into the sand: push the sand cart" });
  const t0 = w.t;
  move(w, c, "cart", -8, 4, "push");
  expect(Math.hypot(8, 27.6) / (w.t - t0)).toBeLessThan(0.25);
  expect(at(w, "generator")).toMatchObject({ y: 0.45 });
  expect(Math.hypot(at(w, "generator").x - at(w, "cart").x, at(w, "generator").z - at(w, "cart").z)).toBeLessThan(0.01);

  // The wall: a 21" horn bin is 115 kg and nobody lifts it; each stack rides its sand dolly, 259 kg at a crawl.
  walkWith(w, c, at(w, "dolly-1").x, at(w, "dolly-1").z + 1);
  expect(pickUp(w, "bin-1")).toEqual({ ok: false, why: '21" horn-loaded bass bin is 115 kg, too heavy to lift alone' });
  const t1 = w.t;
  move(w, c, "dolly-1", LINE[0]!, 1, "push");
  expect(Math.hypot(LINE[0]! - -2, 30.3) / (w.t - t1)).toBeLessThan(0.25);
  [1, 2, 3].forEach((n) => move(w, c, `dolly-${n + 1}`, LINE[n]!, 1, "push"));
  // Each stack rode whole: the bin a hand's width off the sand on its dolly, the mid-high's mouth over the heads.
  for (const [n, x] of LINE.entries()) for (const [k, y] of [["dolly", 0], ["bin", 0.15], ["midbass", 0.95], ["top", 1.7]] as const) {
    expect(at(w, `${k}-${n + 1}`).x).toBeCloseTo(x, 1);
    expect(at(w, `${k}-${n + 1}`).y).toBeCloseTo(y, 5);
  }
  move(w, c, "rack-bins", -2.8, 1);
  move(w, c, "rack-tops", -3.6, 1);
  move(w, c, "distro", 2.6, 1);
  move(w, c, "mixer", 3.4, 2.4);
  move(w, c, "case", 2.6, 1.2);

  // The long feed from the generator to the distro, by hand; the crew patches the rest.
  walkWith(w, c, at(w, "case").x + 0.5, at(w, "case").z + 0.7);
  expect(takeCable(w, c, "power")).toEqual({ ok: true });
  const feed = c.runs.find((r) => "hand" in r.a)!.key;
  expect(feed).toBe("power-25");
  walkWith(w, c, at(w, "generator").x + 0.5, at(w, "generator").z + 0.9);
  expect(plug(w, c, "generator", "power-out-1")).toEqual({ ok: true });
  walkWith(w, c, at(w, "case").x + 0.5, at(w, "case").z + 0.7);
  expect(grabEnd(w, c, feed, "b")).toEqual({ ok: true });
  walkWith(w, c, at(w, "distro").x + 0.3, at(w, "distro").z + 0.7);
  expect(plug(w, c, "distro", "power-in")).toEqual({ ok: true });
  settle(w, c, 3);
  patchWall(c);

  // At -10 dB the floor is right with the night's peak crowd on it, and the bass is everywhere. The same fader on an
  // empty desert at dusk reads hot: bodies soak up the highs, so a wall set by ear at soundcheck is set too quiet.
  // The horns beam (50 degrees wide), so straight ahead the camp is under its limit. On the generator's own tank the
  // wall runs out of fuel before dawn.
  master(w, -10);
  const dry = desertState(w, c), empty = score(w, c, heat(w, c, "high", null));
  expect(dry).toMatchObject({ generator: { watts: 3030, trips: false }, bass: 1, tripped: false });
  expect(dry.covered).toBeGreaterThan(0.8);
  expect(empty.floor!).toBeGreaterThan(dry.floor! + 2);
  expect(empty.covered).toBeLessThan(dry.covered - 0.1);
  expect(dry.camp!).toBeLessThan(CAMP_LIMIT);
  expect(dry).toMatchObject({ fuel: { litres: 15, cans: 0, watts: 3030 }, until: "03:00", sunrise: false, pass: false });
  // The sound is right, but joints lie on the sand: by sunrise the dust is in them and they crackle, a few points each.
  // The bins' own joints ride up on the dollies, clear of it.
  expect(dry.dusty.some((j) => /^(bin|midbass|top)-/.test(j))).toBe(false);
  expect(dry.dusty.length).toBeGreaterThan(0);
  expect(dry.sound).toBeLessThan(85);
  expect(wrap(c, "mixer", "no-such-jack")).toEqual({ ok: false, why: "nothing is plugged into mixer no-such-jack" });
  // A turn of tape round each one keeps it out.
  for (const joint of dry.dusty) { const [owner, jack] = joint.split(" "); expect(wrap(c, owner!, jack!)).toEqual({ ok: true }); }
  const taped = desertState(w, c);
  expect(taped.dusty).toEqual([]);
  expect(taped.sound).toBeGreaterThanOrEqual(85);

  // A jerry can carried down and set by the generator: the wall plays until the sun comes up.
  move(w, c, "can-1", -9, 5.2);
  expect(desertState(w, c)).toMatchObject({ fuel: { litres: 35, cans: 1 }, until: "06:00", sunrise: true, pass: true });

  // The generator is heard on the floor too. Where the crew left it, it drones in every breakdown; 6 dB quieter for
  // each doubling of the distance, so wheeled well back on the cart it drops out of earshot.
  const near = desertState(w, c).generatorDb!;
  expect(near).toBeGreaterThan(GEN_QUIET);
  const gen = at(w, "generator"), cart = at(w, "cart"), edge = Math.hypot(gen.x - Math.max(-7, Math.min(7, gen.x)), gen.z - Math.max(6, Math.min(20, gen.z)));
  expect(near).toBeCloseTo(74 - 20 * Math.log10(Math.max(1, edge) / 7), 0);
  for (const i of [gen, cart]) i.x -= 40;
  expect(desertState(w, c).generatorDb!).toBeLessThan(GEN_QUIET);
  expect(desertState(w, c).generatorDb!).toBeLessThan(near - 10);
});

/** The wall stood and patched without the walk: stack `n` (every part on its dolly) at each of `stacks`. */
function built(stacks: readonly (readonly [number, number])[]) {
  const w = newWorld(DESERT), c = newCables(w), put = (k: string, x: number, z: number) => Object.assign(at(w, k), { x, z });
  stacks.forEach(([x, z], n) => PARTS.forEach((p) => put(`${p}-${n + 1}`, x, z)));
  put("cart", -8, 4); put("generator", -8, 4);
  for (const [k, x] of [["rack-bins", -2.8], ["rack-tops", -3.6], ["distro", 2.6], ["mixer", 3.4]] as const) put(k, x, 1);
  c.runs.push({ key: "feed", kind: "power", lengthM: 25, a: { plug: ["generator", "power-out-1"] }, b: { plug: ["distro", "power-in"] }, rope: null });
  patchWall(c);
  master(w, -10);
  return { w, c };
}

test.each([
  // Four bins shoulder to shoulder sum on every cell of the floor.
  ["in a line", LINE.map((x) => [x, 1] as const), 1, 1],
  // Two stacks a side, 13 m apart: a power alley down the middle, and nulls either side of it.
  ["split left and right", [[-7.6, 1], [-6.5, 1], [6.5, 1], [7.6, 1]], 0.5, 0.8],
  // Every other stack 2.7 m back, half a wavelength at 63 Hz: they cancel across the floor.
  ["staggered half a wavelength", LINE.map((x, n) => [x, n % 2 ? 3.7 : 1] as const), 0, 0.3],
] as const)("the bins %s: the share of the floor that gets its bass", (_name, stacks, least, most) => {
  const { w, c } = built(stacks);
  const { bass } = score(w, c);
  expect(bass).toBeGreaterThanOrEqual(least);
  expect(bass).toBeLessThanOrEqual(most);
});

test("the mid-highs up on the stack carry over the heads to the back of a full floor; down on the sand they don't", () => {
  const { w, c } = built(LINE.map((x) => [x, 1] as const)), back = DANCE_FLOOR.regions[2]!.zone;
  const tops = [1, 2, 3, 4].map((n) => at(w, `top-${n}`)), heard = () => mean(cellsIn(heat(w, c), back));
  const onStack = heard();
  for (const t of tops) Object.assign(t, { y: 0, z: 2.2 });
  const onSand = heard();
  for (const t of tops) Object.assign(t, { y: 2.2, z: 1 });
  const lifted = heard();
  // Each half metre up clears more of the crowd's heads: the back of the floor brightens by a dB or more each time.
  expect(onStack).toBeGreaterThan(onSand + 1);
  expect(lifted).toBeGreaterThan(onStack + 1);
});

test("the dance floor's crowd spot covers the floor the wall is scored on, and holds 500", () => {
  const { floor, regions, capacity } = DANCE_FLOOR;
  expect(capacity).toBe(500);
  // Front, middle and back meet edge to edge from the wall to the far end of the floor, with no gap or overlap.
  expect(regions.map((r) => [r.zone.z0, r.zone.z1])).toEqual([[floor.z0, 10.5], [10.5, 15.5], [15.5, floor.z1]]);
  // Before show time nobody is there, and the state says so.
  const w = newWorld(DESERT), c = newCables(w);
  expect(desertState(w, c).crowd).toBeNull();
});
