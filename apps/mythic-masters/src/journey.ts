// The journey: the creature-collecting game around the fights. The Book holds five starters and you take three; each
// playable region is twelve sections on a trail to its mythic (the Jersey Devil at Leeds Point first), wild cryptids
// roam each section, and the ones you bind go into your line-up or, past that, the Eldritch Journal. The line-up holds
// three to start and gains a slot for every region's mythic you beat, up to five; the Book holds nine in all, and past
// that you release one to bind another (src/released.ts says what a released one does to the country it is let go in).
// No three.js and no DOM: main.ts draws it, src/world/trail.ts lays the sections on the ground, the tests play it.
import { clamp } from "@rustybuns/util";
import { arr, check, int, num, obj, oneOf, opt, rec, str, type Of } from "@rustybuns/util/guard";
import { REGIONS, type Region } from "./regions.ts";
import { ARCHETYPES, creature, ROSTER, type Creature } from "./roster.ts";
import { HAND } from "./sections.ts";
import { Factions } from "./factions/model.ts";
import { Released } from "./released.ts";
import LANDING from "../content/landing.json";

/** The five commons the Book caught long ago and offers you; you take three. Ember beats grove, tide beats ember, grove beats tide; the
 * jackalope is the quick odd one out and the tatzelwurm the cold, venomous one. None of them flies, so the Jersey
 * Devil overhead is a real wall. */
export const STARTERS = ["hodag", "squonk", "agropelter", "jackalope", "tatzelwurm"] as const;
export const PICKS = 3;
/** What the Book says over each one the first time (content/landing.json, `bun run cms`); after that, `bookSays`. */
const BOOK_SAYS: Record<(typeof STARTERS)[number], string> = LANDING.starters;

/** The line-up: three to start, a slot more for each region's mythic beaten, five at most (#3031). */
export const PARTY_FIRST = 3, PARTY_MAX = 5;
/** Every cryptid you own, line-up and Compendium together: bind past it and you release one first (#3031). */
export const OWN_MAX = 9;
/** The line-up a save from before the cap could hold; `loadJourney` moves the extra into the Compendium. */
const PARTY_OLD = 6;
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
  const hand = HAND[g.id];
  if (!hand) return [];
  return hand.map(([name, lore, wilds, keeper], k) => ({ k, name, lore, wilds, keeper, level: sectionLevel(g.n, k) }));
}
/** Regions with a trail: the playable ones. The high-level south keeps its roaming deadly wilds and no sections. */
export const hasTrail = (g: Region) => g.tier === "playable";

// --- one creature you own --------------------------------------------------------------------------------------
/** When and where the ink held, and the level it was at: the bestiary's ledger reads it back against the level now.
 * A save from before the book kept dates has none. */
export const Caught = obj({ at: num(0, 1e14), where: str(120), level: int(1, 100) });
export type Caught = Of<typeof Caught>;
/** Where the starters come from: the Book's own page. */
export const BOOK_PAGE = "the Book's own page, Pine Barrens";
/** What a save from before the Book gave out its own five wrote there instead. */
const OLD_PAGE = "the Bog Witch's sheet, Pine Barrens";

export const Member = obj({
  id: str(64), level: int(1, 100), xp: int(0, 10_000_000),
  /** Health left, as a fraction of full (0 is knocked out). Missing is whole: a fight starts from it and a campfire clears it. */
  hp: opt(num(0, 1)),
  caught: opt(Caught),
});
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

/** How a lone wild one grows to face a team of 2, 3 or 4 (#4411), from the tuner's team tables
 * (`bun scripts/tune.ts --teams 20 8 0 1 2.5 2 --rust`, and 3 and 4 friends): at these, the friends win about half
 * the time in 25-30 s, with no ring-outs. Levels barely move a team fight (a wild one 15 levels up still loses 98% to two).
 * The sim's pile-on (sim.ts PILE_ON, #4441, #4628) cuts the knockback, stun and damage it takes from each foe past the
 * first, so it holds out without growing much health and its hits stay a share of a bar: four friends once needed 18x
 * damage (three bars a hit), then 8x (about one). */
