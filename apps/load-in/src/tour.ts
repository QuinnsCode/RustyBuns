// The tour: the venue ladder, what each gig pays, the gear you own and the truck that hauls it. A gig needs its kit (the
// gear its level starts with, less what the house owns); what you don't own you rent for the night, and if the kit
// outweighs your truck you rent a bigger one. Rent comes out of the pay. A good night (the show passes) books the next
// rung; a poor one gets you booked back at the same place. Pay buys gear and trucks, kept at home base (the garage).
// Plain data, no DOM: the page saves it in the browser through `TourSave`.
import { arr, check, int, obj, oneOf, rec, str } from "@rustybuns/util/guard";
import { gear } from "@rustybuns/gear";
import { VENUES } from "./clock.ts";
import type { Answer, Level } from "./sim.ts";
import { GARAGE } from "./sim.ts";
import { DIVE_BAR } from "./venues/dive-bar.ts";
import { BIGGER_BAR } from "./venues/bigger-bar.ts";
import { PARK } from "./venues/park.ts";

/** The rungs you can play now, in order. The desert party (#4860) and the arenas (#4861, #4862) join as they are built. */
export const LADDER: readonly { level: Level; name: string }[] = [
  { level: DIVE_BAR, name: "The dive bar" },
  { level: BIGGER_BAR, name: "The bigger bar" },
  { level: PARK, name: "The community event" },
];

/** What each piece costs to buy, in dollars; a night's rent is `RENT` of it. Gear with no price is the house's. */
export const PRICES: Record<string, number> = {
  "top-12-powered": 400, "top-15-passive": 300, "sub-18": 500, "wedge-12": 250,
  "amp-head": 300, "cab-4x12": 300, guitar: 300,
  "amp-rack-4u": 600, "mixer-small": 200, "generator-7kva": 900, "distro-box": 80,
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
  /** The level name of the next gig. */
  booked: str(40),
  nights: arr(obj({ level: str(40), score: int(0, 100), pay: int(-1e6, 1e6), pass: oneOf([0, 1]) }), 50, { drop: true }),
});
export type Tour = ReturnType<typeof TourSave>;

/** A new tour: the garage's own gear, the hatchback, a little cash, booked at the dive bar. */
export function newTour(): Tour {
  return { cash: 100, owned: kit(GARAGE), truck: "hatchback", booked: LADDER[0]!.level.name, nights: [] };
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

/** Settle a night: the pay less the rent goes into the cash, and a pass books the next rung (the top rung books itself). */
export function record(t: Tour, level: Level, night: Night): { tour: Tour; net: number; booked: string } {
  const net = night.pay - ready(t, level).rent;
  const at = LADDER.findIndex((r) => r.level === level);
  const next = night.pass ? LADDER[Math.min(at + 1, LADDER.length - 1)]! : LADDER[Math.max(0, at)]!;
  const tour: Tour = {
    ...t,
    cash: t.cash + net,
    booked: next.level.name,
    nights: [...t.nights, { level: level.name, score: Math.round(night.score), pay: net, pass: night.pass ? 1 as const : 0 as const }].slice(-50),
  };
  return { tour, net, booked: tour.booked };
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
