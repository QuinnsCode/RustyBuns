// The Bog Witch is someone you check in with (#3769), like going home between regions. Her camp is the campfire nearest
// where you wake up at Leeds Point (`WITCH_CAMP` in src/world/poi.ts). She starts off grumpy and softens with each region
// you clear: her lines are content/witch.json (`bun run cms`), one step per count of regions cleared. The first visit at
// a new count says that step's `first` line, and every visit after says its `again`. No DOM here: main.ts draws the visit.
import { arr, int, obj, str, type Of } from "@rustybuns/util/guard";
import { SECTIONS, TRAIL_REGIONS, type Journey } from "./journey.ts";
import raw from "../content/witch.json";

const Visit = obj({ cleared: int(0, 64), first: str(400), again: str(400) });
export const Lines = obj({ heading: str(60), camp: str(80), goOn: str(40), visits: arr(Visit, 64, { min: 1 }) });
export type Lines = Of<typeof Lines>;
/** A broken lines file fails loudly here, at load. */
export const WITCH: Lines = Lines(raw);

/** The regions whose whole trail (mythic and all) you have cleared. */
export const regionsCleared = (j: Journey) => TRAIL_REGIONS.filter((g) => (j.cleared[g.n] ?? 0) >= SECTIONS).length;

/** What she says now: the step for the regions you've cleared, `first` when you haven't seen her since clearing them.
 * Marks the visit in the save (`Journey.witch`, the count she last saw). */
export function visit(j: Journey, lines: Lines = WITCH): { say: string; first: boolean; cleared: number } {
  const n = regionsCleared(j);
  const step = lines.visits.filter((v) => v.cleared <= n).at(-1) ?? lines.visits[0]!;
  const first = j.witch === undefined || j.witch < n;
  j.witch = n;
  return { say: first ? step.first : step.again, first, cleared: n };
}
