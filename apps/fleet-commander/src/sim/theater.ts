// The theater: a whole star system under fog of war, played like a top-down RTS. You know the Compact is in the
// system, not where. Sensors see so far and no further; rifts (gravitational anomalies) hide hulls from all but
// scouts and the sensor ship, and the thermal shear round the star hides them from all but the sensor ship (or every
// ship, once you buy thermal sensors). Firing gives a ship away. Gravity wells round the star, the planets and the
// rifts speed up whatever falls along them, so a route drawn round a well (the slingshot) beats the straight line.
// The Compact fights like a hunted fleet: fewer guns, deep shields, mines round what it holds, and ambushers that
// wait in the dark. Strongpoints pay supply to whoever holds them; supply buys wings and the sensor upgrade.
//
// Plain data and brains like the rest of the sim: `fieldBrain` runs first each tick, then the usual brains.
import type { Role, ShipKind, Side } from "../names.ts";
import { brains } from "./ai.ts";
import { HULL, addShip, addWing, alive, emptyWorld, flagship, fx, hitCraft, hitShip, nextCall, rand, say, sees, type Brain, type Field, type World } from "./world.ts";

/** How far each hull sees, and how deep into the veils (0: open space only, 1: into rifts, 2: into the shear). */
export const SENSOR: Record<ShipKind, { range: number; tier: number }> = {
  dreadnought: { range: 2200, tier: 0 }, destroyer: { range: 1800, tier: 0 }, frigate: { range: 1500, tier: 0 }, sensor: { range: 3400, tier: 2 },
  corvette: { range: 2000, tier: 0 }, cruiser: { range: 1600, tier: 0 }, carrier: { range: 1500, tier: 0 }, station: { range: 2200, tier: 0 },
  bulwark: { range: 1600, tier: 0 }, minelayer: { range: 1300, tier: 0 },
};
export const CRAFT_SENSOR: Record<Role, { range: number; tier: number }> = {
  interceptor: { range: 700, tier: 0 }, bomber: { range: 600, tier: 0 }, escort: { range: 700, tier: 0 }, scout: { range: 1700, tier: 1 },
};
/** Inside this, anything is seen: no veil hides a hull you could hit with a thrown spanner. */
export const POINT_BLANK = 320;
export const MINE = { dmg: 520, bypass: 0.45, trigger: 70, see: 450, lay: 18, most: 40 };
export const PING = { reach: 4200, lasts: 8, every: 35, loud: 15 };
/** What supply buys: a wing from the flagship's hangar, or thermal sensors for the whole fleet. */
export const BUY = { scout: 4, interceptor: 6, bomber: 8, escort: 6, sensors: 18 } as const;
export type Buy = keyof typeof BUY;
/** Supply a second from each strongpoint held, and how long holding all of them takes to win. */
export const HOLD = { pay: 0.25, take: 20, win: 60 };

const other = (s: Side): Side => (s === "navy" ? "rim" : "navy");
const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(bx - ax, bz - az);

/** How far a held strongpoint listens: what a side holds, it watches. */
export const POST_EARS = 2000;

/** Every eye a side has: its ships, its wings in the air and the strongpoints it holds, each with a reach and a tier. */
export function eyes(w: World, side: Side) {
  const bonus = w.field?.tier[side] ?? 0;
  const out: { x: number; z: number; r: number; tier: number }[] = [];
  for (const s of w.ships) if (!s.dead && s.side === side) out.push({ x: s.x, z: s.z, r: SENSOR[s.kind].range, tier: SENSOR[s.kind].tier + bonus });
  for (const g of w.wings) if (g.side === side && g.state === "out" && alive(g).length) out.push({ x: g.x, z: g.z, r: CRAFT_SENSOR[g.role].range, tier: CRAFT_SENSOR[g.role].tier + bonus });
  for (const p of w.field?.points ?? []) if (p.owner === side) out.push({ x: p.x, z: p.z, r: POST_EARS, tier: bonus });
  return out;
}