export const OUTNUMBERED: Record<2 | 3 | 4, { hp: number; edge: number }> = { 2: { hp: 1, edge: 2.5 }, 3: { hp: 1.25, edge: 3.5 }, 4: { hp: 1.25, edge: 5 } };
/** A creature facing `foes` at once: one on one it is `c` itself, unchanged. */
export function outnumbered(c: Creature, foes: number): Creature {
  const g = OUTNUMBERED[Math.min(4, foes) as 2 | 3 | 4];
  return foes < 2 || !g ? c : { ...c, hpScale: (c.hpScale ?? 1) * g.hp, edge: c.edge * g.edge };
}

/** Health a member carries into a fight, as a fraction of full. */
export const hpOf = (m: Member) => m.hp ?? 1;
/** Records what a fight left of `m` (a fraction of full health); at or above full it is whole again. */
export function wound(m: Member, frac: number) {
  const f = clamp(frac, 0, 1);
  if (f >= 1) delete m.hp; else m.hp = f;
}
/** A campfire: the whole line-up back to full health. How many were hurt. */
export function heal(j: Journey): number {
  let n = 0;
  for (const m of j.party) if (m.hp !== undefined) { delete m.hp; n++; }
  return n;
}
/** Wild food picked on the way: every hurt member gets `frac` of its health back (a downed one gets up). How many it helped. */
export function mend(j: Journey, frac: number): number {
  let n = 0;
  for (const m of j.party) if (m.hp !== undefined) { wound(m, m.hp + frac); n++; }
  return n;
}
/** Line-up slots knocked out and not yet healed. */
export const downed = (j: Journey) => new Set(j.party.flatMap((m, i) => (hpOf(m) <= 0 ? [i] : [])));

/** Gives `m` the XP for beating a creature of `foeLevel`; how many levels it went up. */
export function gainXp(m: Member, foeLevel: number): number {
  m.xp += foeLevel * 10;
  let up = 0;
  while (m.xp >= toNext(m.level) && m.level < 100) { m.xp -= toNext(m.level); m.level++; up++; }
  return up;
}

// --- binding: the Book's ink -----------------------------------------------------------------------------------
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
  party: arr(Member, PARTY_OLD, { min: 1 }),
  journal: arr(Member, 500, { drop: true }),
  seen: arr(str(64), 500, { drop: true }),
  /** Region number -> sections cleared (0 to SECTIONS). */
  cleared: rec(int(0, SECTIONS), 64),
  /** Section pages written into the journal, "n:k". */
  pages: arr(str(16), 2000, { drop: true }),
  /** Places (src/world/poi.ts, by id): tapes watched, campfires lit, landmarks seen. */
  found: arr(str(40), 2000, { drop: true }),
  fires: arr(str(40), 2000, { drop: true }),
  sights: arr(str(40), 2000, { drop: true }),
  /** Sighting-board contracts (src/world/hunts.ts, by board id): 0 taken, 1-3 signs read, 4 closed. */
  hunts: opt(rec(int(0, 4), 500)),
  /** Nights begun on this journey (src/world/night.ts); missing until the first, which Gary walks with you. */
  nights: opt(int(0, 1_000_000)),
  /** The Book's talks (src/book.ts): which it has had, the reply you gave to each, and what it calls you now. */
  talk: opt(obj({
    heard: arr(str(40), 500, { drop: true }), said: rec(str(32), 500), nick: opt(str(40)),
    /** The region number each reply was given in, by talk id, so a callback says truly where you said it. */
    at: opt(rec(int(1, 64), 500)),
    /** The ledger's notes on you, from your replies; lost fights in a row. */
    notes: opt(arr(str(120), 20, { drop: true })), losses: opt(int(0, 1000)),
    /** Spare drops of ink a reply earned, spent on the next world fight; the kind of beast you asked the Book to want next. */
    ink: opt(int(0, 3)), wants: opt(oneOf(ARCHETYPES)),
  })),
  /** The three factions behind you (src/factions/model.ts): who you met and in what order, the quest steps done, the
   * flags, and each one's standing with you. */
  factions: opt(Factions),
  /** The believers at each region's first campfire (src/believers.ts), by group id: how many of their region's
   * sections you had cleared when you last sat with them. Missing until you meet them. */
  believers: opt(rec(int(0, SECTIONS), 64)),
  /** The cryptids you let go, where and at what level: the wild ones there answer to them (src/released.ts). */
  released: opt(arr(Released, 200, { drop: true })),
});
export type Journey = Of<typeof Journey>;

