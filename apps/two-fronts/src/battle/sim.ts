// The hero ground battle as a pure, fixed-step simulation: command posts and scenery laid out by
// the sector being fought over, AI troopers of four classes and the vehicles each side brought,
// a Wooka horde of five kinds that hunts in packs and comes round the flanks, the defender's
// turrets, orbital strikes and drop-pod reinforcements from the spec. Trunks, buildings, rock,
// stumps, logs and the Wooka's trenches block movement, and give cover to whoever is behind them.
// The fight has a rhythm: surges of Wooka pour out of the treeline in waves, between them the
// radio calls a dig-in (hold a post for a countdown and a drop or a strike is yours), and a post
// that is overrun gets a fall-back to the next one, or an evac point, with a short window.
// Artillery and gunship passes land across the whole field, not only on one side.
// Kill enough of the other side and your champion takes the field: Warbur for the Wooka, Gumpert
// for the Thunder Marines.
// The view draws it and feeds the hero's input; the tests run it headless with the autopilot.
import { radioFor } from "./lines.ts";
import RADIO_SCRIPT from "../../content/radio.json";
import { atan2, cos, hypot, sin } from "./fmath.ts";
import { VEHICLE_KINDS, other, poolSize, type BattleResult, type BattleSpec, type MatchMode, type PerSide, type SectorKind, type Side, type VehicleKind } from "./contract.ts";
import { clamp } from "@rustybuns/util";

export type Trooper = "assault" | "heavy" | "sniper" | "engineer";
export const TROOPERS: Trooper[] = ["assault", "heavy", "sniper", "engineer"];
export type UnitKind = Trooper | VehicleKind | "wooka" | "turret" | "hero" | "champion";
// The horde's five kinds. Chubs are big tribal brutes that lead the charge. Stickies throw spears
// and fall back. Fodder are the front line, and at least they are devout. Boomies run at you
// with a lit charge strapped on. Shanti are witch doctors who keep the rest going.
// A sixth, the Mossback, never comes with the usual mix: it walks out of a surge, rarely.
export type WookaRole = "fodder" | "chub" | "sticky" | "boomie" | "shanti" | "mossback";
export const ROLES: WookaRole[] = ["fodder", "chub", "sticky", "boomie", "shanti", "mossback"];
// Each side's champion, and Gumpert's three kits.
export type Champ = "warbur" | "gumpert";
export type Kit = "rockets" | "baton" | "jetpack";
export const KITS: Kit[] = ["rockets", "baton", "jetpack"];
export interface Unit {
  id: number; side: Side; kind: UnitKind; x: number; z: number; yaw: number; hp: number; maxHp: number; cool: number; jx: number; jz: number; guard?: boolean;
  target?: number; look?: number; // who it's shooting at, and when it next looks round for someone better
  detour?: number; detourT?: number; // the way round a wall it's taking, and for how much longer
  role?: WookaRole;   // a Wooka's kind
  pack?: number;      // a Wooka's pack: 0 goes up the middle, 1 and 2 round the flanks
  back?: number;      // seconds a Sticky keeps falling back after a throw
  stun?: number;      // seconds a unit stands dazed after Gumpert's baton
  champ?: Champ;      // the hero, or an AI champion, once their side has earned one
  kit?: Kit;          // Gumpert's kit
  toss?: number;      // seconds till Warbur can throw another Wooka
  jav?: number;       // seconds till Warbur can throw another spear
  hitBy?: number;     // who hit it last, for the hero's kill count
  wild?: boolean;     // came out of a surge: it costs its side no tickets, and counts for no kills
  wound?: number;     // a Mossback: seconds before it starts to heal again (a heavy hit sets it)
  leap?: number;      // a Mossback: seconds left in the leap it's making, towards lx, lz
  lx?: number; lz?: number;
  leapCd?: number;    // seconds till it can leap again
  hx?: number; hz?: number; // where the hero's last order sent it
}
export interface Post { name: string; x: number; z: number; owner: Side | null; progress: number } // progress: +1 attacker, -1 defender
// An orbital strike or an artillery shell on its way down. A shell has its own radius and punch.
export interface Strike { side: Side; x: number; z: number; t: number; r?: number; dmg?: number; shell?: boolean; by?: number }
// A gunship strafing run across the field, from x0, z0 to x1, z1 over dur seconds.
export interface Pass { side: Side; x0: number; z0: number; x1: number; z1: number; age: number; dur: number; hurtAt: number }
// The fall-back the radio has called: get to x, z before the window runs out.
export interface Fall { x: number; z: number; name: string; evac: boolean; left: number; from: number; ids: number[]; calm: number }
// The fight's rhythm. Surges come in waves; between them, a dig-in; and a post that's overrun gets a fall-back.
export interface Beat {
  surge: number;          // surges so far
  nextSurge: number;      // when the next one comes out of the treeline
  digAt: number;          // when the radio next calls a dig-in
  dig: { post: number; left: number; until: number } | null; // the post to hold, the seconds of holding still needed, and when the call lapses
  digs: number;           // dig-ins held so far (odd ones pay in a drop, even ones in a strike)
  overrun: number;        // seconds the worst post has been overrun
  fall: Fall | null;
  fallCd: number;         // not again before this
  out: number;            // falls that got out in time
  lost: number;           // falls that were left behind
  cost: number;           // tickets the falls have cost the hero's side
  arty: PerSide<number>;  // when each side's guns next fire
  nextPass: number;       // when the next gunship goes past
}
// Shots, spears and hexes fly; blasts go off; gore is something coming apart, in its side's
// colours (big: torn apart, or a vehicle going up); a toss is Warbur throwing a Wooka.
export interface Fx { kind: "shot" | "spear" | "hex" | "blast" | "gore" | "toss" | "smash"; x: number; z: number; tx: number; tz: number; t: number; y?: number; ty?: number; side?: Side; big?: boolean; from?: number; hit?: boolean; pin?: boolean }

// What the player does this step. Movement is relative to where the hero faces.
export interface Input { forward: number; right: number; yaw: number; fire: boolean; strike?: { x: number; z: number }; use?: boolean; order?: { kind: OrderKind; x: number; z: number } }

// The hero's orders to the squad round them: push forward to where the gun points, hold where you
// stand, fall back towards home, or pour fire on whatever is round where the gun points.
export type OrderKind = "forward" | "hold" | "back" | "focus";
export const ORDERS: OrderKind[] = ["forward", "hold", "back", "focus"];
export interface Order { kind: OrderKind; x: number; z: number; ids: number[]; at: number }
export const COMMAND = 60;         // squadmates this close to the hero hear an order
export const ORDER_FOR = 40;       // seconds an order lasts before they go back to fighting their own way
export const FOCUS_R = 14;         // focus fire: enemies this close to the spot are the targets
const BACK_BY = 35;                // fall back: this far towards home

// Heavy weapons left out on the field, in the open between the lines: walk over one to pick it
// up. Each fires till its ammo runs out, and never overheats. A rail lance goes through
// everyone on its line, a mortar lobs a shell where you aim, a repeater hoses heavy rounds.
export type Heavy = "lance" | "mortar" | "repeater";
export const HEAVIES: Heavy[] = ["lance", "mortar", "repeater"];
export const HEAVY: Record<Heavy, { range: number; cool: number; dmg: number; ammo: number; name: Record<"marines" | "wooka", string> }> = {
  lance: { range: 110, cool: 1.1, dmg: 150, ammo: 8, name: { marines: "rail lance", wooka: "thunder spear" } },
  mortar: { range: 70, cool: 1.5, dmg: 160, ammo: 6, name: { marines: "plasma mortar", wooka: "keg sling" } },
  repeater: { range: 70, cool: 0.1, dmg: 12, ammo: 120, name: { marines: "repeater", wooka: "rock-chucker" } },
};
export interface Cache { id: number; kind: Heavy; x: number; z: number; ready: number } // ready: when it's back after someone took it
export const CACHE_BACK = 60;      // seconds before a taken cache is restocked
const GRAB = 3;                    // metres from a cache to pick it up
const MORTAR_R = 7, LANCE_W = 1.4;

export interface Tree { x: number; z: number; r: number }
// A building, wall or rock: centred on x, z, w wide (along x), d deep (along z) and h high.
// Anything at eye height or more blocks sight; anything lower is a wall to crouch behind. The
// kind is only for the view: a sandbag wall unless it says otherwise.
export interface Block { x: number; z: number; w: number; d: number; h: number; kind?: "rock" | "stump" | "log" | "trench" | "hut" | "wreck" | "rubble" | "crate" | "console"; broken?: boolean }

export interface Battle {
  spec: BattleSpec;
  map: string;             // the layout's name
  half: number;            // the plain runs -half..half on x and z
  spawn: PerSide<{ x: number; z: number }>;
  trees: Tree[];           // trunks: nobody walks or shoots through them
  blocks: Block[];         // buildings, walls and rock, the same
  time: number;
  tickets: PerSide<number>;
  posts: Post[];
  units: Unit[];
  strikes: Strike[];
  strikesLeft: PerSide<number>;
  vehiclesLeft: PerSide<Record<VehicleKind, number>>;
  reinforced: PerSide<boolean>;
  // The hero: their blaster's heat (overheated: seconds till it fires again), how long they've
  // run straight ahead (past SPRINT_AFTER they sprint), and what they've killed.
  hero: { id: number | null; lives: number; respawn: number; inVehicle: number | null; heat: number; overheated: number; run: number; kills: number; streak: number; arm: { kind: Heavy; ammo: number } | null };
  fx: Fx[];
  events: string[]; // for the HUD feed, newest last
  eventAt: number[]; // when each was said, so lines that land on top of each other garble
  radio: { at: number; text: string }[]; // lines waiting their turn on the air
  passes: Pass[];
  beat: Beat;
  over: BattleResult | null;
  seed: number;
  nextId: number;
  aiStrikeAt: PerSide<number>;
  spawnAt: PerSide<number>;
  kills: PerSide<number>;    // what each side has killed of the other's, counted in tickets
  champ: PerSide<boolean>;   // whether each side has earned its champion yet
  screamAt: number;          // when a dying Thunder Marine last got a line in the feed
  mode: MatchMode;
  live: number;              // assault and hill: the one post in play
  phase: number;             // assault: seconds left holding the live post (0 while taking it); hill: till it moves on
  vip: number | null;        // escort: the attacker's champion, while they live
  order: Order | null;       // the hero's last order to their squad
  caches: Cache[];           // heavy weapons out on the field
}

export const DT = 1 / 30;
export const HALF = 180;           // the plain runs -HALF..HALF on x and z
export const TIME_LIMIT = 600;
// the usual plain's spawns; a bigger map's come from spawnsFor
export const SPAWN: PerSide<{ x: number; z: number }> = { attacker: { x: 0, z: 150 }, defender: { x: 10, z: -150 } };
// On a field of another size, each side comes in the same way from its own edge.
const spawnsFor = (half: number): PerSide<{ x: number; z: number }> => ({ attacker: { x: 0, z: half - 30 }, defender: { x: 10, z: -(half - 30) } });
export const POST_RADIUS = 12;
const HOLD_FOR = 40;               // assault: seconds to hold a post once taken before the next comes live
const HILL_EVERY = 75;             // hill: seconds before the live post moves on
const HILL_DRAIN = 3;              // hill: seconds per ticket the side off the hill loses
const HILL = { name: "No man's land", x: 5, z: 0 }; // the first hill, as far from one spawn as the other
const HOLDOUT_TIME = 300;
const ESCORT_NEAR = 18;            // escort: an AI champion walks only with a friend this close
const ESCORT_PACE = 3;             // and no faster than this, so the escort keeps up
// How long a battle runs before the clock decides it.
export const timeLimit = (spec: BattleSpec) => (spec.mode === "holdout" ? HOLDOUT_TIME : TIME_LIMIT);

