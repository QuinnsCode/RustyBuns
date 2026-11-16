// The park as a crew does it: push the generator in from the truck (too heavy to lift), carry the distro, the mixer,
// the case and the tops into the tent, run the 25 m power cable from the generator to the distro and the short ones to
// the tops and the mixer, ramp the crossing on the lakeside path, aim the tops down and turn the master down until the
// houses across the road sit under the limit, and pass. Then the band's amp racks trip the generator. The same calls
// `window.loadIn` makes.
import { expect, setDefaultTimeout, test } from "bun:test";
import { dims, newWorld, pickUp, putDown, type World } from "../src/sim.ts";
import { type Cables, grabEnd, linkRamp, newCables, plug, settle, takeCable, walkWith } from "../src/cables/cables.ts";
import { aim, master, raise, settle as onStands } from "../src/venues/dive-bar.ts";
import { PARK, SPILL_LIMIT, blow, load, parkState, push, score, windFor, windText } from "../src/venues/park.ts";
import { setDial } from "../src/assists.ts";

setDefaultTimeout(60_000);
const DEG = Math.PI / 180;

/** Walk to `key`, take it (lift it, or push it if it rolls), and set it down at (x, z) turned to `rot`. */
function move(w: World, c: Cables, key: string, x: number, z: number, rot = 0, how: "lift" | "push" = "lift") {
  const i = w.items.find((o) => o.key === key)!;
  walkWith(w, c, i.x, i.z + 0.9);
  w.you.yaw = 0;
  expect(how === "push" ? push(w, key) : pickUp(w, key)).toEqual({ ok: true });
  // Stand so it lands on (x, z): it is held 0.3 m plus half its depth in front of you, facing -z.
  const out = 0.3 + dims(i)[2] / 2;
  walkWith(w, c, x, z + out);
  w.you.yaw = 0;
  w.held!.rel = rot;
  expect(putDown(w)).toEqual({ ok: true });
  onStands(w);
  return w.items.find((o) => o.key === key)!;
}

/** A cable out of the case into `from`, its other end walked to `to`. */
function run(w: World, c: Cables, kind: "power" | "xlr", from: [string, string], to: [string, string]) {
  const at = (k: string) => w.items.find((i) => i.key === k)!, near = (k: string) => walkWith(w, c, at(k).x + 0.5, at(k).z + 0.7);
  near("case");
  expect(takeCable(w, c, kind)).toEqual({ ok: true });
  const key = c.runs.find((r) => "hand" in r.a)!.key;
  near(from[0]);
  expect(plug(w, c, ...from)).toEqual({ ok: true });
  near("case");
  expect(grabEnd(w, c, key, "b")).toEqual({ ok: true });
  near(to[0]);
  expect(plug(w, c, ...to)).toEqual({ ok: true });
  settle(w, c, 3);
}

