// The three mechanics that should pay, each as a fight the intended play wins and the obvious wrong play loses,
// over four seeds: the slingshot round a planet's rim, scouts before guns into a rift, the interdictor on the lane.
import { expect, setDefaultTimeout, test } from "bun:test";
import type { Role, ShipKind } from "../src/names.ts";
import { brains } from "../src/sim/ai.ts";
import { runPlay, wingsOf } from "../src/sim/plays.ts";
import { sensors, theaterBrains } from "../src/sim/theater.ts";
import { addShip, addWing, emptyWorld, nextCall, step, type Brain, type Field, type Ship, type World } from "../src/sim/world.ts";

setDefaultTimeout(30_000);

const field = (): Field => ({
  wide: 4500, deep: 3000, wells: [], veils: [], mines: [], points: [], supply: { navy: 0, rim: 0 }, sees: { navy: new Set(), rim: new Set() },
  tier: { navy: 0, rim: 0 }, ping: { x: 0, z: 0, until: 0, ready: 0 }, heldSince: 0, known: { navy: new Map(), rim: new Map() },
});
function world(seed: number, limit: number) {
  const w = emptyWorld(seed);
  w.rimTemper = "cagey"; w.limit = limit;
  w.planet = { name: "Thessaly", x: 3200, z: 0, r: 420, base: 9000, baseMax: 9000 };
  return w;
}
function navy(w: World, wings: Role[], x: number, z: number) {
  const fl = addShip(w, "navy", "destroyer", "Relentless", x, z, 0, false);
  w.flagship = fl.id;
  wings.forEach((r, i) => addWing(w, fl, r, nextCall(w, "navy"), r === "scout" ? 3 : r === "interceptor" ? 6 : 5, 1 + i * 1.5));
  return fl;
}
function rim(w: World, kind: ShipKind, x: number, z: number, post = false) {
  const s = addShip(w, "rim", kind, kind, x, z, Math.PI, true);
  if (post) s.post = { x, z };
  return s;
}
const rimShips = (w: World) => w.ships.filter((s) => s.side === "rim" && !s.dead);
const mine = (w: World) => wingsOf(w, w.flagship);
const bombersFree = (w: World) => mine(w).filter((g) => g.role === "bomber").every((g) => !g.later && (g.state !== "out" || g.order.k !== "attack"));
const strike = (w: World, pick?: Ship) => { if (pick && w.t > 6 && bombersFree(w) && Math.round(w.t * 10) % 50 === 0) runPlay(w, "torpedo-run", mine(w), pick.id); };
const engage = (s: Ship, t: Ship) => { if (s.order.k !== "engage" || s.order.target !== t.id) s.order = { k: "engage", target: t.id, broadside: true }; };

/** A run to a gate past a planet that closes at 300 s: round the rim (the slingshot), straight through, or wide round. */
function slingshot(route: "rim" | "straight" | "wide") {
  return (seed: number) => {
    const w = world(seed, 300);
    w.field = field();
    w.field.wells.push({ kind: "planet", name: "Vael", x: 0, z: 0, core: 420, r: 1800, pull: 14 });
    rim(w, "corvette", 0, 90000);
    const s = navy(w, [], -2600, 300), R = route === "rim" ? 700 : 1500;
    const arc = [150, 120, 90, 60, 30].map((a) => ({ x: Math.cos((a * Math.PI) / 180) * R, z: Math.sin((a * Math.PI) / 180) * R }));
    s.order = { k: "move", x: 2600, z: 300, via: route === "straight" ? undefined : arc };
    for (let i = 0; i < w.limit * 10; i++) { step(w, []); if (Math.hypot(s.x - 2600, s.z - 300) < 60) return "win"; }
    return "loss";
  };
}

