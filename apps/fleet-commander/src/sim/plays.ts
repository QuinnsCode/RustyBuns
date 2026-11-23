// The playbook: a play is a set of orders for a handful of wings, given at once, with the timing between them built
// in (a pincer's two arms arrive together, a feint's real strike waits). The player calls them from the bridge, a
// captain AI calls the same plays for its own wings, and an admiral calls ship plays for its captains: one
// vocabulary at every level of command.
import type { Role } from "../names.ts";
import { alive, approachPoint, nearestShip, ship, wing, type Approach, type Formation, type Ship, type Stance, type Wing, type World, type WingOrder } from "./world.ts";

export type PlayId = "torpedo-run" | "pincer" | "hammer-anvil" | "screen" | "hunt" | "feint" | "recall";

export interface Play {
  id: PlayId; key: string; name: string; needsTarget: boolean;
  /** One line for the play card. */
  blurb: string;
  /** What it does, step by step, for the tooltip. */
  steps: string;
}

export const PLAYS: Play[] = [
  { id: "torpedo-run", key: "Q", name: "Torpedo run", needsTarget: true, blurb: "Bombers straight in, escorts riding with them.", steps: "Bombers attack the target head-on, tight formation. Escorts guard the bombers. Interceptors hunt their fighters near the target." },
  { id: "pincer", key: "W", name: "Pincer", needsTarget: true, blurb: "Two arms round both flanks, arriving at once: split shields.", steps: "Half the strike swings left, half right. Each arm waits at its flank until both are there, then both run in. Hits from two sides split the target's shields." },
  { id: "hammer-anvil", key: "E", name: "Hammer and anvil", needsTarget: true, blurb: "Pin their fighters up front, bombers hit the stern.", steps: "Escorts and interceptors attack the fighters round the target (the anvil). Bombers loop round to its rear, where shields are weakest, and strike (the hammer)." },
  { id: "screen", key: "R", name: "Screen", needsTarget: false, blurb: "Every fighter home, a wall in front of the flagship.", steps: "Interceptors and escorts escort the flagship in defend stance, screen formation. Bombers return to rearm." },
  { id: "hunt", key: "T", name: "Hunt", needsTarget: false, blurb: "Fighters off the leash: kill their bombers first.", steps: "Interceptors and escorts attack the nearest enemy wings, bombers first, in attack stance and loose formation." },
  { id: "feint", key: "Y", name: "Feint", needsTarget: true, blurb: "A loud attack on the wrong ship, then the real one.", steps: "Escorts hit the nearest other enemy ship hard and loud. Twelve seconds later, bombers and interceptors strike the real target from the rear." },
  { id: "recall", key: "X", name: "Recall", needsTarget: false, blurb: "All wings home to rearm and repair.", steps: "Every wing returns to its ship's hangar, rearms and relaunches." },
];

export const playById = (id: PlayId) => PLAYS.find((p) => p.id === id)!;

function order(g: Wing, o: WingOrder, stance: Stance, formation: Formation, approach: Approach = "direct") {
  g.order = o; g.stance = stance; g.formation = formation; g.approach = approach; g.later = null;
  if (g.state === "returning") g.state = "out";
}

function runAt(w: World, g: Wing, target: Ship, how: Approach, group: number) {
  g.approach = how;
  const wp = approachPoint(w, g, target, how);
  g.waypoint = wp; g.staged = !wp; g.group = group; g.groupAt = w.t;
}

const byRole = (ws: Wing[], r: Role) => ws.filter((g) => g.role === r);

/** Run a play with `wings` (only the ones in the air or ready count) on `target` (an enemy ship id, 0 if none).
 *  Returns the line the wing leader says, or why it can't. */