export const SAVE_KEY = "mythic-masters.journey";

/** What the Book says over a starter on its page (#4174): its own line the first time; on a journey after that, what
 * became of the one you took last time (it led, it came back flat, you shelved it, you never fought it), or that you
 * left it in the Book. `last` is the journey about to burn. */
export function bookSays(id: (typeof STARTERS)[number], last: Journey | null): string {
  if (!last) return BOOK_SAYS[id];
  const name = creature(id).name, was = [...last.party, ...last.journal].find((m) => m.id === id && m.caught?.where === BOOK_PAGE);
  if (!was) return `You left the ${name} in me last time. It noticed.`;
  const lvl = was.level, fresh = lvl <= 5;
  if (last.starter === id) return fresh ? `The ${name} led for you last time and never got past level 5. It wants a second go.`
    : `The ${name} led for you last time. Level ${lvl}, and it came back expecting to lead again.`;
  if (last.journal.includes(was)) return `You took the ${name}, then shelved it on my back pages. It came back level ${lvl}, sulking.`;
  if (hpOf(was) <= 0) return `The ${name} came back to me flat out. Level ${lvl}. It has not forgiven you.`;
  // two that never fought don't get the same line: the second pick is bored, the third only came for the walk
  if (fresh) return last.party.indexOf(was) === 1 ? `You took the ${name} and never fought it. It came back level 5 and bored.`
    : `You took the ${name} for the walk and nothing else. Still level 5. Still hungry.`;
  return `You took the ${name} last time. It came back level ${lvl} and twice as hungry.`;
}

/** A fresh journey with three different starters (the first leads); null for any other choice. */
export function newJourney(picks: readonly string[], at = Date.now()): Journey | null {
  const ids = [...new Set(picks)];
  if (ids.length !== PICKS || !ids.every((id) => STARTERS.some((s) => s === id))) return null;
  return { v: 1, starter: ids[0]!, party: ids.map((id) => ({ id, level: 5, xp: 0, caught: { at, where: BOOK_PAGE, level: 5 } })), journal: [], seen: [...ids], cleared: {}, pages: [], found: [], fires: [], sights: [] };
}
/** A stored journey, or null when it's missing or not one (a broken save starts a new game, it doesn't crash this one). */
export function loadJourney(text: string | null): Journey | null {
  if (!text) return null;
  let j: Journey | null;
  try { j = check(Journey, JSON.parse(text)); } catch { return null; }
  // the five used to come from someone else's sheet: they were always the Book's
  for (const m of j ? [...j.party, ...j.journal] : []) if (m.caught?.where === OLD_PAGE) m.caught.where = BOOK_PAGE;
  // the line-up shrank to five (#3031): the ones past it rest in the Compendium (a save over nine keeps them all, but binds nothing more)
  if (j && j.party.length > PARTY_MAX) j.journal.unshift(...j.party.splice(PARTY_MAX));
  return j;
}

