// The minds on the other side of the table, and the ones under you. A captain runs one ship and its wings with a
// doctrine (press, steady, shield) by calling plays from the same playbook you use. The Compact admiral sets its captains'
// doctrines from its temper and what you are doing: rake its world and a zealot throws hulls in the way, a
// pragmatist turns every gun on your flagship. Foresight shows you its next call before it makes it.
import { HULL, alive, flagship, nearestShip, say, ship, type Doctrine, type Ship, type World } from "./world.ts";
import { courier, runPlay, wingsOf, type PlayId } from "./plays.ts";

const THINK = 3;
const plays = new WeakMap<World, Map<number, PlayId>>();
const lastPlays = (w: World) => plays.get(w) ?? plays.set(w, new Map()).get(w)!;


/** One captain's turn: move the ship and call a play for its wings, every few seconds. */
export function captain(w: World, s: Ship) {
  if (s.dead || !s.auto) return;
  const foeSide = s.side === "navy" ? "rim" : "navy";
  const boss = s.boss ? ship(w, s.boss) : undefined;
  // A captain goes for the enemy flagship unless something else is a lot closer.
  const near = nearestShip(w, foeSide, s.x, s.z, (o) => o.kind !== "station") || nearestShip(w, foeSide, s.x, s.z);
  const head = foeSide === "navy" ? flagship(w) : undefined;
  const d = (o?: Ship) => (o ? Math.hypot(o.x - s.x, o.z - s.z) : Infinity);
  const focus = (s.focus && ship(w, s.focus)) || (head && d(near) > d(head) * 0.6 ? head : near);
  if (!focus) return;
  s.focus = focus.id;
  // The ship: press closes and broadsides, steady engages at range, shield puts the hull in front of its charge.
  if (s.kind !== "station") {
    if (s.doctrine === "shield") {
      const charge = s.side === "rim" ? -1 : boss?.id ?? flagship(w)?.id ?? 0;
      if (s.order.k !== "guard" || s.order.target !== charge) s.order = { k: "guard", target: charge };
    } else if (s.order.k !== "flank" || s.order.target !== focus.id) {
      s.order = { k: "engage", target: focus.id, broadside: s.doctrine === "press" };
    }
  }
  // The wings, once every THINK seconds per ship (staggered by id so captains don't all think on one tick).
  if (Math.floor((w.t + s.id * 0.7) / THINK) === Math.floor((w.t + s.id * 0.7 - 0.1) / THINK)) return;
  const ws = wingsOf(w, s.id).filter((g) => alive(g).length || !g.craft.length);
  if (!ws.length) return;
  const busy = ws.some((g) => g.waypoint || g.later);
  if (busy) return;
  const bombersOut = ws.some((g) => g.role === "bomber" && g.state === "out" && g.order.k === "attack");
  const play: PlayId | null =
    s.doctrine === "shield" ? "screen"
    : s.doctrine === "press" ? (bombersOut ? null : w.t % 30 < 15 ? "pincer" : "torpedo-run")
    : bombersOut ? "hunt" : "hammer-anvil";
  if (!play) return;
  // A shield captain only screens a ship it is guarding; a Compact shield captain screens the station.
  const target = play === "screen" || play === "hunt" ? 0 : focus.id;
  if (s.side === "rim" && play === "screen") {
    const station = w.ships.find((o) => !o.dead && o.side === "rim" && o.kind === "station");
    for (const g of ws.filter((g) => g.role !== "bomber")) if (station) { g.order = { k: "escort", target: station.id, targetIs: "ship" }; g.stance = "defend"; }
    for (const g of ws.filter((g) => g.role === "bomber" && g.state === "out")) runPlay(w, "torpedo-run", [g], flagship(w)?.id ?? 0);
    return;
  }
  const lastPlay = lastPlays(w);
  const line = runPlay(w, play, ws, target);
  // Your captains report the play they call, once per change.
  if (s.side === "navy" && lastPlay.get(s.id) !== play) { lastPlay.set(s.id, play); say(w, "navy", s.name, line); }
}