test("push the generator in, power the tent from it, ramp the path, keep the houses under the limit", () => {
  const w = newWorld(PARK), c = newCables(w);

  // The generator is 90 kg: nobody lifts it, but it rolls, slowly.
  const gen = w.items.find((i) => i.key === "generator")!;
  walkWith(w, c, gen.x, gen.z + 0.9);
  w.you.yaw = 0;
  expect(pickUp(w, "generator")).toEqual({ ok: false, why: "wheeled generator is 90 kg, too heavy to lift alone" });
  const t0 = w.t;
  move(w, c, "generator", -5, 22, 0, "push");
  expect(Math.hypot(5, 7.6) / (w.t - t0)).toBeLessThan(0.5);
  const there = w.items.find((i) => i.key === "generator")!;
  expect(there.y).toBe(0);
  expect(Math.hypot(there.x + 5, there.z - 22)).toBeLessThan(0.05);

  // Into the tent: the mixer off the case, then the case, the distro, the stands and the tops on them.
  move(w, c, "mixer", -1.4, 2.4);
  move(w, c, "case", 1.6, 1.4);
  move(w, c, "distro", 0, 2.4);
  move(w, c, "stand-l", -3, 4.3);
  move(w, c, "stand-r", 3, 4.3);
  move(w, c, "top-l", -3, 4.3);
  move(w, c, "top-r", 3, 4.3);
  const stand = w.items.find((i) => i.key === "stand-l")!;
  expect(w.items.find((i) => i.key === "top-l")).toMatchObject({ x: stand.x, z: stand.z, y: 1.2 });

  // Nothing plays until the patch feeds it: no power in the park but the generator's.
  expect(parkState(w, c)).toMatchObject({ crowd: null, score: 0, generator: { watts: 0, limit: 6300 } });

  run(w, c, "power", ["generator", "power-out-1"], ["distro", "power-in"]);
  run(w, c, "power", ["distro", "power-out-1"], ["top-l", "power-in"]);
  run(w, c, "power", ["distro", "power-out-2"], ["top-r", "power-in"]);
  run(w, c, "power", ["distro", "power-out-3"], ["mixer", "power-in"]);
  run(w, c, "xlr", ["mixer", "xlr-out-1"], ["top-l", "xlr-in"]);
  run(w, c, "xlr", ["mixer", "xlr-out-2"], ["top-r", "xlr-in"]);
  expect(load(w, c)).toMatchObject({ watts: 350, trips: false });

  // Aimed at the crowd, turned up: loud enough at the houses across the road to fail, and the 25 m run lies across the
  // lakeside path.
  for (const k of ["top-l", "top-r"]) {
    const t = w.items.find((i) => i.key === k)!;
    walkWith(w, c, t.x * 0.7, t.z + 1);
    expect(aim(w, k, { turn: -t.rot })).toEqual({ ok: true });
  }
  master(w, -8);
  const loud = parkState(w, c);
  expect(loud.houses!).toBeGreaterThan(SPILL_LIMIT + 4);
  expect(loud.hazards).toBe(1);
  expect(loud.pass).toBe(false);

  // A ramp over the crossing, turned along the cable.
  const cross = c.runs.find((r) => r.key === "power-25")!.rope!.pts.find((p) => p.z > 18.2 && p.z < 19.2)!;
  move(w, c, "ramp-1", cross.x, 18.7, Math.PI / 2);
  linkRamp(w, "ramp-1");
  settle(w, c, 3);
  expect(parkState(w, c).hazards).toBe(0);

  // Stands up, tops tilted down a touch, master down: the crowd still hears it, the houses don't complain.
  for (const k of ["l", "r"]) {
    const s = w.items.find((i) => i.key === `stand-${k}`)!;
    walkWith(w, c, s.x * 0.7, s.z + 1);
    expect(raise(w, `stand-${k}`, 2)).toEqual({ ok: true });
    expect(aim(w, `top-${k}`, { tilt: -10 * DEG })).toEqual({ ok: true });
  }
  master(w, -14);
  const s = score(w, c);
  expect(s.houses!).toBeLessThanOrEqual(SPILL_LIMIT);
  expect(s).toMatchObject({ hazards: 0, tripped: false, pass: true });

  // The breeze picks up toward the road: it carries the highs a few dB further and the houses complain, so the fader
  // has to come down again. Turned the other way it carries them off and the houses go quieter than calm.
  blow(w, () => ({ toward: 0, speed: 5 }));
  const downwind = score(w, c);
  expect(downwind.houses! - s.houses!).toBeGreaterThan(2.5);
  expect(downwind.houses!).toBeGreaterThan(SPILL_LIMIT);
  // Pulling the fader 3 dB brings the houses back near the limit, but the back of the crowd loses it: a trade, not a fix.
  master(w, -17);
  const pulled = score(w, c);
  expect(downwind.houses! - pulled.houses!).toBeGreaterThan(2.5);
  expect(pulled.covered).toBeLessThan(downwind.covered);
  master(w, -14);
  blow(w, () => ({ toward: Math.PI, speed: 5 }));
  expect(s.houses! - score(w, c).houses!).toBeGreaterThan(2.5);
  blow(w, () => ({ toward: 0, speed: 0 }));

  // The band brings four amp racks and plugs them in: past the generator's 6.3 kW its breaker trips and the park goes quiet.
  const outs = [["generator", "power-out-2"], ["distro", "power-out-4"], ["distro", "power-out-5"], ["distro", "power-out-6"]] as const;
  outs.forEach(([owner, jack], n) => {
    w.items.push({ key: `rack-${n}`, gear: "amp-rack-4u", x: -6 + n, y: 0, z: 1, rot: 0 });
    c.runs.push({ key: `band-${n}`, kind: "power", lengthM: 5, a: { plug: [owner, jack] }, b: { plug: [`rack-${n}`, "power-in"] }, rope: null });
  });
  expect(parkState(w, c)).toMatchObject({ generator: { watts: 6350, trips: true }, tripped: true, crowd: null, pass: false });
});