// Each kind of sector is its own map. The last post is the defender's keep: it starts theirs,
// and their turrets ring it. `scenery` below lays out what stands on it; the view draws that.
export interface Layout { name: string; posts: { name: string; x: number; z: number }[]; half?: number }
export const LAYOUTS: Record<SectorKind, Layout> = {
  shield: { name: "Shield generator clearing", posts: [{ name: "Old stump", x: -60, z: 40 }, { name: "Fern hollow", x: 55, z: 5 }, { name: "Mossy ridge", x: -50, z: -40 }, { name: "Generator", x: 45, z: -80 }] },
  capital: { name: "Ruined capital", posts: [{ name: "Wrecked station", x: 65, z: 55 }, { name: "Market ruins", x: -50, z: 15 }, { name: "Toppled water tower", x: 60, z: -20 }, { name: "Burnt quarter", x: -60, z: -55 }, { name: "Shattered palace", x: 5, z: -95 }] },
  spaceport: { name: "Deep-space station", posts: [{ name: "Docking pads", x: -45, z: 35 }, { name: "Fuel depot", x: 55, z: 10 }, { name: "Hangar", x: -55, z: -30 }, { name: "Command deck", x: 50, z: -85 }] },
  cannon: { name: "Cannon battery", posts: [{ name: "Ammo depot", x: 60, z: 40 }, { name: "Spotter nest", x: -55, z: 5 }, { name: "Gun pit", x: 50, z: -30 }, { name: "Cannon", x: -35, z: -85 }] },
  canyon: { name: "Dust sea", posts: [{ name: "Well house", x: -25, z: 60 }, { name: "Farm ruins", x: 30, z: 15 }, { name: "Bone field", x: -30, z: -25 }, { name: "Wreck", x: 15, z: -85 }] },
  jungle: { name: "Glow jungle shrine", posts: [{ name: "Spore pool", x: 55, z: 50 }, { name: "Lantern bridge", x: -55, z: 5 }, { name: "Lantern tree", x: 50, z: -35 }, { name: "Glowing shrine", x: 0, z: -95 }] },
};
// The big fields: the same kinds of sector, half as wide again and more, with a post or two more
// to fight over. A spec names one with `map`; the war hands them out to the bigger battles.
export const BIG_MAPS: Record<string, Layout & { sector: SectorKind; half: number }> = {
  ridge: { sector: "shield", name: "Generator ridge", half: 175, posts: [{ name: "Fern hollow", x: -70, z: 70 }, { name: "Old stump", x: 45, z: 25 }, { name: "Relay mast", x: -50, z: -40 }, { name: "Generator", x: 30, z: -100 }] },
  outskirts: { sector: "capital", name: "Ruined outskirts", half: 175, posts: [{ name: "Burnt farm", x: 75, z: 80 }, { name: "Wrecked station", x: -40, z: 40 }, { name: "Market ruins", x: 50, z: -20 }, { name: "Shattered palace", x: -5, z: -100 }] },
  yards: { sector: "spaceport", name: "Docking ring", half: 250, posts: [{ name: "Cargo stacks", x: 60, z: 55 }, { name: "Docking pads", x: -40, z: 0 }, { name: "Command deck", x: 40, z: -90 }] },
  gorge: { sector: "canyon", name: "Deep gorge", half: 255, posts: [{ name: "Bone field", x: 25, z: 75 }, { name: "Well house", x: -25, z: 15 }, { name: "Wreck", x: 15, z: -95 }] },
  valley: { sector: "jungle", name: "Glow valley", half: 270, posts: [{ name: "Glow falls", x: -70, z: 75 }, { name: "Spore pool", x: 55, z: 35 }, { name: "Lantern bridge", x: -45, z: -25 }, { name: "Glowing shrine", x: 0, z: -105 }] },
};
export const layoutOf = (spec: Pick<BattleSpec, "sector" | "map">): Layout => {
  const big = spec.map ? BIG_MAPS[spec.map] : undefined;
  return big && big.sector === spec.sector ? big : LAYOUTS[spec.sector];
};
// The big maps there are for a kind of sector.
export const bigMapsFor = (sector: SectorKind) => Object.keys(BIG_MAPS).filter((k) => BIG_MAPS[k]!.sector === sector);
// The trees on each map: the redwood forest, a dense jungle of thinner trunks, none in the canyon or the ruined city.
const GROW = 2.25;                 // the plain grew from 240 to 360 across: this much more ground to fill
const REDWOODS = { n: Math.round(110 * GROW), r: [1.2, 3.4], gap: 5, clear: 26 } as const;
const BARE = { n: 0, r: [0, 0], gap: 0, clear: 0 } as const;
const WOODS: Record<SectorKind, { n: number; r: readonly [number, number]; gap: number; clear: number }> = {
  shield: REDWOODS,
  capital: BARE,
  spaceport: BARE,
  cannon: BARE, // a beach: palms are for show, the cover is dunes, rock and driftwood
  jungle: { n: Math.round(230 * GROW), r: [0.6, 1.6], gap: 2.5, clear: 18 },
  canyon: BARE,
};
export const EYE = 1.6;            // blocks this high or more block sight
const COVER = 2.5;                 // this close to an obstacle between you and the shooter, you're in cover
const LOOK_EVERY = 0.5;            // seconds between an AI unit picking its target
const REPAIR = 30;                 // hp a second an engineer puts back into a vehicle or turret
const DETOUR = 1.5;                // seconds an AI unit keeps going round a wall before trying straight on again
const GUNSHIP_ALT = 12;            // gunships fly over everything: nothing blocks them or their shots
export const STRIKE_RADIUS = 10;
const STRIKE_DELAY = 2.5;
const WAVE_EVERY = 8;              // seconds between reinforcement waves
const BLEED_EVERY = 4;             // seconds per ticket the side with fewer posts loses
const HERO_LIVES = 3;
const AGGRO = 35;                  // how far a Wooka will charge at someone it can smell
const FLAVOR_EVERY = 30;
export const CHAMP_AT = 70;        // tickets' worth of kills a side needs to earn its champion
const MOB = 3;                     // this many Wooka on one Thunder Marine and they tear them apart
const MAUL = 20;                   // hp a second a mob takes off whoever it's on, on top of the clubs
const HEAL = 6;                    // hp a second a Shanti puts back into each Wooka near it
const FLANK = 30;                  // how wide a flanking pack swings
const TOSS_EVERY = 3;
// The Mossback: huge, mangy, long in the arm. It runs on its knuckles, leaps the last few metres,
// swats troopers aside and walks through low cover. Light fire barely marks it, and it heals,
// slowly, unless something heavy hit it lately.
export const MOSS_LIGHT = 0.25;    // the share of a light hit (a rifle, a blaster) that gets through
export const MOSS_HEAL = 14;       // hp a second it mends when nothing heavy has hit it
export const MOSS_WOUND = 6;       // seconds a heavy hit keeps it from mending
const MOSS_HEAVY = 45;             // a single hit this big counts as heavy, whatever it came from
const LEAP_SPEED = 24, LEAP_MIN = 5, LEAP_MAX = 17, LEAP_EVERY = 7;
const SWAT = 4.5;                  // metres it throws a trooper aside
// The rhythm. Times are seconds into the battle; a hold-out comes faster.
const SURGE_FIRST = 20, SURGE_EVERY = 45, HOLDOUT_SURGE_EVERY = 34;
const DIG_AFTER = 22;              // seconds after a surge that the radio calls a dig-in
const DIG_FOR = 14;                // seconds of holding a post still needed
const DIG_DROP = 8;                // tickets (and troopers) a held dig-in drops in
const FALL_WINDOW = 20, EVAC_WINDOW = 14;
const FALL_OUT = 3, FALL_LOST = 16; // tickets a fall-back costs when you get out, and when you're left in place
const OVERRUN_FOR = 2.5;           // seconds a post must stay overrun before the radio calls it
const FALL_EVERY = 25;
const ARTY_EVERY = 16, PASS_EVERY = 42, SHELL_R = 6, SHELL_DMG = 70;
const PASS_FIRST = 30, PASS_FOR = 4.5, PASS_DMG = 24;
const JAV_EVERY = 2.4;             // Warbur's spears: big ones, thrown from afar
const JAV_DMG = 70;
const JAV_FAR = 16;                // past this he throws spears; inside it he throws his kin, then goes for the head
const PIN = 3;                     // seconds a spear holds someone to a trunk
const SPENT = 0.4;                 // a Wooka under this share of its health is too beat up to throw
// The hero's blaster heats with each shot and cools when it's quiet; full, it locks up a while.
export const HEAT_PER_SHOT = 0.12;
const COOL_RATE = 0.45;
export const OVERHEAT = 1.8;
export const SPRINT_AFTER = 0.8;   // seconds running straight ahead, not firing, before you sprint
export const SPRINT = 1.55;

// What the Thunder Marines' radio says about the Wooka. They are not cuddly. (content/radio.json)
export const FLAVOR: readonly string[] = RADIO_SCRIPT.shield;

// What a Thunder Marine says on the way out, when a mob gets them. The radio picks it all up.
const SCREAMS = [
  "It's in my armour! IT'S IN MY ARMOUR!",
  "Tell my mother I... no, it's eating the radio...",
  "They're so SOFT. Why are they so SOFT?",
  "My legs! Where are my... oh. Oh, there they are.",
  "I just wanted to pet one!",
  "Not the eyes, not the EYES, they're looking at me!",
  "Medic! MEDIC! Never mind, the medic's over there. Parts of him.",
  "They're under the floor! How is there a floor out here?!",
  "Sarge, they took the snorkel! I need the snorkel!",
  "It's humming. Why is it humming while it does that?",
  "I'm not dead. I'm just... resting. Facing the sky. With a Wooka on my chest.",
  "Tell the Sarge his bunker's fine. It's the Sarge that isn't.",
  "Look at the bones! No, behind you! No, don't turn aro--",
  "It's only a flesh wound! It's a LOT of flesh wounds!",
  "It nibbled my leg! It's nibbled the other leg! Sir, I'm shorter!",
  "I can see my house from here. That's a problem. I'm on a tree.",
  "I've got a bad feeling about this. Pass it on. No, don't turn it around, pass it ON!",
  "Cover me! I'm going in! I'm going in! I'm going in? I'm going in. They've taken the floor.",
  "Tell my wife I love her. Tell my other wife it was a joke. Tell the Wooka, put me DOWN.",
  "Roger that, I think I see the light. Oh. It's a campfire. They're roasting something. They're roasting ME.",
];
const NAMES = ["Pvt. Okafor", "Pvt. Brandt", "Cpl. Diaz", "Pvt. Hale", "Sgt. Moreau", "Pvt. Kowalski", "Pvt. Achebe", "L/Cpl. Finch", "Pvt. Nakamura", "Pvt. Rourke"];

export const STATS: Record<UnitKind, { hp: number; speed: number; range: number; cool: number; dmg: number; aim: number; cost: number }> = {
  assault: { hp: 100, speed: 5.5, range: 42, cool: 0.8, dmg: 7, aim: 0.7, cost: 1 },
  heavy: { hp: 140, speed: 4, range: 50, cool: 2.4, dmg: 20, aim: 0.65, cost: 1.5 }, // rockets: ARMOUR_BANE times as hard on armour
  sniper: { hp: 80, speed: 4.5, range: 90, cool: 2.5, dmg: 40, aim: 0.9, cost: 1.5 },
  engineer: { hp: 100, speed: 5, range: 30, cool: 1, dmg: 5, aim: 0.65, cost: 1 },  // mends vehicles and turrets
  // Small, fast, and only dangerous up close. Their clubs are built to maim, not to kill.
  wooka: { hp: 70, speed: 6.5, range: 2.6, cool: 0.8, dmg: 16, aim: 0.85, cost: 0.5 },
  tank: { hp: 600, speed: 7, range: 60, cool: 2.2, dmg: 45, aim: 0.8, cost: 5 },
  walker: { hp: 900, speed: 3.5, range: 70, cool: 3, dmg: 60, aim: 0.75, cost: 7 },
  speeder: { hp: 180, speed: 15, range: 35, cool: 0.35, dmg: 6, aim: 0.6, cost: 2 },
  gunship: { hp: 450, speed: 10, range: 65, cool: 1.6, dmg: 28, aim: 0.8, cost: 6 },
  turret: { hp: 350, speed: 0, range: 55, cool: 1.2, dmg: 10, aim: 0.75, cost: 0 },
  hero: { hp: 300, speed: 8, range: 55, cool: 0.3, dmg: 9, aim: 0.9, cost: 3 },
  champion: { hp: 800, speed: 8, range: 60, cool: 1.3, dmg: 55, aim: 0.9, cost: 6 }, // an AI side's champion: see CHAMP_STATS
};
// The Wooka, kind by kind. Chubs soak and smash, Stickies throw from range, Boomies hit once,
// very hard, and Shanti hex from the back.
export const ROLE_STATS: Record<WookaRole, (typeof STATS)[UnitKind]> = {
  fodder: STATS.wooka,
  chub: { hp: 220, speed: 5.2, range: 3.2, cool: 1.1, dmg: 34, aim: 0.85, cost: 1 },
  sticky: { hp: 55, speed: 7, range: 30, cool: 2.4, dmg: 24, aim: 0.6, cost: 0.6 },
  boomie: { hp: 45, speed: 9, range: 2.4, cool: 99, dmg: 0, aim: 1, cost: 0.6 },
  shanti: { hp: 60, speed: 5, range: 28, cool: 3, dmg: 14, aim: 0.7, cost: 0.8 },
  mossback: { hp: 900, speed: 7.5, range: 3.8, cool: 1.5, dmg: 48, aim: 0.9, cost: 4 },
};
// The mix a wave comes in. A Mossback is never in it: they only walk out of a surge.
export const ROLE_MIX: Record<WookaRole, number> = { fodder: 0.5, chub: 0.17, sticky: 0.15, boomie: 0.1, shanti: 0.08, mossback: 0 };
// The champions. Warbur is a silverback, half Wooka and half bear, who throws Wooka at people.
// Gumpert is the Thunder Marines' own, in whichever kit he's carrying.
export const CHAMP_STATS: Record<Champ | Kit, (typeof STATS)[UnitKind]> = {
  warbur: { hp: 1100, speed: 8.5, range: 3.8, cool: 0.7, dmg: 55, aim: 0.95, cost: 6 },
  gumpert: { hp: 800, speed: 8, range: 60, cool: 1.3, dmg: 55, aim: 0.9, cost: 6 },
  rockets: { hp: 800, speed: 8, range: 60, cool: 1.3, dmg: 55, aim: 0.9, cost: 6 },
  baton: { hp: 800, speed: 10, range: 4, cool: 0.55, dmg: 45, aim: 0.98, cost: 6 },
  jetpack: { hp: 800, speed: 13, range: 45, cool: 0.15, dmg: 12, aim: 0.85, cost: 6 },
};
// What a unit fights with: its champion's or its Wooka kind's numbers, else its kind's.
export const statsOf = (u: Pick<Unit, "kind" | "role" | "champ" | "kit">) =>
  u.champ ? CHAMP_STATS[u.champ === "gumpert" ? u.kit ?? "rockets" : u.champ] : u.role ? ROLE_STATS[u.role] : STATS[u.kind];
const melee = (u: Unit) => statsOf(u).range < 5;

// The big guns throw a blast this wide instead of hitting one target.
const SPLASH: Partial<Record<UnitKind | Champ | Kit, number>> = { tank: 4, walker: 5, gunship: 3, rockets: 5, warbur: 3 };
const splashOf = (u: Unit) => SPLASH[u.champ ? (u.champ === "gumpert" ? u.kit ?? "rockets" : u.champ) : u.kind];
const ARMOUR_BANE = 4;
// Each wave's Thunder Marines come in this mix of classes.
export const CLASS_MIX: Record<Trooper, number> = { assault: 0.5, heavy: 0.2, sniper: 0.15, engineer: 0.15 };
export const isVehicle = (k: UnitKind): k is VehicleKind => (VEHICLE_KINDS as UnitKind[]).includes(k);
const isTrooper = (k: UnitKind): k is Trooper => (TROOPERS as UnitKind[]).includes(k);
const armoured = (k: UnitKind) => isVehicle(k) || k === "turret";
// Gunships fly over everything, and so does Gumpert with the jetpack on, lower down.
const jets = (u: { champ?: Champ; kit?: Kit }) => u.champ === "gumpert" && u.kit === "jetpack";
export const flies = (u: { kind: UnitKind; champ?: Champ; kit?: Kit }) => u.kind === "gunship" || jets(u);
export const altitude = (u: { kind: UnitKind; champ?: Champ; kit?: Kit }) => (u.kind === "gunship" ? GUNSHIP_ALT : jets(u) ? 5 : 0);
const bodyOf = (u: Unit) => (u.kind === "tank" ? 2.5 : u.kind === "walker" ? 2.2 : u.kind === "speeder" ? 1.4 : u.champ === "warbur" ? 1.4 : u.role === "mossback" ? 1.5 : u.role === "chub" ? 0.9 : 0.6);