/** How deep the veils are at a point: 0 in open space. */
export function veilDepth(f: Field, x: number, z: number) {
  let d = 0;
  for (const v of f.veils) if (dist(v.x, v.z, x, z) < v.r) d = Math.max(d, v.depth);
  return d;
}

type Eye = ReturnType<typeof eyes>[number];
const spots = (es: Eye[], x: number, z: number, depth: number, loud: boolean) =>
  es.some((e) => { const d = dist(e.x, e.z, x, z); return d < POINT_BLANK || (d < e.r && (e.tier >= depth || loud)); });

/** The sensors: what each side sees, refreshed into `field.sees`. */
export function sensors(w: World) {
  const f = w.field;
  if (!f) return;
  for (const side of ["navy", "rim"] as const) {
    const es = eyes(w, side), seen = new Set<number>(), foe = other(side);
    const pinged = (x: number, z: number) => side === "navy" && w.t < f.ping.until && dist(f.ping.x, f.ping.z, x, z) < PING.reach;
    for (const s of w.ships) {
      if (s.dead) { f.known[side].delete(s.id); continue; }
      if (s.side === foe && (pinged(s.x, s.z) || spots(es, s.x, s.z, veilDepth(f, s.x, s.z), w.t < s.loudUntil))) { seen.add(s.id); f.known[side].set(s.id, { x: s.x, z: s.z, t: w.t }); }
    }
    for (const g of w.wings) if (g.side === foe && g.state === "out" && alive(g).length && (pinged(g.x, g.z) || spots(es, g.x, g.z, veilDepth(f, g.x, g.z), false))) seen.add(g.id);
    // A mine is cold and small: seen close to, by a deep sensor in range, or by a ping.
    for (const m of f.mines) if (!m.dead && m.side === foe && (pinged(m.x, m.z) || es.some((e) => { const d = dist(e.x, e.z, m.x, m.z); return d < MINE.see || (e.tier >= 2 && d < e.r); }))) seen.add(m.id);
    f.sees[side] = seen;
  }
}

/** Mines break on what comes close; point defence picks off the mines its side can see. */
function mines(w: World, f: Field) {
  for (const m of f.mines) {
    if (m.dead) continue;
    const foe = other(m.side);
    const s = w.ships.find((s) => !s.dead && s.side === foe && dist(s.x, s.z, m.x, m.z) < HULL[s.kind].r + MINE.trigger);
    if (s) {
      m.dead = true;
      hitShip(w, s, MINE.dmg, m.x, m.z, MINE.bypass, m.side, "mines");
      fx(w, "torphit", m.side, m.x, m.z);
      if (s.side === "navy") say(w, "navy", "Damage control", `The ${s.name} hit a mine!`);
      continue;
    }
    for (const g of w.wings) {
      if (g.side !== foe || g.state !== "out") continue;
      const c = alive(g).find((c) => dist(c.x, c.z, m.x, m.z) < MINE.trigger * 0.6);
      if (c) { m.dead = true; hitCraft(w, g, c, 999); fx(w, "boom", m.side, m.x, m.z); break; }
    }
  }
  for (const s of w.ships) {
    if (s.dead) continue;
    const m = f.mines.find((m) => !m.dead && m.side !== s.side && dist(s.x, s.z, m.x, m.z) < HULL[s.kind].pdRange + 80 && sees(w, s.side, m.id));
    if (m && rand(w) < 0.04) { m.dead = true; fx(w, "pdc", s.side, s.x, s.z, m.x, m.z); fx(w, "boom", m.side, m.x, m.z); }
  }
  if (f.mines.some((m) => m.dead)) f.mines = f.mines.filter((m) => !m.dead);
}