/** What the Compact admiral will do next, in plain words, for Foresight. */
function intentLine(d: Doctrine, temper: World["rimTemper"]) {
  const when = temper === "zealot" ? "If you rake the world, every hull they have will throw itself in the way." : temper === "pragmatist" ? "If you rake the world, they will forget the land and broadside your flagship." : "They will hold back, bleed you with bombers, and wait for the lane.";
  const now = d === "press" ? "Now: all guns on your flagship, bombers on its flanks." : d === "shield" ? "Now: hulls between you and the planet, fighters guarding the bastion." : "Now: trading at range, fighters hunting your bombers.";
  return `${now} ${when}`;
}

/** The Compact admiral: picks its doctrine from its temper and the battle, and hands it to every Compact captain. */
export function rimAdmiral(w: World) {
  if (w.t < w.rimNext) return;
  w.rimNext = w.t + 2;
  const fl = flagship(w);
  if (!fl) return;
  const raking = fl.order.k === "rake";
  const hurt = w.ships.filter((s) => s.side === "rim" && !s.dead && s.kind !== "station").reduce((a, s) => a + s.hull / s.hullMax, 0);
  let d: Doctrine = "steady";
  if (raking) d = w.rimTemper === "zealot" ? "shield" : w.rimTemper === "pragmatist" ? "press" : "steady";
  else if (fl.hull / fl.hullMax < 0.45) d = "press";
  else if (hurt < 1) d = "shield";
  if (d !== w.rimDoctrine) {
    w.rimDoctrine = d;
    say(w, "rim", "Compact admiral", d === "shield" ? "Protect the world! Put yourselves between them and our people." : d === "press" ? "All ships, their flagship. Break it and they break." : "Hold at range. Bleed them.");
  }
  w.rimIntent = intentLine(d, w.rimTemper);
  for (const s of w.ships) if (s.side === "rim" && !s.dead) s.doctrine = d;
}

/** Your subordinate captains in the Armada: each runs its doctrine on its focus, under your dreadnought. */
export function navyCaptains(w: World) {
  for (const s of w.ships) if (s.side === "navy" && s.auto && !s.dead) captain(w, s);
}

/** Every Compact captain. */
export function rimCaptains(w: World) {
  for (const s of w.ships) if (s.side === "rim" && !s.dead) captain(w, s);
}

/** The brains a battle runs every tick: the Compact side, and your captains when you have any. */
export const brains = [courier, rimAdmiral, rimCaptains, navyCaptains];

/** A ship's guns in range of what. Used by the bridge to show who can hit whom. */
export const inRange = (a: Ship, b: Ship) => Math.hypot(a.x - b.x, a.z - b.z) <= HULL[a.kind].range;

/** A plain commander for your side, played by the book: the interdictor to the lane, a play on the carrier (then the
 *  bastion, then whatever is left) whenever the bombers are free, the flagship broadside to the nearest gun line, and
 *  a rake once the bastion is down and the flagship can afford it. The tests, the menu's backdrop and an empty co-op
 *  seat run it; a player should beat it. */
export function autoCommander(w: World, play: PlayId = "torpedo-run") {
  const fl = flagship(w);
  if (!fl) return;
  const rim = w.ships.filter((s) => s.side === "rim" && !s.dead);
  const bastion = rim.find((s) => s.kind === "station");
  const pick = rim.find((s) => s.kind === "carrier") ?? bastion ?? rim.find((s) => s.kind === "cruiser") ?? rim[0];
  const ws = wingsOf(w, fl.id);
  const free = ws.filter((g) => g.role === "bomber").every((g) => !g.later && (g.state !== "out" || g.order.k !== "attack"));
  if (pick && w.t > 8 && free && Math.round(w.t * 10) % 50 === 0) runPlay(w, play, ws, pick.id);
  const warden = w.ships.find((s) => s.side === "navy" && s.kind === "frigate" && !s.dead);
  if (warden && warden.order.k === "hold") warden.order = { k: "lane" };
  const guns = rim.find((s) => s.kind === "cruiser") ?? rim.find((s) => s.kind === "corvette") ?? bastion;
  if (!bastion && (!guns || fl.hull / fl.hullMax > 0.5)) { if (fl.order.k !== "rake") fl.order = { k: "rake" }; }
  else if (guns && (fl.order.k === "hold" || fl.order.k === "rake")) fl.order = { k: "engage", target: guns.id, broadside: true };
}
