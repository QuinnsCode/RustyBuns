// The battles: who is where when the fleet drops out of hyperspace. Every battle is fought in a planet's gravity well,
// where stations and bases sit, with a hyperspace lane's mouth off to one side that the Rim's reinforcements come
// through. The quick battle is the assault on a Rim base; the Armada puts you a level up, on a dreadnought whose
// destroyers each run their own wings.
import type { Role } from "../names.ts";
import { addShip, addWing, emptyWorld, nextCall, rand, say, type Wave, type World } from "./world.ts";

/** What the fleet brings in from the campaign: the flagship's hull (0..1) and its wings' craft. */
export interface Fleet { hull: number; wings: { role: Role; craft: number }[] }

export const FULL_FLEET: Fleet = {
  hull: 1,
  wings: [
    { role: "interceptor", craft: 6 }, { role: "interceptor", craft: 6 },
    { role: "bomber", craft: 5 }, { role: "bomber", craft: 5 },
    { role: "escort", craft: 5 }, { role: "escort", craft: 5 },
  ],
};

export type BattleKind = "assault" | "seize" | "strike";

export interface BattleSpec {
  seed: number; kind: BattleKind;
  /** 1 a picket, 2 a base, 3 a fortress world. */
  strength: number;
  planet?: string;
  fleet?: Fleet;
  temper?: World["rimTemper"];
}

const TEMPERS: World["rimTemper"][] = ["zealot", "pragmatist", "cagey"];

/** A battle over a world. assault: a Rim base under a bastion; seize: a resource world with a picket; strike: a base
 *  still being built (no bastion yet, its base half done). */
export function battle(spec: BattleSpec): World {
  const w = emptyWorld(spec.seed);
  const fleet = spec.fleet ?? FULL_FLEET;
  w.rimTemper = spec.temper ?? TEMPERS[Math.floor(rand(w) * 3)];
  w.planet = { name: spec.planet ?? "Vael", x: 1400, z: 0, r: 420, base: 2600 * (spec.kind === "strike" ? 0.45 : spec.kind === "seize" ? 0.6 : 1) * (0.7 + spec.strength * 0.15), baseMax: 0 };
  w.planet.baseMax = w.planet.base;
  w.lane = { x: -150, z: 1250 };

  const fl = addShip(w, "navy", "destroyer", "Relentless", -1300, 0, 0, false);
  fl.hull = fl.hullMax * fleet.hull;
  w.flagship = fl.id;
  const fr = addShip(w, "navy", "frigate", "Warden", -1250, 320, 0, false);
  fr.order = { k: "hold" };
  fleet.wings.forEach((f, i) => { if (f.craft > 0) addWing(w, fl, f.role, nextCall(w, "navy"), f.craft, 1 + i * 1.5); });

  const st = spec.strength;
  if (spec.kind === "assault") {
    const bastion = addShip(w, "rim", "station", "Bastion of " + w.planet.name, 980, -380, Math.PI, true);
    addWing(w, bastion, "interceptor", nextCall(w, "rim"), 5, 3);
  }
  const cruiser = addShip(w, "rim", "cruiser", "Defiance", 720, 160, Math.PI, true);
  addWing(w, cruiser, "escort", nextCall(w, "rim"), 4, 6);
  if (st >= 2 || spec.kind !== "strike") {
    const carrier = addShip(w, "rim", "carrier", "Hearthfire", 1080, 480, Math.PI, true);
    addWing(w, carrier, "interceptor", nextCall(w, "rim"), 5, 5);
    addWing(w, carrier, "bomber", nextCall(w, "rim"), 4, 9);
    if (st >= 3) addWing(w, carrier, "bomber", nextCall(w, "rim"), 4, 14);
  }
  for (let i = 0; i < st; i++) {
    const c = addShip(w, "rim", "corvette", ["Free Wind", "Unbowed", "Kindred"][i], 600 + i * 40, -120 + i * 420, Math.PI, true);
    if (i === 0 && spec.kind !== "seize") addWing(w, c, "interceptor", nextCall(w, "rim"), 4, 8);
  }
  const waves: Wave[] = [{ at: 80, done: false, ships: [{ kind: "corvette", wings: ["interceptor"] }, { kind: "cruiser", wings: ["bomber"] }] }];
  if (st >= 2) waves.push({ at: 170, done: false, ships: [{ kind: "corvette", wings: ["escort"] }, { kind: "corvette", wings: [] }] });
  if (spec.kind === "seize") waves.length = 1;
  w.waves = waves;
  say(w, "navy", "Helm", `Out of hyperspace over ${w.planet.name}. The Rim is waiting.`);
  say(w, "navy", "Sensors", `A hyperspace lane opens to the south. Expect them to reinforce through it in ${waves[0].at} seconds.`);
  return w;
}

