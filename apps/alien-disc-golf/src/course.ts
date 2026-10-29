// A course is nine holes drawn from a seed: each tee somewhere on land in one country, each basket in
// another, a continent or an ocean away. The same seed is the same course on every machine, so a link
// (?seed=) is a challenge.
import { mulberry32 } from "@rustybuns/util";
import { countries, landPoint, type Country } from "./countries.ts";
import { distanceKm, type LatLon } from "./geo.ts";

export interface Hole {
  n: number;            // 1-based
  tee: LatLon;
  teeCountry: string;
  basket: LatLon;
  basketCountry: string;
  km: number;           // tee to basket, great circle
  par: number;
  guesses: string[];    // four country names, the tee's among them, in a fixed order
}
export interface Course { seed: number; holes: Hole[] }

export const HOLES = 9;
export const MIN_KM = 1200;
export const MAX_KM = 7500;
/** The basket's reach: inside this and the disc is in. Alien discs, alien baskets. */
export const BASKET_KM = 150;

export const parFor = (km: number) => (km < 2500 ? 3 : km < 5000 ? 4 : 5);

/** Countries big enough that a random point lands on them and a basket is findable. Island specks and Antarctica stay out. */
export function playable(list = countries()): Country[] {
  return list.filter((c) => c.areaDeg >= 4 && c.name !== "Antarctica" && c.name !== "Fr. S. Antarctic Lands" && c.name !== "Greenland");
}

export function makeCourse(seed: number, list = playable()): Course {
  const rnd = mulberry32(seed >>> 0);
  const pick = <T>(arr: T[]) => arr[Math.floor(rnd() * arr.length)]!;
  const holes: Hole[] = [];
  let lastCountry = "";
  for (let n = 1; n <= HOLES; n++) {
    let teeC = pick(list);
    while (teeC.name === lastCountry) teeC = pick(list);
    const tee = landPoint(teeC, rnd);
    let basketC = teeC, basket = tee, km = 0;
    for (let tries = 0; tries < 200; tries++) {
      basketC = pick(list);
      if (basketC.name === teeC.name) continue;
      basket = landPoint(basketC, rnd);
      km = distanceKm(tee, basket);
      if (km >= MIN_KM && km <= MAX_KM) break;
    }
    const names = new Set<string>([teeC.name]);
    while (names.size < 4) names.add(pick(list).name);
    const guesses = [...names];
    for (let i = guesses.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [guesses[i], guesses[j]] = [guesses[j]!, guesses[i]!]; }
    holes.push({ n, tee, teeCountry: teeC.name, basket, basketCountry: basketC.name, km, par: parFor(km), guesses });
    lastCountry = teeC.name;
  }
  return { seed, holes };
}

export const coursePar = (c: Course) => c.holes.reduce((t, h) => t + h.par, 0);
