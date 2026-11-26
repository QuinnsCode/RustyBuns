// The levels: short battles, each built round one idea the player learns, easiest first. Each is data on the seeded
// sim (who is where, what the clock means) plus `plan`, the intended play as a brain: the test runs it and wins, runs
// nothing and loses, so every level is proven winnable and proven to need its idea's move. The page shows `teaches`
// before a level starts. DESIGN.md "Levels" has the list and why each is there.
import type { Role, ShipKind } from "../names.ts";
import { brains } from "./ai.ts";
import { runPlay, wingsOf, type PlayId } from "./plays.ts";
import { newField, sensors, theaterBrains } from "./theater.ts";
import { addShip, addWing, alive, emptyWorld, flagship, nextCall, say, type Brain, type Ship, type World } from "./world.ts";

export interface Level {
  id: string; name: string;
  /** One line, shown before the level starts: the idea, and the key that plays it. */
  teaches: string;
  /** 1 to 5: how hard it is, for the list. The levels are in order of it. */
  stars: number;
  build: (seed: number) => World;
  /** The intended play, run once a tick before the sim's own brains. */
  plan: Brain;
}

/** The brains a level's sim runs (a level in the fog adds the theater's sensors, mines and strongpoints). */
export const levelBrains = (w: World) => (w.field ? theaterBrains : brains);

// ---------------------------------------------------------------- building blocks

/** Your destroyer and its wings, at the west edge facing east. */
function navy(w: World, wings: Role[], at = { x: -1300, z: 0 }, hull = 1): Ship {
  const fl = addShip(w, "navy", "destroyer", "Relentless", at.x, at.z, 0, false);
  fl.hull = fl.hullMax * hull;
  w.flagship = fl.id;
  wings.forEach((r, i) => {
    const g = addWing(w, fl, r, nextCall(w, "navy"), r === "scout" ? 3 : r === "bomber" ? 5 : r === "escort" ? 5 : 6, 1 + i * 1.5);
    if (r === "scout") g.formation = "loose";
  });
  return fl;
}

/** A Compact hull. `auto: false` sits where it is put and leaves its wings on their orders (a target to learn on);
 *  with `post` it is an ambusher that waits there in the fog. */
function rim(w: World, kind: ShipKind, name: string, x: number, z: number, o: { wings?: Role[]; auto?: boolean; reserve?: number; post?: boolean } = {}): Ship {
  const s = addShip(w, "rim", kind, name, x, z, Math.PI, o.auto ?? true);
  s.reserve = o.reserve ?? 0;
  if (o.post) s.post = { x, z };
  (o.wings ?? []).forEach((r, i) => addWing(w, s, r, nextCall(w, "rim"), r === "bomber" ? 4 : 5, 3 + i * 2));
  return s;
}

/** A level's world: a planet far off (its base is not the point unless the level says so) and its clock. */
function level(seed: number, limit: number, onTime: "win" | "loss", why: string, planet = { name: "Thessaly", x: 3200, z: 0, r: 420, base: 9000 }): World {
  const w = emptyWorld(seed);
  w.rimTemper = "cagey";
  w.limit = limit;
  w.planet = { ...planet, baseMax: planet.base };
  w.lane = { x: planet.x - 800, z: 1600 };
  w.goal = { onTime, why };
  return w;
}

const rimShips = (w: World) => w.ships.filter((s) => s.side === "rim" && !s.dead);
const myWings = (w: World) => { const fl = flagship(w); return fl ? wingsOf(w, fl.id) : []; };
/** Whether the bombers are home or loafing, so a new strike can go (the same test autoCommander uses). */
const bombersFree = (w: World) => myWings(w).filter((g) => g.role === "bomber").every((g) => !g.later && (g.state !== "out" || g.order.k !== "attack"));
/** Every five seconds, a play on `pick` once the bombers are free. */
function strike(w: World, play: PlayId, pick: Ship | undefined) {
  if (pick && w.t > 6 && bombersFree(w) && Math.round(w.t * 10) % 50 === 0) runPlay(w, play, myWings(w), pick.id);
}
const rimAir = (w: World) => w.wings.some((g) => g.side === "rim" && g.state === "out" && alive(g).length);

