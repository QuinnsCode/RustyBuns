// The tour: the venue ladder, what each gig pays, the gear you own and the truck that hauls it. A gig needs its kit (the
// gear its level starts with, less what the house owns); what you don't own you rent for the night, and if the kit
// outweighs your truck you rent a bigger one. Rent comes out of the pay. A good night (the show passes) books the next
// rung; a poor one gets you booked back at the same place. Pay buys gear and trucks, kept at home base (the garage).
// Your following is the crowd your good nights build: it fills the next room (never past what the room holds), and a
// gig pays by the heads in it. Every rung is a real rig of its size, its counts in `RIGS`.
// Plain data, no DOM: the page saves it in the browser through `TourSave`.
import { arr, check, int, obj, oneOf, or, rec, str } from "@rustybuns/util/guard";
import { gear } from "@rustybuns/gear";
import { VENUES } from "./clock.ts";
import type { Answer, Level } from "./sim.ts";
import { GARAGE } from "./sim.ts";
import { DIVE_BAR } from "./venues/dive-bar.ts";
import { BIGGER_BAR } from "./venues/bigger-bar.ts";
import { PARK } from "./venues/park.ts";
import { FIRST_GIG } from "./venues/first-gig.ts";
import { DESERT } from "./venues/desert.ts";
import { SMALL_ARENA } from "./venues/small-arena.ts";
import { ARENA } from "./venues/arena.ts";
import { AMPHITHEATRE } from "./venues/amphitheatre.ts";

/**
 * The real rig at each rung, as a crew would build it for that many people. The level you play is the part of it you
 * carry and wire yourself; these are the whole thing, shown on the tour card. No count shrinks from one rung to the next, but the amphitheatre seats fewer than the arena.
 * - people: what the room holds. tops, subs, wedges: boxes. amps: amp channels, a powered box's own amp counts as one.
 * - kw: the mains the sound system can pull at show level. runs: cable runs (power, signal, speaker). crew: on sound.
 */
export type Rig = { people: number; tops: number; subs: number; wedges: number; amps: number; kw: number; power: string; runs: number; crew: number };
export const RIGS: Readonly<Record<string, Rig>> = {
  // A singer and a wedge: one channel of a rack at a few watts, on the room's own wall circuit. Five cables.
  "first-gig": { people: 60, tops: 0, subs: 0, wedges: 1, amps: 1, kw: 0.4, power: "a wall circuit", runs: 5, crew: 1 },
  // A bar: two powered tops on sticks and a sub, about 1 W per person of program and a 20 A circuit's 2.4 kW to pull on.
  "dive-bar": { people: 120, tops: 2, subs: 1, wedges: 1, amps: 3, kw: 1.5, power: "one 20 A circuit", runs: 9, crew: 1 },
  // A club: passive tops and subs off a four-channel rack, one sub per top (a club runs one sub per one or two tops),
  // two wedges, the rack on its own 20 A circuit away from the bar's cooler.
  "bigger-bar": { people: 250, tops: 2, subs: 2, wedges: 2, amps: 6, kw: 3, power: "two circuits", runs: 14, crew: 2 },
  // A park stage: four tops and two subs (powered, a channel each) on a 7 kVA generator, which runs about 6 kW.
  park: { people: 600, tops: 4, subs: 2, wedges: 2, amps: 8, kw: 6, power: "a 7 kVA generator", runs: 22, crew: 3 },
  // A desert night: a horn-loaded wall, four tops on four subs a side in the full rig (the level stacks one side's
  // worth), racks of amps on a generator that has to be fuelled through the night.
  desert: { people: 1500, tops: 8, subs: 8, wedges: 4, amps: 16, kw: 12, power: "a generator and its fuel", runs: 40, crew: 4 },
  // A small arena: flown arrays from three points a side (main, side and a sub or out-fill hang), about ten boxes a
  // main hang; amp channels by the box, on a 200 A three-phase service (about 60 kW).
  "small-arena": { people: 4000, tops: 44, subs: 12, wedges: 8, amps: 56, kw: 60, power: "200 A three-phase", runs: 90, crew: 8 },
  // An arena: main hangs of 12 to 16 boxes a side (14 here), side hangs of 12, two delay hangs of 8 for the back, front
  // fills; a sub line of 24 across the stage front (or a cardioid array); amp racks in the hundreds of kW on 400 A
  // three-phase services.
  arena: { people: 15000, tops: 76, subs: 24, wedges: 16, amps: 160, kw: 250, power: "400 A three-phase, twice", runs: 220, crew: 12 },
  // The red-rock amphitheatre: about 9,500 seats, fewer heads than the arena but the top of the ladder for its rig and
  // its throw. Main hangs of 13 to 16 a side, side hangs, two delay towers of 6 up the bowl, front fills; a cardioid
  // sub line of 24 or more (the stage, the back rock and the valley); on two 400 A services and its own generators.
  amphitheatre: { people: 9500, tops: 84, subs: 28, wedges: 16, amps: 176, kw: 260, power: "400 A three-phase, twice, and backup generators", runs: 240, crew: 14 },
};

