// Every level's crowd spot by level name: where its people stand and how its room rings. main.ts fills each from the
// tour (the house plus your following) and plays the room's reverb on the page; a level with none has no crowd yet.
import { type CrowdSpot, expectTonight } from "./crowd.ts";
import type { World } from "../sim.ts";
import { type Tour, crowd } from "../tour.ts";
import { CROWD as DIVE_BAR } from "../venues/dive-bar.ts";
import { CROWD as BIGGER_BAR } from "../venues/bigger-bar.ts";
import { CROWD as PARK } from "../venues/park.ts";
import { CROWD as FIRST_GIG } from "../venues/first-gig.ts";
import { DANCE_FLOOR } from "../venues/desert.ts";
import { DANCE } from "../venues/dj-booth.ts";
import { CROWD as BAND_NIGHT } from "../venues/band-night.ts";
import { AUDIENCE as SHOW } from "../venues/show.ts";
import { CROWD as SMALL_ARENA } from "../venues/small-arena.ts";
import { CROWD as ARENA } from "../venues/arena.ts";
import { CROWD as FESTIVAL } from "../venues/festival.ts";
import { CROWD as AMPHITHEATRE } from "../venues/amphitheatre.ts";

export const SPOTS: Readonly<Record<string, CrowdSpot>> = {
  "first-gig": FIRST_GIG, "dive-bar": DIVE_BAR, "bigger-bar": BIGGER_BAR, park: PARK, desert: DANCE_FLOOR,
  "dj-booth": DANCE, "dj-booth-media": DANCE,
  "band-night": BAND_NIGHT, show: SHOW, "small-arena": SMALL_ARENA, arena: ARENA, festival: FESTIVAL, amphitheatre: AMPHITHEATRE,
};

/** A level's crowd spot, or null where no crowd stands yet. */
export const spotOf = (level: string): CrowdSpot | null => SPOTS[level] ?? null;

/** On tour: tonight's floor holds the tour's share of a full room (the house plus your following), on any level with a spot. */
export function fillFromTour(w: World, t: Tour) {
  const spot = spotOf(w.level.name);
  if (spot) expectTonight(w, spot.capacity * crowd(t, w.level).share);
}
