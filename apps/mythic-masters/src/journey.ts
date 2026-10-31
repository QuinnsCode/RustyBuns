// The journey: the creature-collecting game around the fights. The Bog Witch hands you one of four starters, each
// playable region is twelve sections on a trail to its mythic (the Jersey Devil at Leeds Point first), wild cryptids
// roam each section, and the ones you bind go into your line-up of four or, past that, the Eldritch Journal.
// No three.js and no DOM: main.ts draws it, src/world/trail.ts lays the sections on the ground, the tests play it.
import { clamp } from "@rustybuns/util";
import { arr, check, int, obj, rec, str, type Of } from "@rustybuns/util/guard";
import { LORE } from "./lore.ts";
import { REGIONS, type Region } from "./regions.ts";
import { creature, ROSTER, type Creature } from "./roster.ts";

/** The four the Bog Witch offers. Ember beats grove, tide beats ember, grove beats tide; the jackalope is the quick
 * odd one out. None of them flies, so the Jersey Devil overhead is a real wall. */
export const STARTERS = ["hodag", "squonk", "agropelter", "jackalope"] as const;
export const WITCH_SAYS: Record<(typeof STARTERS)[number], string> = {
  hodag: "A hodag pup from the north woods. Hot-blooded, stone-backed, slow to turn and slower to fall.",
  squonk: "A squonk. It weeps, it hides, and its tears are a tide that puts out any fire.",
  agropelter: "An agropelter out of a hollow tree. It throws branches, and it holds a grudge.",
  jackalope: "A jackalope. Six kilos of antler and nerve. Faster than anything in these pines.",
};

export const PARTY_MAX = 4;
export const SECTIONS = 12; // the last is the region's mythic, at its arena

export interface Section {
  /** 0-based; SECTIONS - 1 is the mythic. */
  k: number;
  name: string;
  /** One true thing about the place, written into the journal when you clear it. */
  lore: string;
  /** Who roams it, roster ids. */
  wilds: string[];
  /** Who stands on its stone and must be beaten (or bound) to go on. The last section's is the mythic. */
  keeper: string;
  level: number;
}

// The Pine Barrens, Batsto to Leeds Point. Every line is checkable: the Pinelands National Reserve, the bog-iron
// villages, cedar water, Apple Pie Hill's fire tower, the dwarf pine plains, the 1909 week of sightings.
const PINE_BARRENS: [name: string, lore: string, wilds: string[], keeper: string][] = [
  ["Batsto Village", "Batsto was a bog-iron village from the 1760s: the iron came out of the streams themselves, rusted into the bog bottoms.", ["wampus-cat", "hidebehind"], "wampus-cat"],
  ["Mullica River", "Cedar water: Pine Barrens rivers run the colour of tea, stained by the tannins of Atlantic white cedar and the iron in the sand.", ["hidebehind", "wampus-cat"], "hidebehind"],
  ["Wharton Forest", "The Pinelands National Reserve covers about 1.1 million acres, close to a quarter of New Jersey, on sand that holds a vast aquifer.", ["wampus-cat", "hidebehind", "chupacabra"], "chupacabra"],
  ["Atsion Lake", "Atsion was another iron town; its lake, dammed from the Mullica's headwaters, is as brown and clear as the rivers that fill it.", ["champ", "wampus-cat"], "champ"],
  ["Apple Pie Hill", "At about 205 feet Apple Pie Hill is the high ground of the pines; from its fire tower you can see Philadelphia and Atlantic City on a clear day.", ["mothman", "chupacabra"], "mothman"],
  ["The Pine Plains", "On the Pine Plains the pitch pines grow full-aged and waist-high: fire, wind and starved sand keep the forest a dwarf one.", ["chupacabra", "wampus-cat", "rougarou"], "rougarou"],
  ["Cranberry bogs", "New Jersey is one of the country's biggest cranberry growers; at harvest the bogs are flooded so the ripe berries float to the top.", ["champ", "rougarou", "ozark-howler"], "ozark-howler"],
  ["Cedar swamp", "Atlantic white cedar swamps stand so close and dark that the floor stays cool in August; the tree frog that calls here lives almost nowhere else.", ["rougarou", "hidebehind"], "hidebehind"],
  ["Blue Hole", "Blue Hole, near Winslow, is a spring-fed pond of clear blue water in a brown country. Locals called it bottomless, and the Devil's swimming hole.", ["champ", "mothman"], "champ"],
  ["Ong's Hat", "Ong's Hat is a ghost town named, the story goes, for a hat thrown up into a pine tree that never came down.", ["ozark-howler", "wampus-cat"], "ozark-howler"],
  ["The 1909 trail", "In one week of January 1909 hundreds of people across South Jersey and Philadelphia reported hoofprints over rooftops and a winged thing screaming in the night.", ["mothman", "sasquatch"], "sasquatch"],
  ["Leeds Point", "In 1735 Mother Leeds swore her thirteenth child would be the devil. It was born a baby, changed into a winged thing with hooves and a forked tail, and flew up the chimney into the pines.", [], "jersey-devil"],
];