// ---------------------------------------------------------------- the levels

export const LEVELS: Level[] = [
  {
    id: "torpedo-run", name: "Torpedo Run", stars: 1,
    teaches: "Bombers break ships. Mark the carrier and call a torpedo run (Q).",
    build: (seed) => {
      const w = level(seed, 240, "loss", "The carrier spools its drive and slips away.");
      navy(w, ["bomber", "bomber", "escort"]);
      rim(w, "carrier", "Hearthfire", 900, 200, { auto: false, wings: ["interceptor"] });
      say(w, "navy", "Tactical", "A lone carrier, its drive cold. Four minutes before it can jump.");
      return w;
    },
    plan: (w) => strike(w, "torpedo-run", rimShips(w)[0]),
  },
  {
    id: "through-the-screen", name: "Through the Screen", stars: 1,
    teaches: "Interceptors eat bombers, escorts eat interceptors. Hunt (T) their fighters first, then send the bombers.",
    build: (seed) => {
      const w = level(seed, 300, "loss", "The carrier's screen held. It jumps out.");
      navy(w, ["escort", "escort", "bomber", "bomber"]);
      rim(w, "carrier", "Open Hand", 900, -150, { auto: false, wings: ["interceptor", "interceptor", "interceptor"] });
      say(w, "navy", "Tactical", "Three interceptor flights round that carrier. Bombers alone won't get through them.");
      return w;
    },
    plan: (w) => {
      if (w.t > 6 && Math.round(w.t * 10) % 50 === 0 && rimAir(w)) { runPlay(w, "hunt", myWings(w).filter((g) => g.role === "escort")); return; }
      if (!rimAir(w)) strike(w, "torpedo-run", rimShips(w)[0]);
    },
  },
  {
    id: "split-shields", name: "Split Shields", stars: 2,
    teaches: "Shields hold best ahead. Strike a bulwark from both flanks at once with a pincer (W) and its shields split.",
    build: (seed) => {
      const w = level(seed, 300, "loss", "The bulwark's shields never broke. It withdraws.");
      navy(w, ["bomber", "bomber", "escort", "escort", "interceptor", "interceptor"]);
      rim(w, "bulwark", "Tidewall", 800, 0, { auto: false, wings: ["escort"] });
      say(w, "navy", "Tactical", "A Tidewall bulwark, shields facing us. Straight at its bow, they soak everything.");
      return w;
    },
    plan: (w) => strike(w, "pincer", rimShips(w)[0]),
  },
  {
    id: "escort-run", name: "Escort Run", stars: 2,
    teaches: "The Argus has to reach the relay alive. Put your fighters on it (pick them, right-click the Argus) and hunt (T) the bombers.",
    build: (seed) => {
      const w = level(seed, 300, "loss", "The Argus never made the relay.");
      navy(w, ["interceptor", "interceptor", "escort", "bomber"], { x: -1500, z: 300 });
      const argus = addShip(w, "navy", "sensor", "Argus", -1400, -100, 0, false);
      const relay = { x: 1800, z: -100 };
      argus.order = { k: "move", x: relay.x, z: relay.z };
      w.goal!.escort = { ship: argus.id, x: relay.x, z: relay.z, r: 260, why: "The Argus is at the relay. Its ping lights the whole sector." };
      // Two carriers off the route, their bombers sent at the Argus in waves.
      const a = rim(w, "carrier", "Hearthfire", 200, 1500, { auto: false }), b = rim(w, "carrier", "Last Harvest", 900, -1600, { auto: false });
      [[a, 4], [b, 12], [a, 30], [b, 45], [a, 65], [b, 85]].forEach(([c, at]) => {
        const g = addWing(w, c as Ship, "bomber", nextCall(w, "rim"), 5, at as number);
        g.order = { k: "attack", target: argus.id, targetIs: "ship" };
      });
      say(w, "navy", "Argus", "Making for the relay. Bombers on the scope, both sides. We have no guns to speak of.");
      return w;
    },
    plan: (w) => {
      const argus = w.ships.find((s) => s.kind === "sensor" && !s.dead);
      if (!argus) return;
      const fl = flagship(w)!;
      if (fl.order.k !== "guard") fl.order = { k: "guard", target: argus.id };
      if (Math.round(w.t * 10) % 30 !== 0) return;
      if (rimAir(w)) runPlay(w, "hunt", myWings(w));
      else for (const g of myWings(w)) if (g.role !== "bomber") g.order = { k: "escort", target: argus.id, targetIs: "ship" };
    },
  },
  {
    id: "into-the-rift", name: "Into the Rift", stars: 3,
    teaches: "Rifts hide hulls from everything but scouts. Send the scouts in (3) before you send the guns.",
    build: (seed) => {
      const w = level(seed, 360, "loss", "The relay never came to us.");
      const f = (w.field = newField(4500, 3000, 0));
      f.wells.push({ kind: "rift", name: "The Drowned Eye", x: 800, z: 0, core: 0, r: 1100, pull: 5 });
      f.veils.push({ kind: "rift", x: 800, z: 0, r: 900, depth: 1 });
      f.points.push({ id: w.nextId++, name: "Drowned Relay", x: 800, z: 0, r: 500, owner: "rim", hold: -1 });
      navy(w, ["scout", "bomber", "bomber", "escort", "interceptor"], { x: -2600, z: 0 });
      // An ambush in the rift: it waits at its post and chases only what it sees close by.
      rim(w, "cruiser", "Ember Tithe", 700, 150, { post: true, wings: ["escort"] });
      rim(w, "bulwark", "Deepwell", 950, -200, { post: true });
      // Mines across the rift's mouth: only what sees into the rift can shoot them down.
      for (let i = 0; i < 9; i++) { const a = Math.PI * (0.6 + (i / 8) * 0.8); f.mines.push({ id: w.nextId++, side: "rim", x: 800 + Math.cos(a) * 650, z: Math.sin(a) * 650, dead: false }); }
      sensors(w);
      say(w, "navy", "Sensors", "The relay sits in a rift. If anything waits there, we can't see it from here.");
      return w;
    },
    plan: (w) => {
      const f = w.field!, fl = flagship(w)!;
      // The scouts ride ahead into the rift; the guns follow and go for whatever the scouts light up.
      const scouts = myWings(w).find((g) => g.role === "scout");
      if (scouts && scouts.order.k !== "patrol") scouts.order = { k: "patrol", x: 650, z: 0 };
      const seen = rimShips(w).find((s) => f.sees.navy.has(s.id));
      if (seen) { strike(w, "torpedo-run", seen); if (fl.order.k !== "engage" || fl.order.target !== seen.id) fl.order = { k: "engage", target: seen.id, broadside: true }; }
      else if (w.t > 12 && fl.order.k !== "move") fl.order = { k: "move", x: 800, z: 0 };
    },
  },
  {
    id: "hold-the-lane", name: "Hold the Lane", stars: 4,
    teaches: "Their help comes through the lane. Park the interdictor on it (Shift+G) and it drops out dazed, shields down.",
    build: (seed) => {
      const w = level(seed, 360, "loss", "The Compact holds the system. We pull back.");
      navy(w, ["interceptor", "bomber", "bomber", "escort"]);
      const fr = addShip(w, "navy", "frigate", "Warden", -1250, 320, 0, false);
      fr.order = { k: "hold" };
      w.lane = { x: -100, z: 1250 };
      rim(w, "corvette", "Free Wind", 700, -200, { wings: ["interceptor"] });
      w.waves = [
        { at: 45, done: false, ships: [{ kind: "cruiser", wings: ["bomber"] }, { kind: "cruiser", wings: ["escort"] }] },
        { at: 110, done: false, ships: [{ kind: "carrier", wings: ["bomber", "interceptor"] }, { kind: "cruiser", wings: ["bomber"] }] },
      ];
      say(w, "navy", "Sensors", "The lane to the south is warm. Two waves inbound, the first in forty-five seconds.");
      return w;
    },
    plan: (w) => {
      const fr = w.ships.find((s) => s.kind === "frigate" && !s.dead);
      if (fr && fr.order.k !== "lane") fr.order = { k: "lane" };
      const fl = flagship(w)!;
      // The guns on the nearest; the bombers on whatever the interdictor has dragged out dazed, shields down.
      const byNear = rimShips(w).sort((a, b) => Math.hypot(a.x - fl.x, a.z - fl.z) - Math.hypot(b.x - fl.x, b.z - fl.z));
      const near = byNear[0];
      if (near && fl.order.k !== "engage") fl.order = { k: "engage", target: near.id, broadside: true };
      const dazed = byNear.find((s) => s.stunUntil > w.t);
      if (dazed && bombersFree(w)) runPlay(w, "torpedo-run", myWings(w), dazed.id);
      else strike(w, "torpedo-run", near);
    },
  },
  {
    id: "guns-or-land", name: "Guns or Land", stars: 4,
    teaches: "Guns on the land are guns not on ships. You can't sink them all in time: rake the base (V) and burn it.",
    build: (seed) => {
      const w = level(seed, 200, "loss", "The lane opens and the base is reinforced. Too late.", { name: "Corvel", x: 1400, z: 0, r: 420, base: 1700 });
      w.rimTemper = "pragmatist";
      navy(w, ["escort", "escort", "interceptor"]);
      rim(w, "bulwark", "Tidewall", 900, -700, { auto: false, wings: ["escort"] });
      rim(w, "bulwark", "Deepwell", 1000, 800, { auto: false });
      rim(w, "cruiser", "Stonebreak", 1900, 300, { auto: false });
      say(w, "navy", "Tactical", "Two bulwarks and a cruiser. Their shields would outlast our clock. The base under them would not.");
      return w;
    },
    plan: (w) => {
      const fl = flagship(w)!;
      if (fl.order.k !== "rake") fl.order = { k: "rake" };
      if (Math.round(w.t * 10) % 50 === 0) runPlay(w, rimAir(w) ? "hunt" : "screen", myWings(w));
    },
  },
  {
    id: "last-stand", name: "Last Stand", stars: 5,
    teaches: "No way out: break their gun line before it breaks you. Broadside (B) the nearest cruiser and torpedo-run (Q) it, one at a time.",
    build: (seed) => {
      const w = level(seed, 180, "win", "The relief fleet is out of hyperspace. You held.");
      navy(w, ["escort", "escort", "bomber", "bomber"], undefined, 0.5);
      const a = rim(w, "carrier", "Hearthfire", 1300, 500, { auto: false, reserve: 8 }), b = rim(w, "carrier", "Open Hand", 1300, -500, { auto: false, reserve: 8 });
      // Bomber waves at the flagship, two flights at a time, and two cruisers closing to gun range.
      [5, 35, 65, 95, 125].forEach((at, i) => [a, b].forEach((c, j) => {
        const g = addWing(w, c, "bomber", nextCall(w, "rim"), 5, at + j * 3 + i);
        g.order = { k: "attack", target: w.flagship, targetIs: "ship" };
        g.stance = "attack";
      }));
      rim(w, "cruiser", "Unbowed", 1100, 350, { wings: ["interceptor"] });
      rim(w, "cruiser", "Kindred", 1150, -350, { wings: ["interceptor"] });
      rim(w, "cruiser", "Stonebreak", 1300, 0);
      say(w, "navy", "Helm", "Drive's gone. Relief is three minutes out. Everything they have is coming at us.");
      return w;
    },
    plan: (w) => {
      const fl = flagship(w)!;
      // The nearest cruiser, side-on; when it breaks, the next.
      const guns = rimShips(w).filter((s) => s.kind === "cruiser").sort((a, b) => Math.hypot(a.x - fl.x, a.z - fl.z) - Math.hypot(b.x - fl.x, b.z - fl.z))[0];
      if (guns && (fl.order.k !== "engage" || fl.order.target !== guns.id)) fl.order = { k: "engage", target: guns.id, broadside: true };
      strike(w, "torpedo-run", guns);
    },
  },
];

export const levelById = (id: string) => LEVELS.find((l) => l.id === id);

/** A level's world, with its lesson said on the comms as it starts. */
export function startLevel(l: Level, seed: number): World {
  const w = l.build(seed);
  say(w, "navy", "Lesson", l.teaches);
  return w;
}

