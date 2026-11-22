// The believers (#4677): one crowd of friendly conspiracy folk per region, who help you where the Bog Witch used to.
// The Hatters of Ong's Hat in the Pine Barrens (tin-foil hats), the Porchlight Vigil in the hollows (moth capes),
// the Backwards Lodge in the north woods (mirrors on headbands), the Blurry Society on the Pacific coast (smeared
// goggles), the Frog Watch on the Great Lakes (waders and torches), the Antler Choir in the desert (antlered hats),
// the Thirteen Counters in the bayou (bead strings, jars of beans), the Howl-Back Club in the Ozarks (earmuffs, tin
// cups). They are not a faction: no quest, no fights, no standing. Each one's camp is the first campfire on its
// region's trail, so it is a rest stop like any fire (and you can travel back to it). Sit there and they say who they
// are the first time, hint where a cryptid you don't hold yet roams on the trail ahead, and react to how many of the
// region's twelve keepers you have beaten. Their words are content/believers.json (`bun run cms`). No DOM here:
// main.ts draws the visit.
// Letters between the fires (#5622): the groups write to each other but never meet. Each camp, in road order, reads the
// letter you carry from the last and hands you one for the next; the eighth, the Howl-Back Club, holds the first
// convention, and from then every group's hint is on the big map at once.
import { arr, int, obj, oneOf, str, type Of } from "@rustybuns/util/guard";
import { cleared, owns, SECTIONS, sections, type Journey } from "./journey.ts";
import { REGIONS } from "./regions.ts";
import { creature } from "./roster.ts";
import { POIS } from "./world/poi.ts";
import raw from "../content/believers.json";

/** The groups, each with its own look at its fire (rivals-view.ts draws them). */
export const BELIEVER_IDS = ["hatters", "porchlight", "backwards", "blurry", "frogwatch", "antlers", "counters", "howlback"] as const;
export type BelieverId = (typeof BELIEVER_IDS)[number];

const Visit = obj({ cleared: int(0, SECTIONS), first: str(400), again: str(400) });
const Group = obj({
  id: oneOf(BELIEVER_IDS), n: int(1, 64), name: str(60), camp: str(60), meet: str(600),
  /** `{creature}` and `{section}` are filled in. */
  hint: str(300), lair: str(300), allHeld: str(300),
  /** What happens to the letter at this camp, and the note it leaves in your pack (the compendium's line-up page). */
  letter: str(400), carry: str(200),
  visits: arr(Visit, 13, { min: 1 }),
});
export const Lines = obj({ goOn: str(40), convention: obj({ title: str(80), said: arr(str(400), 8, { min: 1 }) }), groups: arr(Group, 64, { min: 1 }) });
export type Lines = Of<typeof Lines>;
export type Group = Of<typeof Group>;
/** A broken lines file fails loudly here, at load. */
export const BELIEVERS: Lines = Lines(raw);

/** Each group's camp: its region's first campfire on the trail (section 0), renamed for them on the map. */
export const CAMPS = new Map<string, Group>(BELIEVERS.groups.flatMap((g) => {
  const fire = (POIS.get(g.n) ?? []).find((p) => p.kind === "fire" && p.k === 0);
  if (!fire) return [];
  fire.name = g.camp;
  return [[fire.id, g]];
}));
export const campOf = (id: string) => [...CAMPS].find(([, g]) => g.id === id)?.[0];

/** Metres from the fire the believers sit, and how many sit round it. */
const RING = 3.2, SEATS = 4;

/** Who sits round group g's fire: four of them on a ring, the same every time, each facing the flames (`yaw` turns a
 * figure whose front is +z), except the Backwards Lodge, who sit with their backs to it and watch it in their mirrors. */