test("a run's breeze is seeded: the same seed blows the same, and it swings over the day", () => {
  const a = windFor(7), b = windFor(7), other = windFor(8);
  expect(a(0)).toEqual(b(0));
  expect(other(0)).not.toEqual(a(0));
  const day = [0, 120, 240, 360, 480, 600].map(a);
  expect(Math.max(...day.map((x) => x.toward)) - Math.min(...day.map((x) => x.toward))).toBeGreaterThan(0.2);
  for (const x of day) expect(x.speed).toBeGreaterThan(0);
  expect(windText({ toward: 0.2, speed: 4 })).toBe("Wind 4 m/s toward the houses");
  expect(windText({ toward: Math.PI, speed: 3 })).toBe("Wind 3 m/s away from the houses");
});

test("the dial: Cozy rolls the generator light and never trips it; Sim is a crawl and trips", () => {
  const pace = (dial: "cozy" | "crew" | "sim") => {
    setDial(dial);
    const w = newWorld(PARK), c = newCables(w), gen = w.items.find((i) => i.key === "generator")!;
    walkWith(w, c, gen.x, gen.z + 0.9);
    w.you.yaw = 0;
    expect(push(w, "generator")).toEqual({ ok: true });
    const t0 = w.t;
    walkWith(w, c, -5, 22.6);
    return Math.hypot(5, 7.4) / (w.t - t0);
  };
  try {
    const [cozy, crew, sim] = [pace("cozy"), pace("crew"), pace("sim")];
    expect(sim).toBeLessThan(0.45);
    expect(crew).toBeGreaterThan(sim);
    expect(cozy).toBeGreaterThan(0.8);

    // Five amp racks, three on the generator and two through the distro, 7.5 kW: Sim trips it, Cozy holds.
    const w = newWorld(PARK), c = newCables(w);
    const outs = [["generator", "power-out-2"], ["generator", "power-out-3"], ["generator", "power-out-4"], ["distro", "power-out-1"], ["distro", "power-out-2"]] as const;
    c.runs.push({ key: "feed", kind: "power", lengthM: 5, a: { plug: ["generator", "power-out-1"] }, b: { plug: ["distro", "power-in"] }, rope: null });
    outs.forEach(([owner, jack], n) => {
      w.items.push({ key: `rack-${n}`, gear: "amp-rack-4u", x: -6 + n, y: 0, z: 1, rot: 0 });
      c.runs.push({ key: `band-${n}`, kind: "power", lengthM: 5, a: { plug: [owner, jack] }, b: { plug: [`rack-${n}`, "power-in"] }, rope: null });
    });
    setDial("sim");
    expect(parkState(w, c)).toMatchObject({ generator: { watts: 7500, trips: true }, tripped: true });
    setDial("cozy");
    expect(parkState(w, c)).toMatchObject({ generator: { watts: 7500, trips: false }, tripped: false });
  } finally {
    setDial("sim");
  }
});