/** Strongpoints: a side with hulls inside and none of the other's pushes the hold its way; held, it pays. */
function strongpoints(w: World, f: Field, dt: number) {
  const here = (side: Side, p: Field["points"][number]) =>
    w.ships.filter((s) => !s.dead && s.side === side && s.kind !== "station" && dist(s.x, s.z, p.x, p.z) < p.r).length +
    w.wings.filter((g) => g.side === side && g.state === "out" && g.role !== "scout" && alive(g).length && dist(g.x, g.z, p.x, p.z) < p.r).length * 0.5;
  for (const p of f.points) {
    const n = here("navy", p), r = here("rim", p);
    if (n && !r) p.hold = Math.min(1, p.hold + (dt * n) / HOLD.take);
    else if (r && !n) p.hold = Math.max(-1, p.hold - (dt * r) / HOLD.take);
    const was = p.owner;
    if (p.hold >= 1) p.owner = "navy";
    else if (p.hold <= -1) p.owner = "rim";
    else if ((p.owner === "navy" && p.hold < 0) || (p.owner === "rim" && p.hold > 0)) p.owner = null;
    if (p.owner !== was) {
      if (p.owner === "navy") say(w, "navy", "Tactical", `${p.name} is ours. Supply is flowing.`);
      else if (p.owner === "rim") say(w, "navy", "Tactical", `We've lost ${p.name}.`);
      else if (was === "rim") say(w, "navy", "Tactical", `The Compact's hold on ${p.name} is broken.`);
    }
    if (p.owner) f.supply[p.owner] += HOLD.pay * dt;
  }
  if (f.points.length && f.points.every((p) => p.owner === "navy")) {
    if (!f.heldSince) { f.heldSince = w.t; say(w, "navy", "Tactical", `Every strongpoint is ours. Hold them ${HOLD.win} seconds and the system falls.`); }
    else if (w.t - f.heldSince >= HOLD.win) { w.outcome = "win"; w.why = "You hold every strongpoint in the system. The Compact's supply lines are cut."; }
  } else f.heldSince = 0;
}

/** Spend supply: a wing launched from the flagship (or a Compact carrier), or thermal sensors. Returns why not, or "". */
export function requisition(w: World, side: Side, what: Buy): string {
  const f = w.field;
  if (!f) return "Nothing to requisition here.";
  const cost = BUY[what];
  if (f.supply[side] < cost) return `Needs ${cost} supply; you have ${Math.floor(f.supply[side])}.`;
  if (what === "sensors") {
    if (f.tier[side] >= 1) return "Thermal sensors are already fitted.";
    f.tier[side] = 1;
    f.supply[side] -= cost;
    if (side === "navy") say(w, "navy", "Sensors", "Thermal sensors online. Every ship sees into the rifts now, and the scouts into the shear.");
    return "";
  }
  const home = side === "navy" ? flagship(w) : w.ships.find((s) => !s.dead && s.side === "rim" && (s.kind === "carrier" || s.kind === "station"));
  if (!home) return "No hangar to launch from.";
  const g = addWing(w, home, what, nextCall(w, side), what === "scout" ? 3 : what === "bomber" ? 4 : 5, w.t + 3);
  if (what === "scout") g.formation = "loose";
  f.supply[side] -= cost;
  if (side === "navy") say(w, "navy", "Deck", `${g.name} wing is fuelled and on the deck.`);
  return "";
}

/** The sensor ship's ping: everything within reach shows for a few seconds, rifts, shear and mines too. It is loud:
 *  the Compact hears it from anywhere for longer than you see. Returns why not, or "". */
export function ping(w: World): string {
  const f = w.field;
  const s = w.ships.find((s) => !s.dead && s.side === "navy" && s.kind === "sensor");
  if (!f || !s) return "No sensor ship to ping with.";
  if (w.t < f.ping.ready) return `The ping array recharges: ${Math.ceil(f.ping.ready - w.t)} s.`;
  f.ping = { x: s.x, z: s.z, until: w.t + PING.lasts, ready: w.t + PING.every };
  s.loudUntil = w.t + PING.loud;
  sensors(w);
  say(w, "navy", s.name, "Ping away. Everything out to four thousand is on the table.");
  return "";
}