export function runPlay(w: World, id: PlayId, wings: Wing[], target = 0): string {
  const ws = wings.filter((g) => alive(g).length || !g.craft.length);
  const t = target ? ship(w, target) : undefined;
  const p = playById(id);
  if (p.needsTarget && !t) return `${p.name} needs a target ship.`;
  if (!ws.length) return "No wings to fly it.";
  const group = ++w.groupN;
  const bombers = byRole(ws, "bomber"), escorts = byRole(ws, "escort"), inters = byRole(ws, "interceptor");
  const home = ship(w, ws[0].home);
  switch (id) {
    case "torpedo-run": {
      for (const g of bombers) { order(g, { k: "attack", target: t!.id, targetIs: "ship" }, "attack", "tight"); runAt(w, g, t!, "direct", group); }
      escorts.forEach((g, i) => order(g, bombers.length ? { k: "escort", target: bombers[i % bombers.length].id, targetIs: "wing" } : { k: "attack", target: t!.id, targetIs: "ship" }, "defend", "screen"));
      for (const g of inters) order(g, { k: "patrol", x: t!.x, z: t!.z }, "attack", "loose");
      return `Torpedo run on the ${t!.name}.`;
    }
    case "pincer": {
      const strike = [...bombers, ...escorts, ...inters];
      strike.forEach((g, i) => {
        const how: Approach = i % 2 ? "right" : "left";
        order(g, { k: "attack", target: t!.id, targetIs: "ship" }, g.role === "bomber" ? "attack" : "neutral", g.role === "bomber" ? "tight" : "screen", how);
        runAt(w, g, t!, how, group);
      });
      return `Pincer on the ${t!.name}: arms left and right, in on my mark.`;
    }
    case "hammer-anvil": {
      const guard = w.wings.find((o) => o.side !== ws[0].side && o.state === "out" && alive(o).length && o.order.k === "escort" && o.order.target === t!.id);
      for (const g of [...escorts, ...inters]) order(g, guard ? { k: "attack", target: guard.id, targetIs: "wing" } : { k: "patrol", x: t!.x, z: t!.z }, "attack", "screen");
      for (const g of bombers) { order(g, { k: "attack", target: t!.id, targetIs: "ship" }, "attack", "tight", "rear"); runAt(w, g, t!, "rear", group); }
      return `Anvil up front, hammer to the ${t!.name}'s stern.`;
    }
    case "screen": {
      const fl = home;
      for (const g of [...escorts, ...inters]) order(g, { k: "escort", target: fl?.id ?? 0, targetIs: "ship" }, "defend", "screen");
      for (const g of bombers) { order(g, { k: "return" }, "defend", "tight"); g.state = "returning"; }
      return "All fighters, screen the ship.";
    }
    case "hunt": {
      const foes = w.wings.filter((o) => o.side !== ws[0].side && o.state === "out" && alive(o).length);
      const pick = (g: Wing) => foes.slice().sort((a, b) => (a.role === "bomber" ? -1 : 0) - (b.role === "bomber" ? -1 : 0) || Math.hypot(a.x - g.x, a.z - g.z) - Math.hypot(b.x - g.x, b.z - g.z))[0];
      for (const g of [...inters, ...escorts]) {
        const f = pick(g);
        order(g, f ? { k: "attack", target: f.id, targetIs: "wing" } : { k: "patrol", x: g.x, z: g.z }, "attack", "loose");
      }
      return foes.length ? "Fighters free, hunt their bombers." : "Nothing in the air to hunt; holding.";
    }
    case "feint": {
      const decoy = nearestShip(w, t!.side, t!.x, t!.z, (s) => s.id !== t!.id) ?? t!;
      for (const g of escorts.length ? escorts : inters.slice(0, 1)) order(g, { k: "attack", target: decoy.id, targetIs: "ship" }, "attack", "screen");
      const real = [...bombers, ...(escorts.length ? inters : inters.slice(1))];
      const wait = home ? { x: (home.x + t!.x) / 2 + (t!.z - home.z) * 0.3, z: (home.z + t!.z) / 2 - (t!.x - home.x) * 0.3 } : { x: t!.x, z: t!.z };
      for (const g of real) {
        order(g, { k: "patrol", x: wait.x, z: wait.z }, "defend", "loose");
        g.later = { at: w.t + 12, order: { k: "attack", target: t!.id, targetIs: "ship" }, approach: "rear", stance: "attack" };
        g.group = group; g.waypoint = null; g.staged = false;
      }
      return `Feint on the ${decoy.name}; the real blow lands on the ${t!.name} in twelve.`;
    }
    case "recall": {
      for (const g of ws) if (g.state === "out") { order(g, { k: "return" }, g.stance, g.formation); g.state = "returning"; }
      return "All wings, return to the hangar.";
    }
  }
}

export const wingsOf = (w: World, shipId: number) => w.wings.filter((g) => g.home === shipId);
export { wing };

/** The same plays one level up: the ships are a dreadnought's destroyers, and each one's captain then runs its own
 *  wings with the doctrine the play gives it. A pincer of destroyers splits shields the way a pincer of wings does. */
export function runFleetPlay(w: World, id: PlayId, ships: Ship[], target = 0): string {
  const ss = ships.filter((s) => !s.dead && s.kind !== "dreadnought" && s.auto);
  const t = target ? ship(w, target) : undefined;
  const p = playById(id);
  if (p.needsTarget && !t) return `${p.name} needs a target ship.`;
  if (!ss.length) return "No destroyers to fly it.";
  const boss = ship(w, ss[0].boss);
  const press = (s: Ship, doctrine: Ship["doctrine"], focus: number) => { s.doctrine = doctrine; s.focus = focus; s.order = { k: "engage", target: focus, broadside: doctrine === "press" }; };
  const flank = (s: Ship, how: Approach) => { const wp = approachPoint(w, s, t!, how)!; s.order = { k: "flank", target: t!.id, wx: wp.x, wz: wp.z, reached: false }; s.focus = t!.id; s.doctrine = "press"; };
  switch (id) {
    case "torpedo-run": for (const s of ss) press(s, "press", t!.id); return `All destroyers, close on the ${t!.name} and launch everything.`;
    case "pincer": ss.forEach((s, i) => flank(s, i % 2 ? "right" : "left")); return `Destroyers, split round the ${t!.name}.`;
    case "hammer-anvil": ss.forEach((s, i) => (i === 0 ? press(s, "steady", t!.id) : flank(s, "rear"))); return `${ss[0].name} holds the ${t!.name}'s eye; the rest, round its stern.`;
    case "screen": for (const s of ss) { s.doctrine = "shield"; s.order = { k: "guard", target: boss?.id ?? 0 }; } return "Destroyers, form on the Sovereign. Shields to the enemy.";
    case "hunt": for (const s of ss) { s.doctrine = "steady"; s.focus = 0; } return "Captains, your choice of targets.";
    case "feint": {
      const decoy = nearestShip(w, t!.side, t!.x, t!.z, (o) => o.id !== t!.id) ?? t!;
      ss.forEach((s, i) => (i === 0 ? press(s, "press", decoy.id) : flank(s, "rear")));
      return `${ss[0].name} makes noise at the ${decoy.name}; the others slip round to the ${t!.name}.`;
    }
    case "recall":
      for (const s of ss) for (const g of wingsOf(w, s.id)) if (g.state === "out") { g.order = { k: "return" }; g.state = "returning"; }
      return "All wings, home to your decks.";
  }
}