// Every other region's twelve: a stretch of trail named for what the land does there, its lore page split into
// lines along the way, and the creatures of its legends (and its neighbours on the route) in the brush.
const STRETCH = ["Trailhead", "Old road", "The ford", "Thicket", "Lookout", "Hollow", "Clearing", "Ridge", "Marsh edge", "Ruins", "Last camp"];

/** The region's mythic: the first fighter from its own legends, or the next one along the route. */
export function mythicOf(g: Region): Creature {
  const free = (c: Creature) => !STARTERS.some((s) => s === c.id);
  return ROSTER.find((c) => c.region === g.n && free(c)) ?? ROSTER.find((c) => c.region >= g.n && free(c)) ?? ROSTER[0]!;
}

/** The level its sections start at: each region on the route is about eight levels on from the last. */
export const baseLevel = (n: number) => 2 + (n - 1) * 8;
export const sectionLevel = (n: number, k: number) => (k === SECTIONS - 1 ? baseLevel(n) + 8 : baseLevel(n) + Math.floor(k * 0.6));

export function sections(g: Region): Section[] {
  if (g.id === "pine-barrens")
    return PINE_BARRENS.map(([name, lore, wilds, keeper], k) => ({ k, name, lore, wilds, keeper, level: sectionLevel(g.n, k) }));
  const boss = mythicOf(g);
  const near = ROSTER.filter((c) => c.id !== boss.id && !STARTERS.some((s) => s === c.id) && Math.abs(c.region - g.n) <= 2);
  const pool = near.length ? near : ROSTER.filter((c) => c.id !== boss.id).slice(0, 4);
  const page = LORE[g.id], lines = page ? `${page.legend} ${page.from}`.split(/(?<=[.!?])\s+/).filter(Boolean) : [];
  return Array.from({ length: SECTIONS }, (_, k) => {
    const last = k === SECTIONS - 1, wilds = last ? [] : [pool[k % pool.length]!.id, pool[(k + 1) % pool.length]!.id].filter((id, i, a) => a.indexOf(id) === i);
    return {
      k, name: last ? `${boss.name}'s lair` : STRETCH[k]!, level: sectionLevel(g.n, k),
      lore: lines[Math.floor((k * lines.length) / SECTIONS)] ?? `Nothing is written about this stretch of ${g.name} yet.`,
      wilds, keeper: last ? boss.id : wilds[0]!,
    };
  });
}
/** Regions with a trail: the playable ones. The high-level south keeps its roaming deadly wilds and no sections. */
export const hasTrail = (g: Region) => g.tier === "playable";

// --- one creature you own --------------------------------------------------------------------------------------
export const Member = obj({ id: str(64), level: int(1, 100), xp: int(0, 10_000_000) });
export type Member = Of<typeof Member>;

/** XP from one level to the next. */
export const toNext = (level: number) => level * 15;

/** A creature at a level: everything but speed scales, so a level-2 hodag still moves like a hodag. Level 10 is the roster's. */
export function atLevel(c: Creature, level: number, wild = false): Creature {
  const k = 0.7 + clamp(level, 1, 100) * 0.03, s = (v: number) => Math.min(255, Math.round(v * k));
  const { vigor, might, guard, focus, will, speed } = c.stats;
  return {
    ...c, id: wild ? `wild-${c.id}` : c.id, name: wild ? `Wild ${c.name}` : c.name,
    stats: { vigor: s(vigor), might: s(might), guard: s(guard), focus: s(focus), will: s(will), speed },
  };
}
export const asCreature = (m: Member) => atLevel(creature(m.id), m.level);

/** Gives `m` the XP for beating a creature of `foeLevel`; how many levels it went up. */
export function gainXp(m: Member, foeLevel: number): number {
  m.xp += foeLevel * 10;
  let up = 0;
  while (m.xp >= toNext(m.level) && m.level < 100) { m.xp -= toNext(m.level); m.level++; up++; }
  return up;
}