/** The rungs you can play now, in order: a pass at one books the next. */
export const LADDER: readonly { level: Level; name: string }[] = [
  { level: FIRST_GIG, name: "The first gig" },
  { level: DIVE_BAR, name: "The dive bar" },
  { level: BIGGER_BAR, name: "The bigger bar" },
  { level: PARK, name: "The community event" },
  { level: DESERT, name: "The desert night party" },
  { level: SMALL_ARENA, name: "The small arena" },
  { level: ARENA, name: "The arena" },
  { level: AMPHITHEATRE, name: "The red-rock amphitheatre" },
  // next rung: the local festival (step 9 of #5029) between the desert and the small arena.
];

/** Who comes on your first night: friends. */
export const FIRST_FOLLOWING = 20;
/** A room's own regulars and the promoter's crowd, as a share of what it holds: they come whoever runs the sound. */
export const HOUSE = 0.4;
/** A good night: this share of tonight's crowd, scaled by the score, comes back next time with friends. */
export const GROW = 0.5;
/** A poor night: this share of your following stays home next time. */
export const SHRINK = 0.2;

/** Tonight's crowd at a rung: the house plus your following, never past what the room holds; and the share of a full room. */
export function crowd(t: Tour, level: Level): { heads: number; share: number } {
  const people = RIGS[level.name]?.people ?? 100;
  const heads = Math.min(people, Math.round(people * HOUSE) + t.following);
  return { heads, share: heads / people };
}

/** What each piece costs to buy, in dollars; a night's rent is `RENT` of it. Gear with no price is the house's. */
export const PRICES: Record<string, number> = {
  "top-12-powered": 400, "top-15-passive": 300, "sub-18": 500, "wedge-12": 250,
  "amp-head": 300, "cab-4x12": 300, guitar: 300,
  "amp-rack-4u": 600, "mixer-small": 200, "mic-condenser": 150, "wedge-12-passive": 250, "generator-7kva": 900, "distro-box": 80,
  "cable-ramp-2ch": 60, "road-case-m": 100, "stand-tripod": 50, "mic-stand": 30,
};
export const RENT = 0.05;

/** The trucks, smallest first: what each carries and costs. A night's rent of one you don't own is `TRUCK_RENT` of it. */
export const TRUCKS = [
  { id: "hatchback", name: "Hatchback", kg: 150, price: 0 },
  { id: "van", name: "Van", kg: 600, price: 1200 },
  { id: "box-truck", name: "Box truck", kg: 2000, price: 5000 },
] as const;
export const TRUCK_RENT = 0.1;
export type TruckId = (typeof TRUCKS)[number]["id"];
const TRUCK_IDS = TRUCKS.map((t) => t.id);
const truck = (id: TruckId) => TRUCKS.find((t) => t.id === id)!;

/** What a tour holds between nights: saved in the browser, read back through this guard. */
export const TourSave = obj({
  cash: int(-1e7, 1e7),
  /** How many of each gear id you own. */
  owned: rec(int(0, 99), 64),
  truck: oneOf(TRUCK_IDS),
  /** People who come to see your nights; a save from before it was kept starts with your friends. */
  following: or(int(0, 1e6), FIRST_FOLLOWING),
  /** The level name of the next gig. */
  booked: str(40),
  nights: arr(obj({ level: str(40), score: int(0, 100), pay: int(-1e6, 1e6), pass: oneOf([0, 1]) }), 50, { drop: true }),
});
export type Tour = ReturnType<typeof TourSave>;