export const cleared = (j: Journey, n: number) => j.cleared[n] ?? 0;
/** How many the line-up holds now: a slot for every region whose mythic you've beaten (its trail all cleared). */
export const slots = (j: Journey) => Math.min(PARTY_MAX, PARTY_FIRST + Object.values(j.cleared).filter((k) => k >= SECTIONS).length);
export const owns = (j: Journey, id: string) => [...j.party, ...j.journal].some((m) => m.id === id);
/** How many more the Book has room for before you must release one. */
export const roomLeft = (j: Journey) => Math.max(0, OWN_MAX - j.party.length - j.journal.length);
export function see(j: Journey, id: string) { if (!j.seen.includes(id)) j.seen.push(id); }

/** A bound creature joins the line-up, or the journal when the line-up is full. Where it went: "full" when the Book
 * already holds OWN_MAX, and nothing is added. `where` is the place the ink held (a section and its region), written
 * into its ledger with the time. */
export function bind(j: Journey, id: string, level: number, where = "", at = Date.now()): "party" | "journal" | "full" {
  see(j, id);
  if (!roomLeft(j)) return "full";
  const m: Member = { id, level, xp: 0, caught: { at, where, level } };
  if (j.party.length < slots(j)) { j.party.push(m); return "party"; }
  j.journal.push(m);
  return "journal";
}

/** What a result note says after a bind: where the creature went. `name` is written as given (escape it for a page). */
export const boundLine = (name: string, level: number, went: "party" | "journal" | "full") =>
  went === "party" ? `${name} (level ${level}) joined your line-up.`
  : went === "journal" ? `Your line-up is full, so ${name} (level ${level}) went into the Compendium.`
  : `The Book already holds ${OWN_MAX}, so the ink would not take ${name}. Release one to make room.`;

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
  const [m] = j.party.splice(i, 1);
  delete m!.hp; // a rest in the journal heals
  j.journal.push(m!);
  return true;
}
/** Lets line-up slot i (`from` "party") or Compendium entry i ("journal") go, for good, in region `n`: the line-up
 * keeps at least one. The wild ones there answer to it (src/released.ts). What was released, or null. */
export function release(j: Journey, from: "party" | "journal", i: number, n: number, at = Date.now()): Member | null {
  const list = from === "party" ? j.party : j.journal;
  if (!list[i] || (from === "party" && j.party.length <= 1)) return null;
  const [m] = list.splice(i, 1);
  (j.released ??= []).push({ id: m!.id, level: m!.level, n, at });
  return m!;
}
/** Calls journal entry e into the line-up: into a free slot, or swapped with slot `into` when it's full. */
export function call(j: Journey, e: number, into = slots(j) - 1): boolean {
  const m = j.journal[e];
  if (!m) return false;
  if (j.party.length < slots(j)) { j.journal.splice(e, 1); j.party.push(m); return true; }
  const out = j.party[into];
  if (!out) return false;
  j.party[into] = m; j.journal[e] = out;
  return true;
}

/** The line-up slot that fights next when `out` (slots already knocked out this fight) are down; -1 when none is left. */
export const nextUp = (j: Journey, out: ReadonlySet<number>) => j.party.findIndex((_, i) => !out.has(i));

/** What the night's stalker tears off whoever is up when it has you (#4387), as a fraction of full health. */
export const MAULED = 0.4;
/** Caught off the paths at night: it strikes before the fight starts, so the member up starts hurt (a sliver left, never
 *  knocked out). Which slot it hit; -1 with nobody standing. */
export function maul(j: Journey): number {
  const i = nextUp(j, downed(j)), m = j.party[i];
  if (!m) return -1;
  wound(m, Math.max(0.05, hpOf(m) - MAULED));
  return i;
}

/** Every playable region, for the journal's region pages. */
export const TRAIL_REGIONS = REGIONS.filter(hasTrail);
/** Every trail's mythic beaten (#3279): the Book's title reads "Contacts" from then on, and its pages name each beast's friends. */
export const contacted = (j: Journey | null) => !!j && TRAIL_REGIONS.every((g) => cleared(j, g.n) >= SECTIONS);