/** The Compact's side of the theater: buys wings with its supply, and its minelayers sow round what it holds. */
function rimField(w: World, f: Field) {
  // A wing now and then while it can pay, up to a dozen in the air: the Compact has the supply, not the pilots.
  const flying = w.wings.filter((g) => g.side === "rim" && (alive(g).length || !g.craft.length)).length;
  if (f.supply.rim >= 8 && flying < 12 && rand(w) < 0.005) requisition(w, "rim", rand(w) < 0.5 ? "interceptor" : "bomber");
  for (const s of w.ships) {
    if (s.dead || s.side !== "rim" || s.kind !== "minelayer") continue;
    // The minelayer works round the strongpoints the Compact holds, then goes back to hide.
    const held = f.points.filter((p) => p.owner === "rim");
    const p = held.length ? held[Math.floor(w.t / 60) % held.length] : null;
    if (p && !s.focus && f.mines.filter((m) => m.side === "rim").length < MINE.most) s.post = { x: p.x + 700, z: p.z };
    if (Math.round(w.t * 10) % (MINE.lay * 10) === 0 && f.mines.filter((m) => m.side === "rim").length < MINE.most) {
      const a = rand(w) * Math.PI * 2;
      f.mines.push({ id: w.nextId++, side: "rim", x: s.x + Math.cos(a) * 200, z: s.z + Math.sin(a) * 200, dead: false });
    }
  }
}

/** The theater's tick, before the captains think: sensors (twice a second), mines, strongpoints, the Compact's spending. */
export const fieldBrain: Brain = (w) => {
  const f = w.field;
  if (!f) return;
  if (Math.round(w.t * 10) % 5 === 0) sensors(w);
  mines(w, f);
  strongpoints(w, f, 0.1);
  rimField(w, f);
};

/** Every brain a theater battle runs. */
export const theaterBrains: Brain[] = [fieldBrain, ...brains];

/** An empty board in the fog, `wide` by `deep` each way from the middle, each side starting with `supply`. */
export function newField(wide: number, deep: number, supply: number): Field {
  return {
    wide, deep, wells: [], veils: [], mines: [], points: [],
    supply: { navy: supply, rim: supply }, sees: { navy: new Set(), rim: new Set() }, tier: { navy: 0, rim: 0 },
    ping: { x: 0, z: 0, until: 0, ready: 0 }, heldSince: 0, known: { navy: new Map(), rim: new Map() },
  };
}

/** The Pyre system: you drop in at the west edge; the Compact's home world, Hollow, is at the east. Between them a star
 *  whose heat shear hides ships, two planets, two rifts, and four strongpoints, two of them the Compact's and mined. */