/** A relay in a rift, three ambushers posted round it, and a destroyer sent in with its scouts ahead, or without. */
function rift(scouted: boolean) {
  return (seed: number) => {
    const w = world(seed, 360);
    const f = (w.field = field());
    f.wells.push({ kind: "rift", name: "The Drowned Eye", x: 800, z: 0, core: 0, r: 1100, pull: 5 });
    f.veils.push({ kind: "rift", x: 800, z: 0, r: 900, depth: 1 });
    const fl = navy(w, [...(scouted ? ["scout" as const] : []), "bomber", "bomber", "escort", "interceptor"], -2600, 0);
    rim(w, "cruiser", 650, 600, true); rim(w, "bulwark", 1050, -550, true); rim(w, "cruiser", 1350, 250, true);
    sensors(w);
    return fight(w, theaterBrains, () => {
      const scouts = mine(w).find((g) => g.role === "scout");
      if (scouts && scouts.order.k !== "patrol") scouts.order = { k: "patrol", x: 650, z: 0 };
      const seen = rimShips(w).find((s) => f.sees.navy.has(s.id));
      if (seen) { strike(w, seen); engage(fl, seen); }
      else if (w.t > (scouted ? 12 : 0) && fl.order.k !== "move") fl.order = { k: "move", x: 800, z: 0 };
    });
  };
}

/** Two waves of three through the lane: the frigate parked on the lane's mouth, or fighting beside the destroyer. */
function lane(interdict: boolean) {
  return (seed: number) => {
    const w = world(seed, 360);
    const fl = navy(w, ["interceptor", "bomber", "bomber", "escort"], -1300, 0);
    const fr = addShip(w, "navy", "frigate", "Warden", -1250, 320, 0, false);
    w.lane = { x: -100, z: 1250 };
    addWing(w, rim(w, "corvette", 700, -200), "interceptor", nextCall(w, "rim"), 5, 3);
    fl.hull *= 0.5;
    w.waves = [
      { at: 45, done: false, ships: [{ kind: "cruiser", wings: ["bomber"] }, { kind: "cruiser", wings: ["escort"] }, { kind: "cruiser", wings: ["bomber"] }] },
      { at: 110, done: false, ships: [{ kind: "carrier", wings: ["bomber", "interceptor"] }, { kind: "cruiser", wings: ["bomber"] }, { kind: "cruiser", wings: ["bomber"] }] },
    ];
    return fight(w, brains, () => {
      const near = rimShips(w).sort((a, b) => Math.hypot(a.x - fl.x, a.z - fl.z) - Math.hypot(b.x - fl.x, b.z - fl.z))[0];
      if (!near) return;
      if (fl.order.k !== "engage") engage(fl, near);
      if (interdict) { if (fr.order.k !== "lane") fr.order = { k: "lane" }; } else if (!fr.dead) engage(fr, near);
      const dazed = rimShips(w).find((s) => s.stunUntil > w.t);
      if (dazed && bombersFree(w)) runPlay(w, "torpedo-run", mine(w), dazed.id);
      else strike(w, near);
    });
  };
}

function fight(w: World, run: Brain[], plan: () => void) {
  for (let i = 0; i < w.limit * 10 && !w.outcome; i++) { plan(); step(w, run); }
  return w.outcome ?? "draw";
}

test("each mechanic pays: the intended play wins and the obvious wrong one doesn't, over four seeds", () => {
  const cases: [string, (seed: number) => string, string, (seed: number) => string][] = [
    ["round the rim", slingshot("rim"), "straight through the planet", slingshot("straight")],
    ["round the rim", slingshot("rim"), "wide round the well", slingshot("wide")],
    ["scouts into the rift first", rift(true), "the guns in blind", rift(false)],
    ["the interdictor on the lane", lane(true), "the frigate in the gun line", lane(false)],
  ];
  for (const [right, play, wrong, other] of cases) for (const seed of [1, 2, 3, 4]) {
    expect([right, seed, play(seed)]).toEqual([right, seed, "win"]);
    expect([wrong, seed, other(seed)]).not.toEqual([wrong, seed, "win"]);
  }
});