/** The quick battle: a full fleet against a Rim base. */
export const quick = (seed: number) => battle({ seed, kind: "assault", strength: 2 });

/** One level up: a dreadnought whose three destroyers are captained for you. You set each one's target and
 *  doctrine, they call plays for their own wings. */
export function armada(seed: number): World {
  const w = emptyWorld(seed, "armada");
  w.rimTemper = TEMPERS[Math.floor(rand(w) * 3)];
  w.planet = { name: "Corvanth", x: 1900, z: 0, r: 560, base: 6000, baseMax: 6000 };
  w.lane = { x: -200, z: 1700 };
  w.limit = 600;
  const sov = addShip(w, "navy", "dreadnought", "Sovereign", -1900, 0, 0, false);
  w.flagship = sov.id;
  addWing(w, sov, "interceptor", nextCall(w, "navy"), 6, 1);
  addWing(w, sov, "escort", nextCall(w, "navy"), 6, 2);
  const names = ["Relentless", "Vigil", "Austere"];
  names.forEach((n, i) => {
    const d = addShip(w, "navy", "destroyer", n, -1500, (i - 1) * 620, 0, true);
    d.boss = sov.id; d.doctrine = "steady";
    (["interceptor", "bomber", "escort"] as Role[]).forEach((r, j) => addWing(w, d, r, nextCall(w, "navy"), r === "bomber" ? 5 : 5, 3 + i + j * 1.5));
  });
  const fr = addShip(w, "navy", "frigate", "Warden", -1600, 900, 0, false);
  fr.order = { k: "hold" };

  const bastion = addShip(w, "rim", "station", "Bastion of Corvanth", 1400, -520, Math.PI, true);
  addWing(w, bastion, "interceptor", nextCall(w, "rim"), 5, 3);
  addWing(w, bastion, "escort", nextCall(w, "rim"), 5, 5);
  [[1050, 250], [1150, -150]].forEach(([x, z], i) => {
    const c = addShip(w, "rim", "cruiser", ["Defiance", "Stonebreak"][i], x, z, Math.PI, true);
    addWing(w, c, "escort", nextCall(w, "rim"), 4, 6 + i);
  });
  [[1500, 600], [1650, -700]].forEach(([x, z], i) => {
    const c = addShip(w, "rim", "carrier", ["Hearthfire", "Open Hand"][i], x, z, Math.PI, true);
    addWing(w, c, "interceptor", nextCall(w, "rim"), 5, 5 + i);
    addWing(w, c, "bomber", nextCall(w, "rim"), 4, 9 + i);
    addWing(w, c, "bomber", nextCall(w, "rim"), 4, 15 + i);
  });
  for (let i = 0; i < 4; i++) addShip(w, "rim", "corvette", ["Free Wind", "Unbowed", "Kindred", "Long Night"][i], 900 + (i % 2) * 80, -600 + i * 400, Math.PI, true);
  w.waves = [
    { at: 90, done: false, ships: [{ kind: "cruiser", wings: ["bomber"] }, { kind: "corvette", wings: ["interceptor"] }, { kind: "corvette", wings: [] }] },
    { at: 200, done: false, ships: [{ kind: "carrier", wings: ["bomber", "interceptor"] }, { kind: "corvette", wings: ["escort"] }] },
  ];
  say(w, "navy", "Fleet", "The Sovereign and her destroyers are out of hyperspace over Corvanth.");
  return w;
}