export function theater(seed: number): World {
  const w = emptyWorld(seed);
  w.rimTemper = (["zealot", "pragmatist", "cagey"] as const)[Math.floor(rand(w) * 3)];
  w.limit = 900;
  const f = (w.field = newField(8000, 5000, 6));
  w.planet = { name: "Hollow", x: 6000, z: 300, r: 520, base: 3200, baseMax: 3200 };
  f.wells.push(
    { kind: "star", name: "Pyre", x: 0, z: 400, core: 650, r: 3000, pull: 14 },
    { kind: "planet", name: "Ostra", x: -4600, z: 2900, core: 380, r: 1500, pull: 8 },
    { kind: "planet", name: "Kesh", x: 2900, z: -3300, core: 360, r: 1500, pull: 8 },
    { kind: "planet", name: "Hollow", x: 6000, z: 300, core: 520, r: 1800, pull: 9 },
    { kind: "rift", name: "The Drowned Eye", x: -1200, z: -3200, core: 0, r: 1100, pull: 5 },
    { kind: "rift", name: "Tessel Rift", x: 3400, z: 3200, core: 0, r: 950, pull: 5 },
  );
  f.veils.push(
    { kind: "rift", x: -1200, z: -3200, r: 850, depth: 1 },
    { kind: "rift", x: 3400, z: 3200, r: 750, depth: 1 },
    { kind: "shear", x: 0, z: 400, r: 1900, depth: 2 },
  );
  const point = (name: string, x: number, z: number, owner: Side | null) => f.points.push({ id: w.nextId++, name, x, z, r: 500, owner, hold: owner === "rim" ? -1 : owner === "navy" ? 1 : 0 });
  point("Ostra Station", -4300, 2300, null);
  point("Corona Relay", -300, -1700, null);
  point("Kesh Yards", 2500, -2800, "rim");
  point("Hollow Gate", 4600, 2000, "rim");
  w.lane = { x: 7200, z: 3800 };

  const fl = addShip(w, "navy", "destroyer", "Relentless", -6200, 0, 0, false);
  fl.reserve = 10;
  w.flagship = fl.id;
  addShip(w, "navy", "destroyer", "Vigil", -6350, -520, 0, false);
  addShip(w, "navy", "frigate", "Warden", -6500, 520, 0, false);
  addShip(w, "navy", "sensor", "Argus", -6650, 0, 0, false);
  (["scout", "interceptor", "interceptor", "bomber", "bomber", "escort"] as Role[]).forEach((r, i) => {
    const g = addWing(w, fl, r, nextCall(w, "navy"), r === "scout" ? 3 : r === "bomber" ? 5 : r === "escort" ? 5 : 6, 1 + i * 1.5);
    // Scouts fly loose: they jink, and live a little longer near the Compact's fighters.
    if (r === "scout") g.formation = "loose";
  });

  const rim = (kind: ShipKind, name: string, x: number, z: number, wings: Role[] = []) => {
    const s = addShip(w, "rim", kind, name, x, z, Math.PI, true);
    if (kind !== "station") s.post = { x, z };
    wings.forEach((r, i) => addWing(w, s, r, nextCall(w, "rim"), r === "bomber" ? 4 : 5, 4 + i * 3));
    return s;
  };
  rim("station", "Bastion of Hollow", 5500, -200, ["interceptor"]).reserve = 10;
  rim("carrier", "Hearthfire", 6300, 1200, ["interceptor", "bomber"]).reserve = 12;
  // The ambushes: hulls waiting where your sensors can't reach.
  rim("bulwark", "Tidewall", -1300, -3100, ["escort"]);
  rim("corvette", "Brackwater", -1000, -3350, ["interceptor"]);
  rim("cruiser", "Ember Tithe", -900, 1500, ["escort"]);
  rim("bulwark", "Deepwell", 3400, 3300);
  rim("minelayer", "Sower", 3250, 3050);
  rim("corvette", "Gannet", 2600, -2650, ["interceptor"]);
  rim("corvette", "Riverbend", 2350, -2950);
  // Mines round what the Compact holds, and across the approach to the relay.
  const ring = (cx: number, cz: number, r: number, n: number, a0 = 0) => { for (let i = 0; i < n; i++) { const a = a0 + (i / n) * Math.PI * 2; f.mines.push({ id: w.nextId++, side: "rim", x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, dead: false }); } };
  ring(2500, -2800, 750, 8, 0.2);
  ring(4600, 2000, 750, 8, 0.5);
  for (let i = 0; i < 6; i++) f.mines.push({ id: w.nextId++, side: "rim", x: -1500 + i * 220, z: -1300 + (i % 2) * 160, dead: false });
  w.waves = [
    { at: 300, done: false, ships: [{ kind: "cruiser", wings: ["bomber"] }, { kind: "corvette", wings: ["interceptor"] }] },
    { at: 540, done: false, ships: [{ kind: "carrier", wings: ["bomber", "interceptor"] }, { kind: "bulwark", wings: [] }] },
  ];
  sensors(w);
  say(w, "navy", "Helm", "Out of hyperspace at the edge of the Pyre system.");
  say(w, "navy", "Sensors", "The Compact is here, but the board is dark: nothing in the rifts or the star's heat. Send the scouts.");
  return w;
}