/** A new tour: the garage's own gear, the hatchback, a little cash, your friends, booked at the first gig. */
export function newTour(): Tour {
  return { cash: 100, owned: kit(GARAGE), truck: "hatchback", following: FIRST_FOLLOWING, booked: LADDER[0]!.level.name, nights: [] };
}

/** A saved tour read back, or a new one when it's missing or not a tour (an old save, a hand edit). */
export function readTour(v: unknown): Tour {
  const t = check(TourSave, v);
  return t && LADDER.some((r) => r.level.name === t.booked) ? t : newTour();
}

/** The gear a level asks you to bring: each priced gear id it starts with, and how many. */
export function kit(level: Level): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of level.items) if (PRICES[i.gear] !== undefined) out[i.gear] = (out[i.gear] ?? 0) + 1;
  return out;
}

export type Ready = {
  /** Gear ids you're short of, with how many. */
  missing: Record<string, number>;
  /** The kit's weight in kg, and whether your own truck carries it. */
  kg: number;
  fits: boolean;
  /** The truck you'd rent when yours is too small (null when it fits). */
  rentTruck: TruckId | null;
  /** What tonight's rent comes to: the missing gear, and the truck if you need one. */
  rent: number;
  fee: number;
};

/** What taking the gig at `level` costs you before the doors: rent for the gear you're short of and a bigger truck. */
export function ready(t: Tour, level: Level): Ready {
  const need = kit(level), missing: Record<string, number> = {};
  let kg = 0, gearRent = 0;
  for (const [id, n] of Object.entries(need)) {
    kg += gear(id).kg * n;
    const short = n - (t.owned[id] ?? 0);
    if (short > 0) { missing[id] = short; gearRent += short * PRICES[id]! * RENT; }
  }
  const fits = kg <= truck(t.truck).kg;
  const rentTruck = fits ? null : (TRUCKS.find((x) => x.kg >= kg)?.id ?? "box-truck");
  const rent = Math.round(gearRent + (rentTruck ? truck(rentTruck).price * TRUCK_RENT : 0));
  return { missing, kg: Math.round(kg), fits, rentTruck, rent, fee: VENUES[level.name]?.fee ?? 0 };
}

/** A night played: the show's result at `level`. */
export type Night = { score: number; pay: number; pass: boolean };

/**
 * Settle a night: the pay goes by the heads in the room (the fee is a full room's), less the rent, into the cash. A pass
 * books the next rung (the top rung books itself) and grows your following by the crowd and the score; a miss loses some.
 */
export function record(t: Tour, level: Level, night: Night): { tour: Tour; net: number; booked: string; heads: number } {
  const { heads, share } = crowd(t, level);
  const net = Math.round(night.pay * share) - ready(t, level).rent;
  const following = night.pass ? t.following + Math.round(heads * GROW * Math.min(1, night.score / 100)) : Math.round(t.following * (1 - SHRINK));
  const at = LADDER.findIndex((r) => r.level === level);
  const next = night.pass ? LADDER[Math.min(at + 1, LADDER.length - 1)]! : LADDER[Math.max(0, at)]!;
  const tour: Tour = {
    ...t,
    cash: t.cash + net,
    following,
    booked: next.level.name,
    nights: [...t.nights, { level: level.name, score: Math.round(night.score), pay: net, pass: night.pass ? 1 as const : 0 as const }].slice(-50),
  };
  return { tour, net, booked: tour.booked, heads };
}

/** Buy one piece of gear, or a truck (the old one is traded in for nothing). */
export function buy(t: Tour, id: string): { tour: Tour } & Answer {
  const tr = TRUCKS.find((x) => x.id === id);
  const price = tr ? tr.price : PRICES[id];
  if (price === undefined) return { tour: t, ok: false, why: `${id} isn't for sale` };
  if (tr && truck(t.truck).kg >= tr.kg) return { tour: t, ok: false, why: `the ${truck(t.truck).name.toLowerCase()} already carries that much` };
  if (t.cash < price) return { tour: t, ok: false, why: `that's $${price}, you have $${t.cash}` };
  const tour: Tour = tr
    ? { ...t, cash: t.cash - price, truck: tr.id }
    : { ...t, cash: t.cash - price, owned: { ...t.owned, [id]: (t.owned[id] ?? 0) + 1 } };
  return { tour, ok: true };
}

/** The rung the tour is booked at. */
export const bookedRung = (t: Tour) => LADDER.find((r) => r.level.name === t.booked) ?? LADDER[0]!;