const rand = (b: Battle) => {
  let t = (b.seed = (b.seed + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => hypot(a.x - b.x, a.z - b.z);
// A line on the radio, with the time it was said.
function say(b: Battle, text: string) {
  b.events.push(text);
  b.eventAt.push(b.time);
}
// Lines the radio gets to a moment apart, one over the next when it's panicking.
const queue = (b: Battle, lines: string[], gap = 0.45) => lines.forEach((text, i) => b.radio.push({ at: b.time + i * gap, text }));
// yaw 0 faces -z, towards the defender's end of the plain, like a three.js camera.
export const facing = (yaw: number) => ({ x: -sin(yaw), z: -cos(yaw) });
export const yawTo = (from: { x: number; z: number }, to: { x: number; z: number }) => atan2(-(to.x - from.x), -(to.z - from.z));

export function startBattle(spec: BattleSpec): Battle {
  const pool = (s: Side) => Object.fromEntries(VEHICLE_KINDS.map((k) => [k, spec.vehicles[s][k] ?? 0])) as Record<VehicleKind, number>;
  const mode = spec.mode ?? "conquest";
  // The keep starts the defender's; in an assault or a hold-out, every post does. A hill starts nobody's.
  const theirs = (i: number, n: number) => mode === "assault" || mode === "holdout" || (mode !== "hill" && i === n - 1);
  const layout = layoutOf(spec), half = layout.half ?? HALF;
  const b: Battle = {
    spec, map: layout.name, half, spawn: spawnsFor(half), time: 0, trees: [], blocks: [],
    tickets: { ...spec.tickets },
    posts: [...(mode === "hill" ? [HILL] : []), ...layout.posts].map((p, i, all) => (theirs(i, all.length) ? { ...p, owner: "defender", progress: -1 } : { ...p, owner: null, progress: 0 })),
    units: [], strikes: [], fx: [], events: [], eventAt: [], radio: [], passes: [],
    beat: {
      surge: 0, nextSurge: SURGE_FIRST, digAt: SURGE_FIRST + DIG_AFTER, dig: null, digs: 0, overrun: 0, fall: null, fallCd: 0, out: 0, lost: 0, cost: 0,
      arty: { attacker: ARTY_EVERY * 0.7, defender: ARTY_EVERY }, nextPass: PASS_FIRST,
    },
    strikesLeft: { ...spec.strikes },
    vehiclesLeft: { attacker: pool("attacker"), defender: pool("defender") },
    reinforced: { attacker: false, defender: false },
    hero: { id: null, lives: HERO_LIVES, respawn: 0, inVehicle: null, heat: 0, overheated: 0, run: 0, kills: 0, streak: 0, arm: null },
    over: null, seed: spec.seed >>> 0, nextId: 1,
    aiStrikeAt: { attacker: 20, defender: 25 },
    spawnAt: { attacker: 0, defender: 0 },
    kills: { attacker: 0, defender: 0 }, champ: { attacker: false, defender: false }, screamAt: -99,
    mode, live: 0, phase: mode === "hill" ? HILL_EVERY : 0, vip: null, order: null, caches: [],
  };
  // The turrets ring the keep; in a hold-out, every post.
  for (const gen of mode === "holdout" ? b.posts : [b.posts.at(-1)!]) for (let i = 0; i < spec.turrets; i++) {
    const a = (i / Math.max(1, spec.turrets)) * Math.PI * 2 + 0.6;
    add(b, "defender", "turret", gen.x + cos(a) * 18, gen.z + sin(a) * 18);
  }
  scenery(b);
  // The woods: trees everywhere except on the posts, the spawns, the keep's ring and the scenery.
  caches(b);
  const w = WOODS[spec.sector], clear = [...b.posts, b.spawn.attacker, b.spawn.defender, ...b.caches], n = Math.round(w.n * Math.min(2, area(b)));
  for (let tries = 0; b.trees.length < n && tries < n * 20; tries++) {
    const t = { x: (rand(b) - 0.5) * b.half * 2, z: (rand(b) - 0.5) * b.half * 2, r: w.r[0] + rand(b) * (w.r[1] - w.r[0]) };
    if (clear.some((c) => dist(c, t) < w.clear) || b.trees.some((o) => dist(o, t) < o.r + t.r + w.gap) || b.blocks.some((k) => gap(k, t) < t.r + 3)) continue;
    b.trees.push(t);
  }
  spawnHero(b);
  // Escort: the attacker's champion takes the field from the start, and is the one to get through.
  // If the hero is attacking, that's them.
  if (mode === "escort") {
    champion(b, "attacker");
    const vip = b.units.find((u) => u.side === "attacker" && u.champ)!;
    vip.hp = vip.maxHp = Math.round(vip.maxHp * 1.5); // the whole other side is after them
    b.vip = vip.id;
  }
  if (mode !== "conquest") say(b, BRIEF[mode]);
  return b;
}

export const BRIEF: Record<MatchMode, string> = {
  conquest: "Conquest: take the posts and run their tickets out",
  assault: "Assault: the posts fall in order, one live at a time",
  hill: "King of the hill: hold the live post, and it moves on",
  holdout: "Hold-out: the waves keep coming till the clock runs out",
  escort: "Escort: get the champion to the keep",
};

// Whether a post can change hands: in an assault or on the hill, only the live one; in an escort, none.
export const inPlay = (b: Battle, i: number) =>
  b.mode === "conquest" || b.mode === "holdout" ? true : b.mode === "escort" ? false : i === b.live;
export const vipUnit = (b: Battle) => (b.vip === null ? null : b.units.find((u) => u.id === b.vip) ?? null);

// The nearest point on a block's footprint to p, and how far p is from it (0 inside).
const nearestOn = (k: Block, p: { x: number; z: number }) => ({ x: clamp(p.x, k.x - k.w / 2, k.x + k.w / 2), z: clamp(p.z, k.z - k.d / 2, k.z + k.d / 2) });
const gap = (k: Block, p: { x: number; z: number }) => dist(nearestOn(k, p), p);
// How much more ground than the usual field this one has, and how much further it runs.
// Where the cannon sector's sand meets the sea on its east side: the shallows run on to the field's edge, so no cover stands past it.
export const shoreX = (b: Battle) => b.half - 60;
const area = (b: Battle) => (b.half / HALF) ** 2;
const reach = (b: Battle) => b.half / HALF;

// What stands on each map: its landmark by the keep, buildings or rock that block sight, and
// low walls to fight from. Random pieces keep off the posts, the spawns, the turrets and the
// lane down the middle, so the scenery never walls a side in.
function scenery(b: Battle) {
  const keep = b.posts.at(-1)!, put = (x: number, z: number, w: number, d: number, h: number) => b.blocks.push({ x, z, w, d, h });
  const scatter = (n0: number, size: [number, number], h: [number, number], room: number, lane = 18) => {
    const n = Math.round(n0 * GROW * area(b));
    for (let placed = 0, tries = 0; placed < n && tries < n * 30; tries++) {
      const k = { x: (rand(b) - 0.5) * b.half * 1.9, z: (rand(b) - 0.5) * b.half * 1.9, w: size[0] + rand(b) * (size[1] - size[0]), d: size[0] + rand(b) * (size[1] - size[0]), h: h[0] + rand(b) * (h[1] - h[0]) };
      if (Math.abs(k.x) < lane + k.w / 2 || (b.spec.sector === "cannon" && k.x + k.w / 2 > shoreX(b) - 8)) continue;
      if (b.posts.some((p) => gap(k, p) < room) || [b.spawn.attacker, b.spawn.defender].some((p) => gap(k, p) < 14)) continue;
      if (b.units.some((u) => gap(k, u) < 4) || b.blocks.some((o) => dist(o, k) < Math.max(o.w, o.d) / 2 + Math.max(k.w, k.d) / 2 + 3)) continue;
      b.blocks.push(k);
      placed++;
    }
  };
  const walls = (n: number) => scatter(n, [1.2, 7], [1.1, 1.3], 4, 4); // low: cover, but you see over them
  // Things to hide behind in the woods: rocks low and high, stumps, and fallen logs.
  const cover = () => {
    const kinded = (from: number, kind: Block["kind"], logs = false) => b.blocks.slice(from).forEach((k) => {
      k.kind = kind;
      if (logs && rand(b) < 0.5) [k.w, k.d] = [k.d, k.w];
    });
    let at = b.blocks.length; scatter(14, [1.6, 3.2], [1.0, 1.4], 4, 4); kinded(at, "rock");
    at = b.blocks.length; scatter(6, [3, 5], [2.2, 3.6], 6, 8); kinded(at, "rock");
    at = b.blocks.length; scatter(14, [1.6, 2.2], [1.0, 1.3], 4, 4); kinded(at, "stump");
    at = b.blocks.length; for (let i = 0; i < 8; i++) scatter(1, [7, 10], [1.0, 1.1], 4, 4);
    b.blocks.slice(at).forEach((k) => { k.d = 1.3; }); kinded(at, "log", true);
  };
  // The city's cover: burnt-out cars (two metres by four) and heaps of fallen masonry, low and tall.
  const ruins = () => {
    let at = b.blocks.length; scatter(16, [4.4, 4.4], [1.1, 1.5], 4, 4);
    b.blocks.slice(at).forEach((k) => { k.kind = "wreck"; k.w = 4.4; k.d = 1.9; if (rand(b) < 0.5) [k.w, k.d] = [k.d, k.w]; });
    at = b.blocks.length; scatter(12, [2.4, 4], [1.0, 1.4], 4, 4); b.blocks.slice(at).forEach((k) => { k.kind = "rubble"; });
    at = b.blocks.length; scatter(6, [4, 6], [2.2, 3.4], 6, 8); b.blocks.slice(at).forEach((k) => { k.kind = "rubble"; });
  };
  // The Wooka dig in: trench lines across their half of the field, in short zigzag runs with gaps
  // to come through, kept off the posts and the spawns.
  const trenches = () => {
    const sides = (["attacker", "defender"] as Side[]).filter((s) => isHorde(b, s));
    for (const s of sides) for (const depth of [38, 72]) {
      const z0 = s === "attacker" ? depth : -depth;
      for (let x = -b.half + 6, i = 0; x < b.half - 6; x += 15, i++) {
        const k: Block = { x: x + 5, z: z0 + (i % 2 ? 2.5 : -2.5), w: 10, d: 1.4, h: 1.25, kind: "trench" };
        if ((b.spec.sector === "cannon" && k.x + k.w / 2 > shoreX(b) - 8) || b.posts.some((p) => gap(k, p) < POST_RADIUS + 2) || [b.spawn.attacker, b.spawn.defender].some((p) => gap(k, p) < 12)) continue;
        if (b.blocks.some((o) => Math.abs(o.x - k.x) < (o.w + k.w) / 2 + 1 && Math.abs(o.z - k.z) < (o.d + k.d) / 2 + 1)) continue;
        b.blocks.push(k);
      }
    }
  };
  if (b.spec.sector !== "canyon" && b.spec.sector !== "spaceport") trenches();
  switch (b.spec.sector) {
    case "shield":
      put(keep.x - 6, keep.z - 6, 7, 7, 9); // the generator's core
      walls(10);
      cover();
      break;
    case "capital":
      put(keep.x, keep.z - 18, 22, 10, 12); // the palace
      scatter(40, [6, 14], [6, 28], POST_RADIUS + 10); // the shattered high-rises
      walls(10);
      ruins();
      break;
    case "spaceport": {
      // A deep-space station: the command deck and its tower at the keep, bulkheads across the deck
      // with doorways a tank fits through, a bay round each pad, then crates and consoles to fight from.
      put(keep.x + 10, keep.z - 10, 5, 5, 22);
      put(keep.x, keep.z - 24, 26, 8, 9);
      const gaps = (z: number) => {
        const open: [number, number][] = [[(rand(b) - 0.5) * 30 - 10, 20], [(rand(b) - 0.5) * 30 + 10, 20]];
        for (const p of [...b.posts, b.spawn.attacker, b.spawn.defender]) if (Math.abs(p.z - z) < POST_RADIUS + 12) open.push([p.x, 2 * (POST_RADIUS + 6)]);
        const out: [number, number][] = [];
        for (const [c, w] of open.sort((a, d) => a[0] - d[0])) {
          const last = out.at(-1);
          if (last && c - w / 2 <= last[1]) last[1] = Math.max(last[1], c + w / 2); else out.push([c - w / 2, c + w / 2]);
        }
        return out;
      };
      for (let z = 66; z < b.half - 30; z += 66) for (const row of [z, -z]) {
        let x = -b.half;
        for (const [from, to] of [...gaps(row), [b.half, b.half] as [number, number]]) {
          if (from - x > 3) put((x + from) / 2, row, from - x, 1.6, 3.6);
          x = Math.max(x, to);
        }
      }
      for (const pad of [b.posts[0]!, b.posts[2]!]) {
        const out = pad.x < 0 ? 1 : -1; // the bay opens towards the middle of the deck
        put(pad.x - out * 17, pad.z, 1.6, 34, 5);
        for (const dz of [-15, 15]) put(pad.x - out * 10, pad.z + dz, 14, 1.6, 5);
      }
      const at = b.blocks.length;
      scatter(14, [3, 4], [2.5, 3.5], POST_RADIUS + 4);
      b.blocks.slice(at).forEach((k) => { k.kind = "crate"; });
      const consoles = b.blocks.length;
      scatter(10, [2, 4], [1.0, 1.2], POST_RADIUS + 3, 12);
      b.blocks.slice(consoles).forEach((k) => { k.kind = "console"; });
      walls(6);
      break;
    }
    case "cannon":
      put(keep.x - 12, keep.z - 28, 16, 16, 6); // the cannon's base
      walls(14);
      cover();
      break;
    case "canyon":
      // Rock walls down both sides, winding, then boulders and ore carts on the canyon floor.
      for (let z = -b.half; z < b.half; z += 16) {
        const l = (-62 + 14 * sin(z / 23)) * reach(b), r = (60 + 14 * sin(z / 31 + 1)) * reach(b);
        put((l - b.half) / 2, z + 8, l + b.half, 16, 30);
        put((r + b.half) / 2, z + 8, b.half - r, 16, 30);
      }
      put(keep.x + 12, keep.z - 16, 10, 6, 8); // the hauler wrecked half-buried by the keep
      b.blocks.at(-1)!.kind = "wreck";
      // Domed huts of a ruined moisture farm and more wrecks: blocks to fight round, drawn by the desert's landmark.
      for (const [n0, size, h, kind] of [[5, [6, 6], [1.8, 1.8], "hut"], [3, [9, 12], [2.4, 3.2], "wreck"]] as const) {
        const at = b.blocks.length;
        scatter(n0, [...size], [...h], POST_RADIUS + 6, 14);
        b.blocks.slice(at).forEach((k) => { k.kind = kind; });
      }
      scatter(14, [4, 9], [4, 10], POST_RADIUS + 6, 10);
      walls(10);
      break;
    case "jungle":
      put(keep.x, keep.z - 22, 20, 14, 12); // the temple
      scatter(6, [3, 6], [3, 6], POST_RADIUS + 6); // broken statues
      walls(16);
      cover();
      break;
  }
}

// How far along the line from a to c it first hits a trunk, or a block at eye height or more,
// as a fraction of the way (1 if nothing is in the way).
export function blocked(b: Battle, a: { x: number; z: number }, c: { x: number; z: number }) {
  const dx = c.x - a.x, dz = c.z - a.z;
  const lo = { x: Math.min(a.x, c.x), z: Math.min(a.z, c.z) }, hi = { x: Math.max(a.x, c.x), z: Math.max(a.z, c.z) };
  let first = 1;
  for (const t of b.trees) {
    if (t.x + t.r < lo.x || t.x - t.r > hi.x || t.z + t.r < lo.z || t.z - t.r > hi.z) continue;
    const fx = a.x - t.x, fz = a.z - t.z, A = dx * dx + dz * dz, B = 2 * (fx * dx + fz * dz), C = fx * fx + fz * fz - t.r * t.r;
    const disc = B * B - 4 * A * C;
    if (disc < 0 || A === 0) continue;
    const s = (-B - Math.sqrt(disc)) / (2 * A);
    if (s >= 0 && s < first) first = s;
  }
  for (const k of b.blocks) {
    if (k.h < EYE || k.x + k.w / 2 < lo.x || k.x - k.w / 2 > hi.x || k.z + k.d / 2 < lo.z || k.z - k.d / 2 > hi.z) continue;
    let t0 = 0, t1 = first;
    for (const [p, d, min, max] of [[a.x, dx, k.x - k.w / 2, k.x + k.w / 2], [a.z, dz, k.z - k.d / 2, k.z + k.d / 2]] as const) {
      if (Math.abs(d) < 1e-9) { if (p < min || p > max) t0 = Infinity; continue; }
      const u = (min - p) / d, v = (max - p) / d;
      t0 = Math.max(t0, Math.min(u, v)); t1 = Math.min(t1, Math.max(u, v));
    }
    if (t0 <= t1 && t0 < first) first = t0;
  }
  return first;
}

// Gunships see and are seen over everything.
export const sees = (b: Battle, a: Unit, c: Unit) => flies(a) || flies(c) || blocked(b, a, c) >= 1;

// In cover: an obstacle within arm's reach of the target, on the shooter's side of it.
export function inCover(b: Battle, from: Unit, t: Unit) {
  if (flies(from) || flies(t)) return false;
  const toward = (p: { x: number; z: number }) => (p.x - t.x) * (from.x - t.x) + (p.z - t.z) * (from.z - t.z) > 0;
  return b.trees.some((o) => dist(o, t) - o.r < COVER && toward(o)) || b.blocks.some((k) => !k.broken && gap(k, t) < COVER && toward(nearestOn(k, t)));
}

// Cover halves the odds of a hit from range. Nothing helps against a club at arm's length.
export const hitChance = (b: Battle, u: Unit, t: Unit) => {
  const s = statsOf(u);
  return clamp(s.aim - (dist(u, t) / s.range) * 0.35, 0.1, 0.95) * (!melee(u) && inCover(b, u, t) ? 0.5 : 1);
};

function add(b: Battle, side: Side, kind: UnitKind, x: number, z: number, role?: WookaRole): Unit {
  const s = role ? ROLE_STATS[role] : STATS[kind];
  const hp = kind === "hero" ? Math.round(STATS.hero.hp * (1 + 0.15 * (b.spec.heroLevel - 1))) : s.hp;
  const u: Unit = { id: b.nextId++, side, kind, x, z, yaw: side === "attacker" ? 0 : Math.PI, hp, maxHp: hp, cool: rand(b) * Math.min(3, s.cool), jx: (rand(b) - 0.5) * 16, jz: (rand(b) - 0.5) * 16, guard: (isTrooper(kind) || kind === "wooka") && role !== "boomie" && rand(b) < 1 / 3 };
  if (role) { u.role = role; u.pack = u.id % 3; }
  b.units.push(u);
  if (kind !== "turret") unstick(b, u);
  return u;
}

// Fresh troops come in at the spawn, or at a held post nearer the fight that isn't under attack.
function spawnPoint(b: Battle, side: Side) {
  const held = b.posts.filter((p) => p.owner === side && !b.units.some((u) => u.side !== side && u.kind !== "turret" && dist(u, p) < 30));
  const home = b.spawn[side], foe = b.spawn[other(side)];
  const p = held.sort((a, c) => dist(a, foe) - dist(c, foe))[0];
  const base = p && dist(p, foe) < dist(home, foe) ? { x: p.x, z: p.z + (side === "attacker" ? 8 : -8) } : home;
  return { x: base.x + (rand(b) - 0.5) * 12, z: base.z + (rand(b) - 0.5) * 6 };
}

function spawnHero(b: Battle) {
  const p = spawnPoint(b, b.spec.hero);
  const u = add(b, b.spec.hero, "hero", p.x, p.z);
  b.hero.id = u.id;
  // Earned your champion and came back? You come back as them.
  if (b.champ[b.spec.hero]) crown(b, u);
}

// Makes a unit its side's champion: Warbur for the Wooka, Gumpert for the Thunder Marines, at full health.
function crown(b: Battle, u: Unit) {
  u.champ = isHorde(b, u.side) ? "warbur" : "gumpert";
  if (u.champ === "gumpert") u.kit ??= "rockets";
  u.hp = u.maxHp = Math.round(statsOf(u).hp * (1 + 0.15 * (b.spec.heroLevel - 1)));
  u.toss = 0;
}

// Thunder Marines field troopers of four classes and the vehicles they brought. The Wooka field a
// horde: more of them, and no vehicles, so their share of the pool comes as yet more Wooka.
export const isHorde = (b: Battle, side: Side) => b.spec.factions[side] === "wooka";
const baseCap = (b: Battle, side: Side) =>
  isHorde(b, side) ? Math.min(24, 7 + b.spec.armies[side] * 4 + poolSize(b.spec.vehicles[side]) * 3) : Math.min(14, 4 + b.spec.armies[side] * 3);
// In a hold-out the attacker's waves start small and grow as the clock runs, to twice the usual by the end.
const troopCap = (b: Battle, side: Side) =>
  b.mode === "holdout" && side === "attacker" ? Math.min(32, Math.max(2, Math.round(baseCap(b, side) * (0.5 + (1.5 * b.time) / HOLDOUT_TIME)))) : baseCap(b, side);
// The Wooka kind the horde is furthest short of, against its mix.
function nextRole(b: Battle, side: Side): WookaRole {
  const n = { fodder: 0, chub: 0, sticky: 0, boomie: 0, shanti: 0, mossback: 0 };
  for (const u of b.units) if (u.side === side && u.role && !u.wild) n[u.role]++;
  const mix = ROLES.filter((k) => ROLE_MIX[k] > 0);
  const total = mix.reduce((t, k) => t + n[k], 0) + 1, short = (k: WookaRole) => ROLE_MIX[k] * total - n[k];
  return mix.reduce((best, k) => (short(k) > short(best) ? k : best));
}
// The class the side is furthest short of, against the mix.
function nextClass(b: Battle, side: Side): Trooper {
  const n = { assault: 0, heavy: 0, sniper: 0, engineer: 0 };
  for (const u of b.units) if (u.side === side && isTrooper(u.kind)) n[u.kind]++;
  const total = TROOPERS.reduce((t, k) => t + n[k], 0) + 1, short = (k: Trooper) => CLASS_MIX[k] * total - n[k];
  return TROOPERS.reduce((best, k) => (short(k) > short(best) ? k : best));
}
export const heroUnit = (b: Battle) => b.units.find((u) => u.id === b.hero.id) ?? null;
const heroVehicle = (b: Battle) => (b.hero.inVehicle === null ? null : b.units.find((u) => u.id === b.hero.inVehicle) ?? null);
const hidden = (b: Battle, v: Unit) => v.id === b.hero.id && b.hero.inVehicle !== null; // the hero, inside a vehicle

function nearestEnemy(b: Battle, u: { x: number; z: number; side: Side }, range: number) {
  let best: Unit | null = null, bd = range;
  for (const v of b.units) {
    if (v.side === u.side || v.hp <= 0 || hidden(b, v)) continue;
    const d = dist(u, v);
    if (d < bd) { bd = d; best = v; }
  }
  return best;
}

// The nearest enemy in range that the unit can see.
function nearestSeen(b: Battle, u: Unit, range: number) {
  const near = b.units.filter((v) => v.side !== u.side && v.hp > 0 && !hidden(b, v) && dist(u, v) < range).sort((a, c) => dist(u, a) - dist(u, c));
  return near.find((v) => sees(b, u, v)) ?? null;
}

// A spear that lands next to a trunk pins whoever it hit to it, and they can't move till they're free.
function pin(b: Battle, t: Unit) {
  if (t.hp <= 0 || armoured(t.kind) || flies(t) || !b.trees.some((tr) => dist(tr, t) < tr.r + 1.8)) return false;
  t.stun = PIN;
  return true;
}

// Warbur's spear: a big one, from a long way off.
function spear(b: Battle, u: Unit, t: Unit) {
  u.jav = JAV_EVERY;
  u.yaw = yawTo(u, t);
  const hit = rand(b) < hitChance(b, u, t);
  const pinned = hit && pin(b, t);
  b.fx.push({ kind: "spear", x: u.x, z: u.z, tx: t.x + (hit ? 0 : (rand(b) - 0.5) * 6), tz: t.z + (hit ? 0 : (rand(b) - 0.5) * 6), t: 0.5, big: true, from: u.id, hit, pin: pinned });
  if (!hit) return;
  damage(b, t, JAV_DMG, u.id);
  if (pinned && rand(b) < 0.4) b.events.push("Warbur pinned someone to a tree.");
}

// Warbur gets hold of a trooper and takes their head off.
function rip(b: Battle, u: Unit, t: Unit) {
  t.hp = 0;
  t.hitBy = u.id;
  b.fx.push({ kind: "gore", x: t.x, z: t.z, tx: t.x, tz: t.z, t: 1.5, side: t.side, big: true, y: 1.2 });
  if (rand(b) < 0.4) b.events.push("Warbur ripped a head clean off.");
}

function shoot(b: Battle, u: Unit, t: Unit | null, yaw = u.yaw) {
  const s = statsOf(u), kind: Fx["kind"] = u.role === "sticky" ? "spear" : u.role === "shanti" ? "hex" : "shot";
  u.cool = s.cool;
  if (!t) {
    // A shot at nothing stops at the first wall or trunk.
    const f = facing(yaw), end = { x: u.x + f.x * s.range, z: u.z + f.z * s.range };
    const k = flies(u) ? 1 : blocked(b, u, end);
    if (!melee(u)) b.fx.push({ kind, x: u.x, z: u.z, tx: u.x + (end.x - u.x) * k, tz: u.z + (end.z - u.z) * k, t: 0.08, y: altitude(u), from: u.id });
    else swing(b, u, yaw);
    return;
  }
  u.yaw = yawTo(u, t);
  const hit = rand(b) < hitChance(b, u, t);
  if (!melee(u)) b.fx.push({ kind, x: u.x, z: u.z, tx: t.x + (hit ? 0 : (rand(b) - 0.5) * 6), tz: t.z + (hit ? 0 : (rand(b) - 0.5) * 6), t: kind === "shot" ? 0.08 : 0.3, y: altitude(u), ty: altitude(t), from: u.id, hit });
  if (u.role === "sticky") u.back = 1.6; // throw, then get out of there
  if (!hit) return;
  if (u.champ === "warbur" && isTrooper(t.kind)) return rip(b, u, t);
  if (u.role === "sticky") pin(b, t);
  const splash = splashOf(u);
  if (splash) blast(b, u.side, t.x, t.z, splash, s.dmg, 0, u.id);
  else {
    const rocket = u.kind === "heavy" || u.kit === "rockets";
    damage(b, t, rocket && (armoured(t.kind) || t.role === "mossback") ? s.dmg * ARMOUR_BANE : s.dmg, u.id, rocket);
    if (u.role === "mossback") swat(b, u, t);
  }
  if (u.kit === "baton") t.stun = 2;
}

// A Mossback's backhand: the one it hit and whoever stands by them are thrown aside, hurt.
function swat(b: Battle, u: Unit, t: Unit) {
  shove(b, t, u, SWAT);
  for (const v of b.units) if (v !== t && v.side !== u.side && v.hp > 0 && !hidden(b, v) && !flies(v) && dist(v, t) < 3.5) {
    damage(b, v, statsOf(u).dmg * 0.6, u.id);
    shove(b, v, u, SWAT);
  }
}
// Throws v away from `from` by d metres, unless it's a vehicle or a turret, which don't budge.
function shove(b: Battle, v: Unit, from: { x: number; z: number }, d: number) {
  if (armoured(v.kind) || flies(v) || v.champ) return;
  const len = dist(v, from) || 1;
  v.x = clamp(v.x + ((v.x - from.x) / len) * d, -b.half, b.half);
  v.z = clamp(v.z + ((v.z - from.z) / len) * d, -b.half, b.half);
  unstick(b, v);
  v.stun = Math.max(v.stun ?? 0, 0.4);
}

// A melee swing at nothing in particular: whatever's just in front gets it.
function swing(b: Battle, u: Unit, yaw: number) {
  const s = statsOf(u), f = facing(yaw), at = { x: u.x + f.x * s.range * 0.6, z: u.z + f.z * s.range * 0.6 };
  const near = b.units.filter((v) => v.side !== u.side && v.hp > 0 && !hidden(b, v) && dist(v, at) < s.range * 0.8);
  for (const v of near.slice(0, u.champ || u.role === "mossback" ? 4 : 1)) {
    if (u.champ === "warbur" && isTrooper(v.kind)) { rip(b, u, v); continue; }
    damage(b, v, s.dmg, u.id);
    if (u.role === "mossback") shove(b, v, u, SWAT);
    if (u.kit === "baton") v.stun = 2;
  }
}

// Warbur picks up the nearest Wooka of his own and throws it: it lands where he's aiming, hard.
function toss(b: Battle, u: Unit, at: { x: number; z: number }, spent = true) {
  if ((u.toss ?? 0) > 0) return false;
  const ammo = b.units.filter((v) => v.side === u.side && v.hp > 0 && v.role && v.role !== "shanti" && v.role !== "mossback" && dist(v, u) < 6 && (spent || v.hp > v.maxHp * SPENT)).sort((a, c) => dist(u, a) - dist(u, c))[0];
  if (!ammo) return false;
  u.toss = TOSS_EVERY;
  const d = Math.min(35, dist(u, at)) || 1, x = clamp(u.x + ((at.x - u.x) / dist(u, at)) * d, -b.half, b.half), z = clamp(u.z + ((at.z - u.z) / dist(u, at)) * d, -b.half, b.half);
  b.fx.push({ kind: "toss", x: ammo.x, z: ammo.z, tx: x, tz: z, t: 0.6, side: u.side });
  ammo.x = x; ammo.z = z; unstick(b, ammo);
  ammo.hp -= 20; // it'll live. Probably.
  blast(b, u.side, x, z, 4, ammo.role === "boomie" ? 160 : 60, 0, u.id);
  if (ammo.role === "boomie") { ammo.hp = 0; ammo.back = -1; } // a thrown Boomie goes off where it lands
  if (rand(b) < 0.3) say(b, ammo.role === "boomie" ? "Warbur threw a Boomie. Of course he did." : "Warbur threw a Wooka. It got up again, delighted.");
  return true;
}

// A blast hurts the other side. A Boomie's hurts everyone, its own included, a bit less: it
// doesn't care, and neither do they.
function blast(b: Battle, side: Side, x: number, z: number, r: number, dmg: number, own = 0, from?: number) {
  b.fx.push({ kind: "blast", x, z, tx: x, tz: z, t: r > 6 ? 0.6 : 0.25, big: r > 6, from });
  for (const v of b.units) if (v.hp > 0 && dist(v, { x, z }) <= r && (v.side !== side || own)) damage(b, v, v.side === side ? dmg * own : dmg, from, true);
}

// A hit. A Mossback shrugs off light ones (a rifle, a blaster) for a quarter of the damage and
// mends between them; a heavy one (a rocket, a blast, a strike, a Boomie) lands in full and
// keeps it from mending for a few seconds.
export function damage(b: Battle, v: Unit, dmg: number, from?: number, heavy = false) {
  if (hidden(b, v)) return;
  if (v.role === "mossback") {
    if (heavy || dmg >= MOSS_HEAVY) v.wound = MOSS_WOUND;
    else dmg *= MOSS_LIGHT;
  }
  v.hp -= dmg;
  if (from !== undefined) v.hitBy = from;
}

// A Mossback mends, slowly, unless something heavy has hit it lately.
export function tend(u: Unit, dt = DT) {
  if (u.role !== "mossback" || u.hp <= 0) return;
  if ((u.wound ?? 0) > 0) { u.wound! -= dt; return; }
  u.hp = Math.min(u.maxHp, u.hp + MOSS_HEAL * dt);
}

// The side the player isn't on, and the player's own squadmates, think for themselves. Every so
// often each looks round for the nearest enemy it can see, and shoots at that till it's gone.
function think(b: Battle, u: Unit) {
  const s = statsOf(u);
  u.cool -= DT;
  tend(u);
  if (u.toss !== undefined) u.toss -= DT;
  if (u.stun && (u.stun -= DT) > 0) return; // dazed
  const o = ordered(b, u);
  if (!o && u.hx !== undefined) u.hx = u.hz = undefined;
  if ((u.look = (u.look ?? 0) - DT) <= 0) {
    u.look = LOOK_EVERY;
    u.target = (o?.kind === "focus" ? focusTarget(b, u, o, s.range) : undefined) ?? nearestSeen(b, u, s.range)?.id;
  }
  let foe = u.target === undefined ? null : b.units.find((v) => v.id === u.target && v.hp > 0 && !hidden(b, v)) ?? null;
  if (foe && dist(u, foe) > s.range) foe = null;
  if (u.role === "boomie") return boomie(b, u);
  if (u.role === "mossback") return mossback(b, u, foe);
  if (u.role === "shanti") mend(b, u);
  if (u.jav !== undefined) u.jav -= DT;
  if (u.champ === "warbur") {
    // Spears from afar, then his kin until they're too beat up to throw, then the head.
    const far = nearestSeen(b, u, 40), d = far ? dist(u, far) : 0;
    if (far && d > 6) {
      if (d <= JAV_FAR && toss(b, u, far, false)) { /* thrown */ }
      else if ((u.jav ?? 0) <= 0) spear(b, u, far);
    }
  }
  if (foe && u.cool <= 0) shoot(b, u, foe);
  if (!s.speed) return;
  if (u.id === b.vip) {
    // The escort's champion walks for the keep, fighting as they go, but never alone.
    const keep = b.posts.at(-1)!;
    if (b.units.some((v) => v.side === u.side && v.id !== u.id && v.kind !== "turret" && dist(u, v) < ESCORT_NEAR)) move(b, u, keep.x - u.x, keep.z - u.z, Math.min(s.speed, ESCORT_PACE));
    return;
  }
  // The hero's orders come before the radio's.
  if (o && u.hx !== undefined && u.hz !== undefined) {
    const spot = { x: u.hx, z: u.hz }, d = dist(u, spot);
    if (o.kind === "focus") {
      if (foe && dist(foe, o) < FOCUS_R) return; // on target: keep pouring it on
      if (d > s.range * 0.6) return move(b, u, spot.x - u.x, spot.z - u.z, s.speed);
    } else if (d > 3) return move(b, u, spot.x - u.x, spot.z - u.z, s.speed);
    else if (o.kind === "forward") u.hx = u.hz = undefined; // there: back to the fight, from further up
    else return; // holding
  }
  // The radio has called a fall-back: the hero's side near the overrun post makes for the new post.
  const fall = b.beat.fall;
  if (fall && u.side === b.spec.hero && u.kind !== "turret" && u.hp > 0 && dist(u, b.posts[fall.from]!) < 70) {
    if (dist(u, fall) < POST_RADIUS - 3) return;
    return move(b, u, fall.x - u.x + u.jx * 0.25, fall.z - u.z + u.jz * 0.25, s.speed);
  }
  // A Sticky that's thrown, or has someone too close, backs off towards home.
  if (u.role === "sticky") {
    const close = nearestEnemy(b, u, 8);
    if (u.back !== undefined && (u.back -= DT) <= 0) u.back = undefined;
    const from = close ?? (u.back !== undefined ? foe : null);
    if (from) return move(b, u, u.x - from.x, u.z - from.z, s.speed);
  }
  if (foe && dist(u, foe) < s.range * 0.6) return; // hold and shoot
  if (u.role && u.role !== "shanti" || u.champ === "warbur") {
    const prey = hunt(b, u);
    if (prey) return move(b, u, prey.x - u.x, prey.z - u.z, s.speed);
  }
  if (u.role === "shanti") {
    // Witch doctors keep behind their own front line.
    const front = b.units.filter((v) => v.side === u.side && (v.role === "fodder" || v.role === "chub")).sort((a, c) => dist(u, a) - dist(u, c))[0];
    if (front) {
      const home = b.spawn[u.side], d = dist(front, home) || 1;
      const x = front.x + ((home.x - front.x) / d) * 12, z = front.z + ((home.z - front.z) / d) * 12;
      return move(b, u, x - u.x, z - u.z, s.speed);
    }
  }
  if (u.kind === "engineer") {
    const fix = b.units.filter((v) => v.side === u.side && armoured(v.kind) && v.hp < v.maxHp && dist(u, v) < 40).sort((a, c) => dist(u, a) - dist(u, c))[0];
    if (fix && dist(u, fix) < 6) { fix.hp = Math.min(fix.maxHp, fix.hp + REPAIR * DT); return; }
    if (fix) return move(b, u, fix.x - u.x, fix.z - u.z, s.speed);
  }
  const goal = u.guard ? guardPost(b, u.side) ?? objective(b, u.side) : objective(b, u.side);
  let gx = goal.x + u.jx, gz = goal.z + u.jz;
  // The flanking packs swing wide of the straight line in, and close in once they're near.
  if (u.pack && dist(u, goal) > FLANK) {
    const d = dist(u, goal), side = u.pack === 1 ? 1 : -1;
    gx += (-(goal.z - u.z) / d) * FLANK * side;
    gz += ((goal.x - u.x) / d) * FLANK * side;
  }
  move(b, u, gx - u.x, gz - u.z, s.speed);
}

// The Wooka hunt in packs: they smell you through the trees, and when one of the pack is on
// someone, the rest of the pack comes to help.
function hunt(b: Battle, u: Unit) {
  const prey = nearestEnemy(b, u, AGGRO);
  if (prey) return prey;
  for (const v of b.units) {
    if (v.side !== u.side || v.pack !== u.pack || v === u || dist(u, v) > 25 || v.target === undefined) continue;
    const t = b.units.find((w) => w.id === v.target && w.hp > 0 && !hidden(b, w));
    if (t && dist(v, t) < 6) return t;
  }
  return null;
}

// The hero's order, if this unit heard it and it hasn't run out.
const ordered = (b: Battle, u: Unit) => (b.order && b.time - b.order.at < ORDER_FOR && b.order.ids.includes(u.id) ? b.order : null);
// Focus fire: the nearest enemy round the spot that the unit can see and reach.
function focusTarget(b: Battle, u: Unit, o: Order, range: number) {
  const near = b.units.filter((v) => v.side !== u.side && v.hp > 0 && !hidden(b, v) && dist(v, o) < FOCUS_R && dist(u, v) < range).sort((a, c) => dist(u, a) - dist(u, c));
  return near.find((v) => sees(b, u, v))?.id;
}

// What the squad shouts back.
const ORDER_SAID: Record<OrderKind, [string, string]> = {
  forward: ["Squad: FORWARD! Move up, move up!", "Chieftain points: everybody runs that way, shrieking"],
  hold: ["Squad: HOLD here! Dig in, nobody moves!", "Chieftain stamps: the kin sit down where they are"],
  back: ["Squad: FALL BACK! Pull back towards home!", "Chieftain waves them home: the kin scatter back into the green"],
  focus: ["Squad: focus fire, THERE! Everything you've got!", "Chieftain points his club: everybody throws at THAT"],
};

// The hero gives an order to everyone of theirs close enough to hear it. Forward and focus go
// where the gun points; fall back goes towards home; hold stays put.
export function command(b: Battle, hero: Unit, kind: OrderKind, at: { x: number; z: number }) {
  const squad = b.units.filter((u) => u.side === hero.side && u.hp > 0 && u.id !== hero.id && u.id !== b.vip && u.kind !== "turret" && u.role !== "boomie" && u.role !== "mossback" && dist(u, hero) < COMMAND);
  let x = clamp(at.x, -b.half, b.half), z = clamp(at.z, -b.half, b.half);
  if (kind === "back") {
    const home = b.spawn[hero.side], d = dist(hero, home) || 1, k = Math.min(BACK_BY, d) / d;
    x = hero.x + (home.x - hero.x) * k; z = hero.z + (home.z - hero.z) * k;
  }
  for (const u of squad) {
    if (kind === "hold") { u.hx = u.x; u.hz = u.z; }
    else { u.hx = clamp(x + u.jx * 0.5, -b.half, b.half); u.hz = clamp(z + u.jz * 0.5, -b.half, b.half); }
    u.look = 0; // look again, now
  }
  b.order = { kind, x, z, ids: squad.map((u) => u.id), at: b.time };
  say(b, `${ORDER_SAID[kind][isHorde(b, hero.side) ? 1 : 0]}${squad.length ? "" : " (nobody near enough to hear)"}`);
}

// The heavy weapons are left out between the lines, two on the flanks and one in the middle, so
// getting one means a run into the open. On a canyon floor they keep off the cliffs.
function caches(b: Battle) {
  const h = b.half, wide = b.spec.sector === "canyon" ? 0.3 : 0.7;
  const spots: [Heavy, number, number][] = [["lance", -wide * h, 0.1 * h], ["mortar", wide * h, -0.1 * h], ["repeater", -0.22 * h, -0.04 * h]];
  for (const [kind, x0, z0] of spots) {
    let at = { x: x0, z: z0 };
    for (let i = 0; i < 20 && (b.blocks.some((k) => gap(k, at) < 4) || b.posts.some((p) => dist(p, at) < POST_RADIUS + 4)); i++) at = { x: at.x * 0.9, z: at.z + 6 };
    b.caches.push({ id: b.caches.length, kind, x: at.x, z: at.z, ready: 0 });
  }
}

// The hero fires the heavy weapon they're carrying.
function fireHeavy(b: Battle, u: Unit, yaw: number) {
  const arm = b.hero.arm!, w = HEAVY[arm.kind], f = facing(yaw);
  u.cool = w.cool;
  if (arm.kind === "lance") {
    // Through everyone on the line, to the first wall or trunk.
    const end = { x: u.x + f.x * w.range, z: u.z + f.z * w.range }, k = blocked(b, u, end), len = w.range * k;
    b.fx.push({ kind: "shot", x: u.x, z: u.z, tx: u.x + f.x * len, tz: u.z + f.z * len, t: 0.12, from: u.id, hit: true, big: true });
    for (const v of b.units) {
      if (v.side === u.side || v.hp <= 0 || hidden(b, v)) continue;
      const along = (v.x - u.x) * f.x + (v.z - u.z) * f.z, off = Math.abs((v.x - u.x) * f.z - (v.z - u.z) * f.x);
      if (along > 0 && along < len && off < LANCE_W + bodyOf(v) * 0.5) damage(b, v, armoured(v.kind) ? w.dmg * 2 : w.dmg, u.id, true);
    }
  } else if (arm.kind === "mortar") {
    // Lobbed where you aim: at whoever's under the crosshair, or 40 m on.
    const t = aimTarget(b, u, yaw, w.range), d = t ? dist(u, t) : 40;
    const x = clamp(u.x + f.x * d, -b.half, b.half), z = clamp(u.z + f.z * d, -b.half, b.half);
    b.strikes.push({ side: u.side, x, z, t: 0.9, r: MORTAR_R, dmg: w.dmg, shell: true, by: u.id });
    b.fx.push({ kind: "shot", x: u.x, z: u.z, tx: x, tz: z, t: 0.08, from: u.id, big: true });
  } else {
    const t = aimTarget(b, u, yaw, w.range);
    if (!t) shoot(b, u, null, yaw);
    else {
      const hit = rand(b) < clamp(0.85 - (dist(u, t) / w.range) * 0.3, 0.2, 0.9) * (inCover(b, u, t) ? 0.6 : 1);
      b.fx.push({ kind: "shot", x: u.x, z: u.z, tx: t.x + (hit ? 0 : (rand(b) - 0.5) * 5), tz: t.z + (hit ? 0 : (rand(b) - 0.5) * 5), t: 0.08, from: u.id, hit, big: true });
      if (hit) damage(b, t, armoured(t.kind) ? w.dmg * 2 : w.dmg, u.id, true);
    }
    u.cool = w.cool;
  }
  if (--arm.ammo <= 0) { b.hero.arm = null; say(b, `The ${w.name[b.spec.factions[u.side]]} is empty`); }
}

// A Boomie runs at the thickest knot of the enemy it can smell and goes off in the middle of it.
function boomie(b: Battle, u: Unit) {
  const s = statsOf(u);
  const near = b.units.filter((v) => v.side !== u.side && v.hp > 0 && !hidden(b, v) && !flies(v) && dist(u, v) < 50);
  const knot = near.sort((a, c) => near.filter((v) => dist(v, c) < 6).length - near.filter((v) => dist(v, a) < 6).length || dist(u, a) - dist(u, c))[0];
  if (knot && dist(u, knot) < s.range) { u.hp = 0; return; } // goes off in the death pass
  if (knot) return move(b, u, knot.x - u.x, knot.z - u.z, s.speed);
  const goal = objective(b, u.side);
  move(b, u, goal.x - u.x, goal.z - u.z, s.speed);
}

// A Mossback goes on its knuckles at the nearest of the enemy it can smell, leaps the last few
// metres, comes down hard on whoever is under it, and swings at anything within reach.
function mossback(b: Battle, u: Unit, foe: Unit | null) {
  const s = statsOf(u);
  if (u.leap! > 0) {
    move(b, u, u.lx!, u.lz!, LEAP_SPEED, false);
    if ((u.leap! -= DT) <= 0) {
      u.leap = undefined;
      b.fx.push({ kind: "smash", x: u.x, z: u.z, tx: u.x, tz: u.z, t: 0.5, big: true });
      for (const v of b.units) if (v.side !== u.side && v.hp > 0 && !hidden(b, v) && !flies(v) && dist(v, u) < SWAT) {
        damage(b, v, s.dmg, u.id);
        shove(b, v, u, SWAT);
      }
    }
    return;
  }
  u.leapCd = Math.max(0, (u.leapCd ?? 0) - DT);
  if (foe && u.cool <= 0) shoot(b, u, foe);
  const prey = nearestEnemy(b, u, AGGRO + 15);
  if (!prey) {
    const goal = objective(b, u.side);
    return move(b, u, goal.x + u.jx - u.x, goal.z + u.jz - u.z, s.speed);
  }
  const d = dist(u, prey);
  if (u.leapCd <= 0 && d > LEAP_MIN && d < LEAP_MAX && !flies(prey) && blocked(b, u, prey) >= 1) {
    u.leap = Math.min(0.8, d / LEAP_SPEED);
    u.lx = prey.x - u.x; u.lz = prey.z - u.z;
    u.leapCd = LEAP_EVERY;
    return;
  }
  if (foe && d < s.range * 0.6) return; // in reach: swing
  move(b, u, prey.x - u.x, prey.z - u.z, s.speed);
}

// A Shanti's chant mends the Wooka round it.
function mend(b: Battle, u: Unit) {
  for (const v of b.units) if (v.side === u.side && (v.role || v.champ === "warbur") && v !== u && v.hp < v.maxHp && !(v.wound! > 0) && dist(u, v) < 10) v.hp = Math.min(v.maxHp, v.hp + HEAL * DT);
}

// The nearest post the side doesn't hold; with both held, the one nearer the enemy. In an assault
// or on the hill, the live post. In an escort, the champion: just ahead of them for the attacker.
export function objective(b: Battle, side: Side): { x: number; z: number } {
  if (b.mode === "assault" || b.mode === "hill") return b.posts[b.live]!;
  if (b.mode === "escort") {
    const keep = b.posts.at(-1)!, c = vipUnit(b);
    if (!c) return keep;
    if (side === "defender") return c;
    const d = Math.max(1, dist(c, keep)), ahead = Math.min(10, d);
    return { x: c.x + ((keep.x - c.x) / d) * ahead, z: c.z + ((keep.z - c.z) / d) * ahead };
  }
  const home = b.spawn[side], foe = b.spawn[other(side)];
  const open = b.posts.filter((p) => p.owner !== side || Math.abs(p.progress) < 1);
  if (open.length) return open.sort((a, c) => dist(a, home) - dist(c, home))[0]!;
  return [...b.posts].sort((a, c) => dist(a, foe) - dist(c, foe))[0]!;
}

// A third of each side holds the post nearest the enemy instead of pushing on.
function guardPost(b: Battle, side: Side) {
  if (b.mode === "escort") return side === "defender" ? b.posts.at(-1)! : undefined; // the defender's guards wait at the keep
  if (b.mode === "hill") return undefined; // nothing to hold but the hill
  const foe = b.spawn[other(side)];
  return b.posts.filter((p) => p.owner === side).sort((a, c) => dist(a, foe) - dist(c, foe))[0];
}

// The AI goes straight on if it can. If a wall stops it, it heads round one side (then the
// other) and keeps going that way a while, so it doesn't wobble back and forth along the wall.
// The player just slides.
function move(b: Battle, u: Unit, dx: number, dz: number, speed: number, steer = true) {
  if (u.stun && u.stun > 0) return;
  const len = hypot(dx, dz);
  if (len < 0.5) return;
  const step = Math.min(len, speed * DT), x = u.x, z = u.z;
  if (u.detourT !== undefined && (u.detourT -= DT) <= 0) u.detour = u.detourT = undefined;
  const turn = u.detour ?? (u.id % 2 ? 1.1 : -1.1);
  for (const a of !steer ? [0] : u.detour ? [turn, 0, -turn] : [0, turn, -turn]) {
    const c = cos(a), s = sin(a);
    u.x = clamp(x + ((dx * c - dz * s) / len) * step, -b.half, b.half);
    u.z = clamp(z + ((dx * s + dz * c) / len) * step, -b.half, b.half);
    unstick(b, u);
    if (hypot(u.x - x, u.z - z) > step * 0.3) {
      if (a && a !== u.detour) { u.detour = a; u.detourT = DETOUR; }
      break;
    }
  }
  if (u.kind !== "hero") u.yaw = atan2(-dx, -dz);
}

// Push a unit out of any trunk or block it's in. Gunships fly over them.
function unstick(b: Battle, u: Unit) {
  if (flies(u)) return;
  const body = bodyOf(u);
  for (const t of b.trees) {
    const ox = u.x - t.x, oz = u.z - t.z, d = hypot(ox, oz), min = t.r + body;
    if (d < min && d > 1e-6) { u.x = t.x + (ox / d) * min; u.z = t.z + (oz / d) * min; }
  }
  for (const k of b.blocks) {
    if (k.broken) continue;
    const l = k.x - k.w / 2 - body, r = k.x + k.w / 2 + body, n = k.z - k.d / 2 - body, f = k.z + k.d / 2 + body;
    if (u.x <= l || u.x >= r || u.z <= n || u.z >= f) continue;
    // A Mossback goes through low cover (a trench, a log, a stump, sandbags), and it's gone.
    if (u.role === "mossback" && k.h < EYE && k.kind !== "rock") {
      k.broken = true;
      b.fx.push({ kind: "smash", x: k.x, z: k.z, tx: k.x, tz: k.z, t: 0.5, side: u.side, from: u.id });
      continue;
    }
    // Out the nearest side, unless that's off the map.
    const outs = [[u.x - l, l, u.z], [r - u.x, r, u.z], [u.z - n, u.x, n], [f - u.z, u.x, f]].filter((o) => Math.abs(o[1]!) <= b.half && Math.abs(o[2]!) <= b.half);
    const out = outs.sort((a, c) => a[0]! - c[0]!)[0];
    if (out) { u.x = out[1]!; u.z = out[2]!; }
  }
  u.x = clamp(u.x, -b.half, b.half);
  u.z = clamp(u.z, -b.half, b.half);
}

// Aim assist: the nearest enemy in sight within a few degrees of where the hero is looking.
export function aimTarget(b: Battle, from: Unit, yaw: number, range: number) {
  let best: Unit | null = null, bd = range;
  for (const v of b.units) {
    if (v.side === from.side || v.hp <= 0) continue;
    const d = dist(from, v);
    if (d > bd) continue;
    let off = Math.abs(yawTo(from, v) - yaw) % (Math.PI * 2);
    if (off > Math.PI) off = Math.PI * 2 - off;
    if (off < Math.max(0.06, 2.5 / d) && sees(b, from, v)) { bd = d; best = v; }
  }
  return best;
}

function callStrike(b: Battle, side: Side, x: number, z: number) {
  if (b.strikesLeft[side] <= 0) return false;
  b.strikesLeft[side]--;
  b.strikes.push({ side, x: clamp(x, -b.half, b.half), z: clamp(z, -b.half, b.half), t: STRIKE_DELAY });
  say(b, `${side === b.spec.hero ? "Your" : "Enemy"} orbital strike inbound`);
  return true;
}

// The AI calls its strikes on whichever enemy crowd is thickest.
function aiStrike(b: Battle, side: Side) {
  if (b.time < b.aiStrikeAt[side] || b.strikesLeft[side] <= 0) return;
  b.aiStrikeAt[side] = b.time + 30;
  let best: Unit | null = null, most = 2;
  for (const u of b.units) if (u.side !== side && u.kind !== "turret") {
    const n = b.units.filter((v) => v.side === u.side && dist(u, v) < STRIKE_RADIUS).length;
    if (n > most) { most = n; best = u; }
  }
  if (best) callStrike(b, side, best.x, best.z);
}

// ============================================================================================
// The rhythm: surges, dig-ins and fall-backs, and the guns and gunships that go on across the
// whole field. All of it is the hero's side's radio; every mode has it, and a hold-out and an
// assault lean on it hardest.
// ============================================================================================
const SURGE_LINES = [
  "Contact, treeline! Here they come!",
  "The ferns just exhaled Wooka. Hundreds. Maybe forty. It feels like hundreds",
  "Movement everywhere. Everywhere. EVERYWHERE",
  "They're singing again, and there are a LOT of them",
  "Treeline's moving. Make every shot count",
  "Here they come. Nobody say 'what could possibly go wrong.' Okafor, I'm looking at you.",
  "That is not a forest, that is a very large crowd in a very small hat.",
  "They're coming in from the left, the right, the front, and one of them is coming in from a place called Under.",
  "Steady... steady... on my mark... Mark! Mark? Where did the Sergeant go? He's been marked.",
  "Hundreds of them. Hundreds. Maybe four. They run in circles, it feels like hundreds.",
  "Fix bayonets. Sir, we don't have bayonets. Then fix something, Private.",
  "Okay, who counted them? Moreau counted them. And? He stopped counting. That's it. That's the count.",
  "I love the smell of Wooka in the morning. It smells like a wet dog that's decided to be a dog.",
];
const HORDE_SURGE_LINES = [
  "The trees empty out. Our kin run, laughing", "Drums! The forest sends more!", "Out of the green, all together, shouting",
  "Hoo-HOO-hoo! Everybody, bonk! Bonk the shiny!", "Chief says 'attack'. Chief says it with his whole face", "Up the tree, down the tree, over the shiny one, bonk",
  "Look at the bones! Cheers for the bones! Bring more bones!", "Hoo hoo hoo HOO. Translation: yes, all of it",
];
const PANIC = [
  "BIG ONE, BIG ONE, BIG ONE",
  "That's not a Wooka, that's a landslide with arms!",
  "It's running on its HANDS--",
  "Say again, you're breaking up -- it just went through the trench!",
  "All units, Mossback! Rockets! Anybody with rockets!",
  "Don't shoot it, it LIKES it -- use the big stuff!",
  "It's moving like a -- oh no. Oh no no no",
  "Mossback! Repeat, MOSSBACK! No, I'm not joking, and don't call me Shirley!",
  "It's the size of a hut and it's eating the hut!",
  "That's no ordinary Wooka! That's the ordinary Wooka's mother!",
  "Aim for the legs! It's got four! It's got six! Stop counting, FIRE!",
  "Run away! RUN AWAY! ...Wait, which way is away?",
  "Somebody hand me the Holy Hand Grenade! It's a rocket, Private, but fine, close enough!",
];
const HORDE_PANIC = ["The drums go wild: the Mossback walks!", "Our big one is loose. Everybody get behind it", "Big one go! Big one go! Everybody point at the shiny ones!", "Our big one has seen the shiny ones. Our big one is not happy. Our big one is hungry"];
// How hard the rhythm hits in this mode.
const heat = (b: Battle) => (b.mode === "holdout" ? 1.5 : b.mode === "assault" ? 1.25 : 1);
// The posts the fighting is over: the live one in an assault or on the hill, all of them otherwise.
const fightPosts = (b: Battle) => b.posts.map((p, i) => ({ p, i })).filter(({ i }) => b.mode === "escort" || inPlay(b, i));
const isMine = (b: Battle, u: Unit) => u.side === b.spec.hero;

// Friends and foes round a post, weighted: a Mossback is worth four, a turret a friend.
function pressure(b: Battle, side: Side, p: { x: number; z: number }) {
  let e = 0, f = 0;
  for (const u of b.units) {
    if (u.hp <= 0 || flies(u) || hidden(b, u) || dist(u, p) > POST_RADIUS + 10) continue;
    if (u.side === side) f++;
    else if (u.kind !== "turret") e += u.role === "mossback" ? 4 : 1;
  }
  return { e, f, over: e >= 4 && e >= 2.2 * (f + 0.5) };
}

// A surge pours out of the treeline: clumps at the edge of the field, on the horde's side.
function surge(b: Battle) {
  const beat = b.beat;
  beat.surge++;
  beat.nextSurge = b.time + (b.mode === "holdout" ? HOLDOUT_SURGE_EVERY : SURGE_EVERY);
  beat.digAt = b.time + DIG_AFTER;
  const sides = (["attacker", "defender"] as Side[]).filter((s) => isHorde(b, s) && b.tickets[s] > 0);
  if (!sides.length) return;
  const mine = isHorde(b, b.spec.hero);
  say(b, `Surge ${beat.surge}: ${(mine ? HORDE_SURGE_LINES : SURGE_LINES)[Math.floor(rand(b) * (mine ? HORDE_SURGE_LINES : SURGE_LINES).length)]}`);
  for (const s of sides) {
    const n = Math.min(b.mode === "holdout" ? 32 : 26, Math.round((5 + 1.8 * beat.surge) * heat(b)));
    // The treeline is the side edges of the field, or the far end where rock closes the sides in (the canyon).
    const open = (c: { x: number; z: number }) => !b.blocks.some((k) => !k.broken && gap(k, c) < 6) && !b.trees.some((t) => dist(t, c) < t.r + 3);
    const centre = () => {
      for (let tries = 0; tries < 12; tries++) {
        const c = tries < 6 ? { x: (rand(b) < 0.5 ? -1 : 1) * (b.half - 4), z: (s === "attacker" ? 1 : -1) * (25 + rand(b) * 85) * reach(b) } : { x: (rand(b) - 0.5) * 70 * reach(b), z: (s === "attacker" ? 1 : -1) * (b.half - 6) };
        if (open(c)) return c;
      }
      return spawnPoint(b, s);
    };
    const centres = [centre(), centre()];
    const roll = () => { let r = rand(b), acc = 0; for (const k of ROLES) { acc += ROLE_MIX[k]; if (r < acc) return k; } return "fodder" as WookaRole; };
    for (let i = 0; i < n; i++) {
      const c = centres[i % 2]!, u = add(b, s, "wooka", c.x + (rand(b) - 0.5) * 10, c.z + (rand(b) - 0.5) * 14, roll());
      u.wild = true;
    }
    // Rarely, and only once the fight has been going a while, something much bigger comes out with them.
    const big = b.units.filter((u) => u.side === s && u.role === "mossback").length;
    if (beat.surge >= (b.mode === "holdout" ? 2 : 3) && big < (beat.surge >= 6 ? 2 : 1) && rand(b) < (b.mode === "holdout" ? 0.5 : 0.33)) {
      const c = centres[0]!, m = add(b, s, "wooka", c.x, c.z, "mossback");
      m.wild = true;
      const lines = mine ? HORDE_PANIC : pick3(b);
      queue(b, lines, 0.4);
    }
  }
}
// Three of the radio's panicked lines, the first always the same.
function pick3(b: Battle) {
  const rest = PANIC.slice(1), a = Math.floor(rand(b) * rest.length), c = (a + 1 + Math.floor(rand(b) * (rest.length - 1))) % rest.length;
  return [PANIC[0]!, rest[a]!, rest[c]!];
}

// A side's guns lay a salvo on the other's thickest crowd, or on the ground behind it.
function volley(b: Battle, s: Side) {
  const foe = other(s);
  b.beat.arty[s] = b.time + (ARTY_EVERY * (0.7 + rand(b) * 0.8)) / (heat(b) > 1 ? 1.25 : 1);
  if (b.tickets[s] <= 0 || !b.units.some((u) => u.side === s && u.kind !== "turret")) return;
  let best: Unit | null = null, most = 1;
  for (const u of b.units) if (u.side === foe && u.kind !== "turret" && !flies(u)) {
    const n = b.units.filter((v) => v.side === foe && dist(u, v) < 12).length;
    if (n > most) { most = n; best = u; }
  }
  const aim = best ?? { x: (rand(b) - 0.5) * b.half * 1.6, z: (foe === "defender" ? -1 : 1) * (15 + rand(b) * 95) * reach(b) };
  for (let i = 0; i < 3 + (heat(b) > 1 ? 1 : 0); i++) {
    b.strikes.push({ side: s, x: clamp(aim.x + (rand(b) - 0.5) * 24, -b.half, b.half), z: clamp(aim.z + (rand(b) - 0.5) * 24, -b.half, b.half), t: 2 + i * 0.35, r: SHELL_R, dmg: SHELL_DMG, shell: true });
  }
  if (rand(b) < 0.3) say(b, s === b.spec.hero ? "Our guns are walking it in" : "Incoming! Shelling on the line!");
}

// A gunship goes past, low, firing: from one edge of the field to the other through the enemy.
function airPass(b: Battle) {
  b.beat.nextPass = b.time + PASS_EVERY * (0.8 + rand(b) * 0.5);
  const air = (["attacker", "defender"] as Side[]).filter((s) => !isHorde(b, s) && b.tickets[s] > 0);
  if (!air.length) return;
  const side = air[Math.floor(rand(b) * air.length)]!, foe = other(side);
  const crowd = b.units.filter((u) => u.side === foe && u.kind !== "turret");
  const z = crowd.length ? crowd[Math.floor(rand(b) * crowd.length)]!.z : (foe === "defender" ? -50 : 50) * reach(b);
  const dir = rand(b) < 0.5 ? 1 : -1;
  b.passes.push({ side, x0: -dir * (b.half + 15), z0: z, x1: dir * (b.half + 15), z1: clamp(z + (rand(b) - 0.5) * 30, -b.half, b.half), age: 0, dur: PASS_FOR, hurtAt: 0 });
  say(b, side === b.spec.hero ? "Gunship on a run: keep your heads up, we're keeping theirs down" : "Gunship! Gunship! Get under something!");
}
function flyPasses(b: Battle) {
  for (const p of b.passes) {
    p.age += DT;
    if (p.age < p.hurtAt) continue;
    p.hurtAt = p.age + 0.4;
    const k = clamp(p.age / p.dur, 0, 1), x = p.x0 + (p.x1 - p.x0) * k, z = p.z0 + (p.z1 - p.z0) * k;
    b.fx.push({ kind: "blast", x, z, tx: x, tz: z, t: 0.2, from: undefined });
    for (const v of b.units) if (v.side !== p.side && v.hp > 0 && !flies(v) && !hidden(b, v) && dist(v, { x, z }) < 6) damage(b, v, PASS_DMG, undefined, true);
  }
  b.passes = b.passes.filter((p) => p.age < p.dur);
}

// The radio calls a dig-in at the post the side holds nearest the enemy. Holding none, there is nothing to dig in at yet.
function digIn(b: Battle) {
  const side = b.spec.hero, posts = fightPosts(b), foe = b.spawn[other(side)];
  const mine = posts.filter(({ p }) => p.owner === side).sort((a, c) => dist(a.p, foe) - dist(c.p, foe));
  const at = mine[0];
  if (!at) { b.beat.digAt = b.time + 8; return; }
  b.beat.dig = { post: at.i, left: DIG_FOR, until: b.beat.nextSurge + 10 };
  b.beat.digAt = Infinity;
  say(b, `Dig in at ${at.p.name}: hold it ${DIG_FOR}s for ${b.beat.digs % 2 ? "an orbital strike" : "a drop"}`);
}

function callFall(b: Battle, from: number) {
  const side = b.spec.hero, beat = b.beat, post = b.posts[from]!, home = b.spawn[side];
  const next = fightPosts(b).filter(({ p, i }) => i !== from && dist(p, post) > 20 && !pressure(b, side, p).over).sort((a, c) => dist(a.p, home) - dist(c.p, home))[0];
  const evac = !next;
  const dest = next ? { x: next.p.x, z: next.p.z, name: next.p.name } : { x: home.x, z: home.z + (side === "attacker" ? -12 : 12), name: "the evac point" };
  const window = evac ? EVAC_WINDOW : FALL_WINDOW;
  const ids = b.units.filter((u) => isMine(b, u) && u.kind !== "turret" && u.hp > 0 && dist(u, post) < 60).map((u) => u.id);
  if (beat.dig) { beat.dig = null; beat.digAt = Infinity; }
  beat.fall = { ...dest, evac, left: window, from, ids, calm: 0 };
  queue(b, [`${post.name} is overrun! FALL BACK to ${dest.name}, ${window} seconds!`, "Everybody out, NOW. Leave the heavy stuff!"], 0.5);
}

function rhythm(b: Battle) {
  const beat = b.beat, side = b.spec.hero;
  // The radio gets its queued lines out.
  if (b.radio.length) {
    for (const r of b.radio) if (r.at <= b.time) say(b, r.text);
    b.radio = b.radio.filter((r) => r.at > b.time);
  }
  if (b.time >= beat.nextSurge) surge(b);
  for (const s of ["attacker", "defender"] as Side[]) if (b.time >= beat.arty[s]) volley(b, s);
  if (b.time >= beat.nextPass) airPass(b);
  flyPasses(b);
  if (b.tickets[side] <= 0) return;

  // A dig-in: hold the post for the countdown, and a drop or a strike is yours.
  if (!beat.dig && !beat.fall && b.time >= beat.digAt) digIn(b);
  if (beat.dig) {
    const post = b.posts[beat.dig.post]!, p = pressure(b, side, post);
    if (p.f >= 2 && !p.over && (beat.dig.left -= DT) <= 0) {
      beat.digs++;
      beat.dig = null;
      if (beat.digs % 2) {
        const n = Math.round(DIG_DROP * heat(b));
        b.tickets[side] += n;
        for (let i = 0; i < 3; i++) {
          const x = post.x + (rand(b) - 0.5) * 8, z = post.z + (rand(b) - 0.5) * 8;
          if (isHorde(b, side)) add(b, side, "wooka", x, z, nextRole(b, side)); else add(b, side, nextClass(b, side), x, z);
        }
        say(b, `${post.name} held: a drop comes down, +${n} tickets`);
      } else {
        b.strikesLeft[side]++;
        say(b, `${post.name} held: an orbital strike is yours`);
      }
    } else if (b.time > beat.dig.until) {
      beat.dig = null;
      say(b, "Dig-in lapsed");
    }
  }

  // A post that's overrun: the enemy well past your side's round it, for a few seconds running.
  const watched = fightPosts(b).filter(({ p, i }) => p.owner === side || i === beat.dig?.post);
  const worst = watched.find(({ p }) => pressure(b, side, p).over);
  beat.overrun = worst ? beat.overrun + DT : 0;
  if (!beat.fall && worst && beat.overrun >= OVERRUN_FOR && b.time >= beat.fallCd) callFall(b, worst.i);

  const fall = beat.fall;
  if (!fall) return;
  fall.left -= DT;
  // Out in time: the hero, if they were on the post, or half the squad that was there, are at the new post. Fresh drops don't count.
  const squad = b.units.filter((u) => fall.ids.includes(u.id) && u.hp > 0 && dist(u, fall) < POST_RADIUS);
  const heroIn = fall.ids.includes(b.hero.id ?? -1) && squad.some((u) => u.id === b.hero.id);
  const made = fall.left < (fall.evac ? EVAC_WINDOW : FALL_WINDOW) - 1.5 && (!fall.ids.length || heroIn || squad.length >= Math.ceil(fall.ids.length / 2));
  fall.calm = pressure(b, side, b.posts[fall.from]!).over ? 0 : fall.calm + DT;
  const done = (cost: number, line: string) => {
    b.tickets[side] -= cost;
    beat.cost += cost;
    beat.fall = null;
    beat.fallCd = b.time + FALL_EVERY;
    beat.overrun = 0;
    say(b, line);
  };
  if (made) { beat.out++; done(Math.round(FALL_OUT * heat(b)), `Out in time: ${fall.name} holds the line (-${Math.round(FALL_OUT * heat(b))} tickets)`); }
  else if (fall.calm >= 3) { beat.fall = null; beat.fallCd = b.time + FALL_EVERY; say(b, `${b.posts[fall.from]!.name} is holding after all: stand down`); }
  else if (fall.left <= 0) { beat.lost++; done(Math.round(FALL_LOST * heat(b)), `Left behind: ${b.posts[fall.from]!.name} is lost (-${Math.round(FALL_LOST * heat(b))} tickets)`); }
}

export function step(b: Battle, input: Input | null) {
  if (b.over) return;
  b.time += DT;
  const sides: Side[] = ["attacker", "defender"];
  const hero = heroUnit(b), ride = heroVehicle(b);

  // The player's hero, or the vehicle they're driving.
  if (hero && input) {
    const body = ride ?? hero, s = statsOf(body);
    const f = facing(input.yaw), r = { x: -f.z, z: f.x };
    const fwd = clamp(input.forward, -1, 1), rt = clamp(input.right, -1, 1);
    // Run straight ahead without firing and you break into a sprint.
    b.hero.run = !ride && fwd > 0 && !rt && !input.fire ? b.hero.run + DT : 0;
    const sprint = b.hero.run > SPRINT_AFTER ? SPRINT : 1;
    move(b, body, f.x * fwd + r.x * rt, f.z * fwd + r.z * rt, s.speed * sprint * Math.min(1, hypot(fwd, rt)), false);
    body.yaw = input.yaw;
    body.cool -= DT;
    // The blaster heats as it fires and cools when it's quiet. Run it dry and it locks up.
    // Vehicles, and the champions' heavier kit, don't overheat.
    const blaster = !ride && !melee(body) && body.kit !== "rockets";
    if (b.hero.overheated > 0 && (b.hero.overheated -= DT) <= 0) b.hero.heat = 0.4;
    else b.hero.heat = Math.max(0, b.hero.heat - COOL_RATE * DT * (input.fire ? 0.3 : 1));
    if (input.fire && body.cool <= 0 && b.hero.arm && !ride) fireHeavy(b, body, input.yaw);
    else if (input.fire && body.cool <= 0 && b.hero.overheated <= 0) {
      shoot(b, body, aimTarget(b, body, input.yaw, s.range), input.yaw);
      if (blaster && (b.hero.heat += HEAT_PER_SHOT) >= 1) { b.hero.heat = 1; b.hero.overheated = OVERHEAT; }
    }
    // Walk over a heavy weapon to pick it up.
    if (!ride) for (const c of b.caches) if (c.ready <= b.time && dist(c, hero) < GRAB) {
      c.ready = b.time + CACHE_BACK;
      b.hero.arm = { kind: c.kind, ammo: HEAVY[c.kind].ammo };
      say(b, `Picked up a ${HEAVY[c.kind].name[b.spec.factions[hero.side]]}: ${HEAVY[c.kind].ammo} shots`);
    }
    if (input.order) command(b, hero, input.order.kind, input.order);
    if (input.strike) callStrike(b, hero.side, input.strike.x, input.strike.z);
    if (hero.toss !== undefined) hero.toss -= DT;
    if (hero.stun) hero.stun -= DT;
    // As a champion, E is Warbur's throw or Gumpert's change of kit; otherwise it's a vehicle.
    if (input.use && hero.champ === "warbur") {
      const f = facing(input.yaw);
      if (!toss(b, hero, { x: hero.x + f.x * 25, z: hero.z + f.z * 25 })) say(b, "No Wooka near enough to throw");
    } else if (input.use && hero.champ === "gumpert") {
      hero.kit = KITS[(KITS.indexOf(hero.kit ?? "rockets") + 1) % KITS.length]!;
      hero.cool = 0.3;
      unstick(b, hero);
      say(b, hero.kit === "baton" ? "Gumpert: stun baton. Up close and personal." : hero.kit === "jetpack" ? "Gumpert: jetpack. Up and over." : "Gumpert: rocket launcher. Everything goes boom.");
    } else if (input.use) {
      if (ride) { b.hero.inVehicle = null; hero.x = ride.x + 3; hero.z = ride.z; unstick(b, hero); say(b, `Out of the ${ride.kind}`); }
      else {
        const v = b.units.find((v) => isVehicle(v.kind) && v.side === hero.side && v.hp > 0 && dist(v, hero) < 7);
        if (v) { b.hero.inVehicle = v.id; say(b, `In the ${v.kind}`); }
      }
    }
    if (ride && b.hero.inVehicle === ride.id) { hero.x = ride.x; hero.z = ride.z; }
  }
  for (const u of b.units) {
    if (u.hp <= 0) continue;
    if (input && (u.id === b.hero.id || u.id === b.hero.inVehicle)) continue;
    think(b, u);
  }
  for (const s of sides) if (!(input && s === b.spec.hero)) aiStrike(b, s);

  // Strikes land.
  for (const st of b.strikes) if ((st.t -= DT) <= 0) blast(b, st.side, st.x, st.z, st.r ?? STRIKE_RADIUS, st.dmg ?? 260, 0, st.by ?? (st.side === b.spec.hero && input && !st.shell ? b.hero.id ?? undefined : undefined));
  b.strikes = b.strikes.filter((st) => st.t > 0);

  // A vehicle going up throws its driver out hurt; the dead cost their side tickets.
  const wreck = heroVehicle(b);
  if (wreck && wreck.hp <= 0) {
    b.hero.inVehicle = null;
    if (hero) { hero.hp -= 150; unstick(b, hero); }
    say(b, `Your ${wreck.kind} is destroyed`);
  }
  // A mob on a Thunder Marine tears into them, on top of the clubs.
  for (const u of b.units) {
    if (u.hp <= 0 || isHorde(b, u.side) || armoured(u.kind) || flies(u) || hidden(b, u)) continue;
    if (mob(b, u) >= MOB) u.hp -= MAUL * DT;
  }
  // Boomies go off when they die, however they die, and can set each other off.
  for (let again = true; again;) {
    again = false;
    for (const u of b.units) if (u.hp <= 0 && u.role === "boomie" && u.back !== -1) {
      u.back = -1;
      blast(b, u.side, u.x, u.z, 7, 140, 0.2);
      again = true;
      if (rand(b) < 0.15) say(b, "A Boomie went off. Nobody asked it to.");
    }
  }
  for (const u of b.units) if (u.hp <= 0) {
    if (!u.wild) { // a surge is the swarm itself: it costs the horde nothing, and killing it earns no champion
      b.tickets[u.side] -= statsOf(u).cost;
      b.kills[other(u.side)] += statsOf(u).cost;
    }
    if (u.role === "mossback") say(b, isHorde(b, other(u.side)) ? "Drums stop: the Mossback is down." : "The Mossback is down. Somebody count the rockets we have left.");
    if (b.hero.id !== null && u.hitBy === b.hero.id && u.side !== b.spec.hero) { b.hero.kills++; b.hero.streak++; } // a Chub counts for more than a Fodder, a walker for more than both
    die(b, u);
    if (u.id === b.vip) { b.vip = null; say(b, "The champion is down"); }
    if (u.id === b.hero.id) {
      b.hero.streak = 0;
      b.hero.arm = null;
      b.hero.lives--;
      b.hero.id = null;
      b.hero.respawn = 5;
      say(b, b.hero.lives > 0 ? `Hero down: ${b.hero.lives} ${b.hero.lives === 1 ? "life" : "lives"} left` : "Hero down for good");
    }
  }
  b.units = b.units.filter((u) => u.hp > 0);
  if (b.hero.id === null && b.hero.lives > 0 && (b.hero.respawn -= DT) <= 0) spawnHero(b);
  for (const s of sides) if (!b.champ[s] && b.kills[s] >= CHAMP_AT) champion(b, s);

  // Command posts: whoever stands alone on one turns it. Gunships fly over and don't count.
  for (const [i, p] of b.posts.entries()) {
    if (!inPlay(b, i)) continue;
    let att = 0, def = 0;
    for (const u of b.units) if (u.kind !== "turret" && !flies(u) && !hidden(b, u) && dist(u, p) < POST_RADIUS) u.side === "attacker" ? att++ : def++;
    if (!att === !def) continue;
    const before = p.owner;
    p.progress = clamp(p.progress + (att ? 1 : -1) * 0.12 * Math.min(4, att || def) * DT, -1, 1);
    if (p.progress >= 1) p.owner = "attacker";
    else if (p.progress <= -1) p.owner = "defender";
    else if ((p.owner === "attacker" && p.progress <= 0) || (p.owner === "defender" && p.progress >= 0)) p.owner = null;
    if (p.owner !== before) say(b, p.owner ? `${p.name} taken by ${p.owner === b.spec.hero ? "your side" : "the enemy"}` : `${p.name} lost`);
  }

  rhythm(b);

  // Bleed, drop pods, fresh troops and vehicles.
  const held = (s: Side) => b.posts.filter((p) => p.owner === s).length;
  const tick = (every: number) => Math.floor(b.time / every) !== Math.floor((b.time - DT) / every);
  let decided: Side | null = null;
  if (b.mode === "conquest") {
    if (tick(BLEED_EVERY)) for (const s of sides) b.tickets[s] -= Math.max(0, held(other(s)) - held(s));
    // On a tie the attacker bleeds slowly: it's the one that has to push.
    if (tick(BLEED_EVERY * 2) && held("attacker") === held("defender")) b.tickets.attacker--;
  } else decided = objectives(b, tick);
  for (const s of sides) {
    if (!b.reinforced[s] && b.spec.reinforcements[s] > 0 && b.tickets[s] <= b.spec.tickets[s] / 2) {
      b.reinforced[s] = true;
      b.tickets[s] += b.spec.reinforcements[s];
      say(b, `${s === b.spec.hero ? "Our" : "Enemy"} drop pods: +${b.spec.reinforcements[s]} tickets`);
    }
    // Troops come in waves, so a side doesn't feed itself in one at a time.
    if (b.tickets[s] <= 0 || b.time < b.spawnAt[s]) continue;
    b.spawnAt[s] = b.time + WAVE_EVERY;
    const horde = isHorde(b, s), alive = (f: (k: UnitKind) => boolean) => b.units.filter((u) => u.side === s && !u.wild && f(u.kind)).length;
    // Two vehicles out at a time, of whichever kind the side has most of left.
    const left = b.vehiclesLeft[s], next = VEHICLE_KINDS.reduce((a, k) => (left[k] > left[a] ? k : a));
    if (!horde && alive(isVehicle) < 2 && left[next] > 0) { const at = spawnPoint(b, s); left[next]--; add(b, s, next, at.x, at.z); }
    for (let n = troopCap(b, s) - alive(horde ? (k) => k === "wooka" : isTrooper); n > 0; n--) {
      const at = spawnPoint(b, s);
      if (horde) add(b, s, "wooka", at.x, at.z, nextRole(b, s));
      else add(b, s, nextClass(b, s), at.x, at.z);
    }
  }
  if (Math.floor(b.time / FLAVOR_EVERY) !== Math.floor((b.time - DT) / FLAVOR_EVERY) && sides.some((s) => isHorde(b, s))) {
    const pool = radioFor(b.spec.sector, FLAVOR);
    say(b, pool[Math.floor(rand(b) * pool.length)]!);
  }

  for (const f of b.fx) f.t -= DT;
  b.fx = b.fx.filter((f) => f.t > 0);
  if (b.events.length > 40) { b.events.splice(0, b.events.length - 40); b.eventAt.splice(0, b.eventAt.length - 40); }

  const out = sides.find((s) => b.tickets[s] <= 0);
  if (decided || out || b.time >= timeLimit(b.spec)) {
    // On the clock: conquest and the hill go to whoever has more tickets, the rest to the defender, who held.
    const onTime = b.mode === "conquest" || b.mode === "hill" ? (b.tickets.attacker > b.tickets.defender ? "attacker" : "defender") : "defender";
    const winner = decided ?? (out ? other(out) : onTime);
    b.over = { id: b.spec.id, winner, tickets: { attacker: Math.max(0, Math.ceil(b.tickets.attacker)), defender: Math.max(0, Math.ceil(b.tickets.defender)) }, heroDown: b.hero.lives <= 0 };
  }
}

// How many of the horde are right on top of someone.
const mob = (b: Battle, u: Unit) => b.units.filter((v) => v.side !== u.side && v.hp > 0 && v.role && v.role !== "sticky" && v.role !== "shanti" && dist(u, v) < 3).length;

// Something dies: it comes apart in its side's colours. A Thunder Marine with a mob on them is torn
// apart, and sometimes gets a last word in on the radio.
function die(b: Battle, u: Unit) {
  const torn = !isHorde(b, u.side) && !armoured(u.kind) && mob(b, u) >= MOB;
  b.fx.push({ kind: "gore", x: u.x, z: u.z, tx: u.x, tz: u.z, t: 1.5, side: u.side, big: torn || armoured(u.kind) || !!u.champ, y: altitude(u) });
  if (armoured(u.kind)) b.fx.push({ kind: "blast", x: u.x, z: u.z, tx: u.x, tz: u.z, t: 0.6, big: true });
  if (isHorde(b, u.side) || armoured(u.kind) || u.id === b.hero.id || b.time - b.screamAt < 4) return;
  if (torn || rand(b) < 0.3) {
    b.screamAt = b.time;
    const who = NAMES[Math.floor(rand(b) * NAMES.length)]!;
    say(b, torn && rand(b) < 0.5 ? `${who} was torn apart.` : `${who}: "${SCREAMS[Math.floor(rand(b) * SCREAMS.length)]}"`);
  }
}

// A side has killed enough to earn its champion. If it's the player's side, the hero becomes
// them, or comes back as them; otherwise one walks in at the spawn.
function champion(b: Battle, s: Side) {
  b.champ[s] = true;
  const warbur = isHorde(b, s), mine = s === b.spec.hero;
  if (mine && b.hero.id !== null) {
    if (b.hero.inVehicle !== null) b.hero.inVehicle = null;
    crown(b, heroUnit(b)!);
  } else if (!mine) {
    const p = spawnPoint(b, s);
    crown(b, add(b, s, "champion", p.x, p.z));
  }
  say(b, warbur
    ? `${mine ? "You are" : "Something big is coming. It's"} WARBUR: half Wooka, half bear, all silverback.${mine ? " E throws a Wooka." : ""}`
    : `${mine ? "You are" : "The Thunder Marines have"} GUMPERT.${mine ? " E swaps kit: rockets, stun baton, jetpack." : ""}`);
}

// The modes' own objectives, a step at a time. The side that has just won by them, if one has.
function objectives(b: Battle, tick: (every: number) => boolean): Side | null {
  const live = b.posts[b.live]!;
  switch (b.mode) {
    case "assault":
      if (b.phase > 0) {
        // Holding: they counter-attack. Lose it and it's back to taking it; hold on and the next comes live.
        if (live.owner !== "attacker") { b.phase = 0; say(b, `${live.name} retaken: take it back`); }
        else if ((b.phase -= DT) <= 0) { b.phase = 0; b.live++; say(b, `${b.posts[b.live]!.name} is live: attack`); }
      } else if (live.owner === "attacker") {
        if (b.live === b.posts.length - 1) return "attacker";
        b.phase = HOLD_FOR;
        say(b, `Hold ${live.name} for ${HOLD_FOR}s`);
      }
      // Whoever's pushing bleeds: the attacker while taking a post, the defender while it's held against them.
      if (tick(BLEED_EVERY)) b.tickets[b.phase > 0 ? "defender" : "attacker"]--;
      return null;
    case "hill":
      if (live.owner && tick(HILL_DRAIN)) b.tickets[other(live.owner)]--;
      if ((b.phase -= DT) <= 0) {
        live.owner = null; live.progress = 0;
        b.live = (b.live + 1) % b.posts.length;
        b.phase = HILL_EVERY;
        say(b, `The hill moves to ${b.posts[b.live]!.name}`);
      }
      return null;
    case "holdout":
      return b.posts.every((p) => p.owner === "attacker") ? "attacker" : null;
    case "escort": {
      const c = vipUnit(b);
      if (!c) return "defender";
      if (dist(c, b.posts.at(-1)!) < POST_RADIUS) { say(b, "The champion reaches the keep"); return "attacker"; }
      return null;
    }
    default:
      return null;
  }
}

// With no input the hero fights like any other trooper: for tests, and for a battle left to the AI.
export function run(spec: BattleSpec, maxSeconds = timeLimit(spec)): Battle {
  const b = startBattle(spec);
  while (!b.over && b.time < maxSeconds) step(b, null);
  return b;
}