export function campers(g: Group): { id: string; x: number; z: number; yaw: number }[] {
  const fire = POIS.get(g.n)?.find((p) => p.id === campOf(g.id));
  if (!fire) return [];
  return Array.from({ length: SEATS }, (_, i) => {
    const a = 0.4 + (i * Math.PI * 2) / SEATS + (i % 2) * 0.35;
    const x = fire.x + Math.cos(a) * RING, z = fire.z + Math.sin(a) * RING;
    const toFire = Math.atan2(fire.x - x, fire.z - z);
    return { id: `camp:${g.id}:${i}`, x, z, yaw: g.id === "backwards" ? toFire + Math.PI : toFire };
  });
}

const fill = (s: string, c: string, section: string) => s.replaceAll("{creature}", c).replaceAll("{section}", section);

/** Where they point you: the first section from here on whose wilds hold one you don't own (`k` its index), else the
 * region's mythic at its lair while it is still loose, else nothing left to find (null). */
export function hintAt(j: Journey, g: Group): { creature: string; section: string; k: number; lair: boolean } | null {
  const region = REGIONS[g.n - 1], all = region ? sections(region) : [];
  for (let k = cleared(j, g.n); k < all.length; k++) {
    const s = all[k]!, want = s.wilds.find((id) => !owns(j, id));
    if (want) return { creature: creature(want).name, section: s.name, k, lair: false };
  }
  const mythic = all.at(-1);
  if (mythic && cleared(j, g.n) < SECTIONS && !owns(j, mythic.keeper)) return { creature: creature(mythic.keeper).name, section: mythic.name, k: all.length - 1, lair: true };
  return null;
}
export function hintFor(j: Journey, g: Group): string {
  const h = hintAt(j, g);
  return !h ? g.allHeld : fill(h.lair ? g.lair : g.hint, h.creature, h.section);
}

/** The road the letters go along, camp by camp. */
export const ROAD: readonly BelieverId[] = ["hatters", "porchlight", "backwards", "frogwatch", "blurry", "antlers", "counters", "howlback"];
const groupOf = (id: BelieverId) => BELIEVERS.groups.find((g) => g.id === id);
/** The note the letter in your pack leaves on the compendium's page: the last camp's, once one has handed you one. */
export const carrying = (j: Journey | null): string | null => {
  const n = j?.letters ?? 0, last = ROAD[n - 1];
  return last ? groupOf(last)?.carry ?? null : null;
};
/** Once the convention is held: every group's hint, its region and section, for the big map and the convention. */
export function conventionHints(j: Journey): { g: Group; n: number; k: number; line: string }[] {
  if ((j.letters ?? 0) < ROAD.length) return [];
  return BELIEVERS.groups.flatMap((g) => { const h = hintAt(j, g); return h ? [{ g, n: g.n, k: h.k, line: `${g.name}: the ${h.creature}, ${h.section}.` }] : []; });
}

/** Sit at a group's camp: who they are (the first time), their line for the keepers you've beaten in their region
 * (`first` once per step, `again` after), and a hint. Marks the visit in the save (`Journey.believers`). */
export function visit(j: Journey, g: Group): { said: string[]; met: boolean; cleared: number; letter: boolean; convention: boolean } {
  const n = cleared(j, g.n), seen = j.believers?.[g.id];
  const step = g.visits.filter((v) => v.cleared <= n).at(-1) ?? g.visits[0]!;
  const fresh = seen === undefined || seen < step.cleared;
  (j.believers ??= {})[g.id] = n;
  // the letter: this camp's turn on the road when it is the next one, after the hint, once
  const letter = ROAD.indexOf(g.id) === (j.letters ?? 0), convention = letter && j.letters === ROAD.length - 1;
  if (letter) j.letters = (j.letters ?? 0) + 1;
  const said = [...(seen === undefined ? [g.meet] : []), fresh ? step.first : step.again, hintFor(j, g), ...(letter ? [g.letter] : [])];
  if (convention) said.push(...BELIEVERS.convention.said); // and every group's hint, listed under it (conventionHints)
  return { said, met: seen === undefined, cleared: n, letter, convention };
}