// --- binding: the witch's ink -----------------------------------------------------------------------------------
export const INK = 3; // tries per fight
/** Health (as a fraction of full) below which a creature can be bound: a wild one when worn down, a mythic when nearly out. */
export const bindBelow = (mythic: boolean) => (mythic ? 0.3 : 0.45);
/** Chance one try of the ink holds. 0 above `bindBelow`; rises as its health falls; a mythic is half as easy. */
export function bindChance(hpFrac: number, mythic: boolean): number {
  const top = bindBelow(mythic);
  if (hpFrac > top) return 0;
  const worn = 1 - clamp(hpFrac / top, 0, 1);
  return clamp((0.3 + 0.65 * worn) * (mythic ? 0.5 : 1), 0, 0.95);
}

// --- the save: your line-up, the journal, what you've seen, how far each trail goes --------------------------------
export const Journey = obj({
  v: int(1, 1),
  starter: str(64),
  party: arr(Member, PARTY_MAX, { min: 1 }),
  journal: arr(Member, 500, { drop: true }),
  seen: arr(str(64), 500, { drop: true }),
  /** Region number -> sections cleared (0 to SECTIONS). */
  cleared: rec(int(0, SECTIONS), 64),
  /** Section pages written into the journal, "n:k". */
  pages: arr(str(16), 2000, { drop: true }),
});
export type Journey = Of<typeof Journey>;

export const SAVE_KEY = "mythic-masters.journey";

export function newJourney(starter: string): Journey {
  const id = STARTERS.find((s) => s === starter) ?? STARTERS[0];
  return { v: 1, starter: id, party: [{ id, level: 5, xp: 0 }], journal: [], seen: [id], cleared: {}, pages: [] };
}
/** A stored journey, or null when it's missing or not one (a broken save starts a new game, it doesn't crash this one). */
export function loadJourney(text: string | null): Journey | null {
  if (!text) return null;
  try { return check(Journey, JSON.parse(text)); } catch { return null; }
}

export const cleared = (j: Journey, n: number) => j.cleared[n] ?? 0;
export const owns = (j: Journey, id: string) => [...j.party, ...j.journal].some((m) => m.id === id);
export function see(j: Journey, id: string) { if (!j.seen.includes(id)) j.seen.push(id); }

/** A bound creature joins the line-up, or the journal when the line-up is full. Where it went. */
export function bind(j: Journey, id: string, level: number): "party" | "journal" {
  see(j, id);
  const m: Member = { id, level, xp: 0 };
  if (j.party.length < PARTY_MAX) { j.party.push(m); return "party"; }
  j.journal.push(m);
  return "journal";
}

/** Section k of region n cleared (in order: an earlier one can't be skipped). Writes its page. */
export function clearSection(j: Journey, n: number, k: number) {
  if (k > cleared(j, n)) return;
  j.cleared[n] = Math.max(cleared(j, n), k + 1);
  const page = `${n}:${k}`;
  if (!j.pages.includes(page)) j.pages.push(page);
}

// --- the line-up --------------------------------------------------------------------------------------------------
/** Moves line-up slot i one up (slot 0 leads). */
export function moveUp(j: Journey, i: number) {
  if (i <= 0 || i >= j.party.length) return;
  [j.party[i - 1], j.party[i]] = [j.party[i]!, j.party[i - 1]!];
}
/** Sends line-up slot i to rest in the journal. The line-up keeps at least one. */
export function rest(j: Journey, i: number): boolean {
  if (j.party.length <= 1 || !j.party[i]) return false;
  j.journal.push(...j.party.splice(i, 1));
  return true;
}
/** Calls journal entry e into the line-up: into a free slot, or swapped with slot `into` when it's full. */
export function call(j: Journey, e: number, into = PARTY_MAX - 1): boolean {
  const m = j.journal[e];
  if (!m) return false;
  if (j.party.length < PARTY_MAX) { j.journal.splice(e, 1); j.party.push(m); return true; }
  const out = j.party[into];
  if (!out) return false;
  j.party[into] = m; j.journal[e] = out;
  return true;
}

/** The line-up slot that fights next when `out` (slots already knocked out this fight) are down; -1 when none is left. */
export const nextUp = (j: Journey, out: ReadonlySet<number>) => j.party.findIndex((_, i) => !out.has(i));

/** Every playable region, for the journal's region pages. */
export const TRAIL_REGIONS = REGIONS.filter(hasTrail);
