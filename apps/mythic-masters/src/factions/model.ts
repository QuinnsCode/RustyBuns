// The three factions behind you (docs/FACTIONS.md): the Office, the Institute and the Lamplighters. This file is the
// shape of their words (content/faction-*.json) and of what the save keeps about them. No logic here: engine.ts plays
// it, read.ts takes the reading, weave.ts ties the three together.
//
// A line is picked, never rolled: every slot is a list of `Line`s, each with an optional `when`, and the one whose
// `when` holds and asks the most wins (engine.ts `pick`). So the order you did things in, how long you were away and
// how you talk to someone each change what is said, from data.
import { arr, bool, int, num, obj, oneOf, opt, rec, str, type Of } from "@rustybuns/util/guard";
import { FIELDS } from "../fields.ts";

export const FACTIONS = ["office", "institute", "lamplighters"] as const;
export type FactionId = (typeof FACTIONS)[number];

/** How you answer someone: plainly, with a joke, or with your back up. Every question offers one reply of each. */
export const STYLES = ["straight", "dry", "hard"] as const;
export type Style = (typeof STYLES)[number];
/** How long since you last spoke to this person: never, under an hour, under a day, a day or more. */
export const GAPS = ["first", "soon", "later", "long"] as const;
export type Gap = (typeof GAPS)[number];
/** Where you stand with a faction, now (P) and over the whole journey (I). */
export const BANDS = ["cold", "cool", "even", "warm", "close"] as const;
export type Band = (typeof BANDS)[number];
/** Which way it has been going over your last few dealings (D). */
export const TRENDS = ["falling", "steady", "rising"] as const;
export type Trend = (typeof TRENDS)[number];
/** What a faction counted of your journey the moment it met you. */
export const COUNTS = ["fires", "tapes", "sights", "hunts", "binds", "nights", "regions"] as const;
export type Count = (typeof COUNTS)[number];

/** Things that happen outside one faction's own quest, which the other factions have a line about (`echoes`). The
 * first five are your own deeds; the rest are set by a reply or a fight in the faction named. */
export const HOOKS = [
  "mythic-bound", "mythic-loose", "hunt-closed", "binds-8", "binds-16", "long-away",
  "office-file", "office-gary", "protocol-quiet", "cache-burned", "quist-turned", "office-closed",
  "sample-given", "reagent-taken", "squonk-lent", "specimen-freed", "toby-out", "institute-closed",
  "lamp-carried", "message-run", "ridge-promise", "annex-raided", "bay-held", "lamplighters-closed",
] as const;
export type Hook = (typeof HOOKS)[number];

const FLAG = /^[a-z0-9-]{2,40}$/, PAGE = /^[1-8]:(\d|1[01])$/, STAGE = /^(office|institute|lamplighters)\.[1-8]$/;
const flags = (max = 8) => opt(arr(str(40, { re: FLAG }), max));
const pages = opt(arr(str(5, { re: PAGE }), 12));
const stages = opt(arr(str(16, { re: STAGE }), 8));
const counts = opt(obj({ fires: opt(int(0, 2000)), tapes: opt(int(0, 2000)), sights: opt(int(0, 2000)), hunts: opt(int(0, 500)), binds: opt(int(0, 500)), nights: opt(int(0, 1_000_000)), regions: opt(int(0, 64)) }));

/** When a line (or a team, or a stage) applies. Everything given must hold. The keys, for a writer:
 *  order of things   met / unmet (factions you have or have not met), first (the one you met first), done / undone
 *                    (quest stages, "office.3"), inOrder (stages done, and finished in this order), flags / noFlags
 *  before the intro  before / notBefore (section pages "n:k" you had cleared when this faction met you), had / hadUnder
 *                    (at least / fewer than this many fires, tapes, sights, hunts, binds, nights, regions at that moment)
 *  by now            been (section pages cleared), have / haveUnder (the same counts as had, as they stand now), owns / lacks
 *                    (creatures bound), starter (your first pick)
 *  time              gap (since you last spoke to this person), night
 *  manner            manner (the style you use most with this person), last (the style of your last reply to them)
 *  the reading       now, past (bands), trend; won / lost (fights against this faction, at least)
 *  company           party (you walk with friends now) */
export const When = obj({
  met: opt(arr(oneOf(FACTIONS), 3)), unmet: opt(arr(oneOf(FACTIONS), 3)), first: opt(oneOf(FACTIONS)),
  done: stages, undone: stages, inOrder: stages, flags: flags(), noFlags: flags(),
  before: pages, notBefore: pages, had: counts, hadUnder: counts,
  been: pages, have: counts, haveUnder: counts, owns: opt(arr(str(64), 6)), lacks: opt(arr(str(64), 6)), starter: opt(str(64)),
  gap: opt(arr(oneOf(GAPS), 4)), night: opt(bool()),
  manner: opt(oneOf(STYLES)), last: opt(oneOf(STYLES)),
  now: opt(arr(oneOf(BANDS), 5)), past: opt(arr(oneOf(BANDS), 5)), trend: opt(arr(oneOf(TRENDS), 3)),
  won: opt(int(1, 1000)), lost: opt(int(1, 1000)),
  party: opt(bool()),
});
export type When = Of<typeof When>;
export const WHEN_KEYS = ["met", "unmet", "first", "done", "undone", "inOrder", "flags", "noFlags", "before", "notBefore", "had", "hadUnder", "been", "have", "haveUnder", "owns", "lacks", "starter", "gap", "night", "manner", "last", "now", "past", "trend", "won", "lost", "party"] as const;

/** One way of saying something. `{you}` what the faction calls you, `{lead}` your lead creature, `{count}` how many kinds the
 * Book holds, `{place}` and `{region}` where you stand, `{met}` where this faction first met you, `{gap}` how long since
 * you last spoke ("3 days"), `{mythic}` the region's mythic. */
export const Line = obj({ text: str(280, { min: 1 }), when: opt(When) });
export type Line = Of<typeof Line>;
/** A slot: its ways of being said. One of them has no `when`, so there is always something to say. */
export const Lines = arr(Line, 12, { min: 1 });
export type Lines = Of<typeof Lines>;

/** One of a trainer's creatures: a roster id, levels over its section's own, and what its holder calls it ("Asset 14"). */
export const Mate = obj({ id: str(64), up: int(-2, 10), title: opt(str(40)) });
export type Mate = Of<typeof Mate>;
export const Team = arr(Mate, 4, { min: 1 });

export const Reply = obj({
  id: str(24, { re: /^[a-z0-9-]{1,24}$/ }), style: oneOf(STYLES),
  /** What you say (your own voice, not theirs). */ say: str(120, { min: 1 }),
  /** What they say back. */ answer: Lines,
  /** How it moves your standing with them. */ sway: int(-3, 3),
  /** Story flags it sets (a hook from HOOKS, or the faction's own). */ sets: flags(4),
  /** This reply starts the stage's fight. */ fight: opt(bool()),
  /** Spare drops of ink they hand you for the next fight. */ ink: opt(int(1, 2)),
});
export type Reply = Of<typeof Reply>;

export const Fight = obj({
  /** The team, picked like a line: the first whose `when` holds and asks the most. One has no `when`. */
  teams: arr(obj({ when: opt(When), team: Team }), 4, { min: 1 }),
  /** They are beaten / they held, and what each does to your standing. */
  youWin: Lines, youLose: Lines, swayWin: int(-3, 3), swayLose: int(-3, 3),
  setsWin: flags(4),
  /** The fight happens whatever you answer. */ always: opt(bool()),
});
export type Fight = Of<typeof Fight>;

/** One step of a faction's main quest. It opens once the step before is done and you are past section `k` of region
 * `n` (they are behind you); whoever `who` is waits at that section's stone. */
export const Stage = obj({
  id: str(16, { re: STAGE }), title: str(60, { min: 1 }), n: int(1, 8), k: int(0, 11), who: str(24),
  needs: opt(When),
  hail: Lines, ask: Lines, replies: arr(Reply, 3, { min: 3 }),
  fight: opt(Fight),
  /** What they say when you come back to a fight you lost. */ rematch: opt(Lines),
  /** One line for your record of the quest once the step is done. */ log: str(160, { min: 1 }),
});
export type Stage = Of<typeof Stage>;

/** Rank and file: the people who hold a faction's posts. */
export const Rank = obj({
  id: str(24, { re: /^[a-z0-9-]{1,24}$/ }), title: str(40, { min: 1 }), up: int(0, 3),
  /** The fields this rank likes its creatures in. */ fields: arr(oneOf(FIELDS), 4, { min: 1 }),
  hail: Lines, /** You came back for another go. */ again: Lines, youWin: Lines, youLose: Lines,
});
export type Rank = Of<typeof Rank>;
/** A post: one of a rank in section `k` of region `n`, with a line about the place. */
export const Post = obj({ n: int(1, 8), k: int(0, 10), rank: str(24), line: str(220, { min: 1 }) });
export type Post = Of<typeof Post>;
export const Person = obj({ id: str(24, { re: /^[a-z0-9-]{1,24}$/ }), name: str(40, { min: 1 }), role: str(80, { min: 1 }), sign: opt(str(40)) });
export type Person = Of<typeof Person>;

export const Faction = obj({
  id: oneOf(FACTIONS), name: str(60, { min: 1 }), short: str(30, { min: 1 }),
  /** What they call you. */ calls: str(30, { min: 1 }),
  /** What they think the Book is. They are wrong. */ theory: str(280, { min: 1 }),
  /** What you notice behind you when one of their steps opens. */ tells: arr(str(140, { min: 1 }), 6, { min: 2 }),
  people: arr(Person, 6, { min: 2 }), ranks: arr(Rank, 6, { min: 3 }), posts: arr(Post, 40, { min: 16 }),
  quest: arr(Stage, 8, { min: 8 }),
  /** Their line about each hook that is not their own doing. */ echoes: rec(Lines, 40),
  /** What a town's staff say about them, "Who: what". */ rumours: arr(str(200, { min: 1 }), 12),
});
export type Faction = Of<typeof Faction>;

/** A crossing: a line one faction says once, the next time you walk up to it, because of what you did with the
 * others and in what order. It can move your standing with them and set a flag of its own. */
export const Crossing = obj({
  id: str(40, { re: FLAG }), to: oneOf(FACTIONS), when: When, text: str(280, { min: 1 }),
  sway: opt(int(-3, 3)), sets: flags(2),
});
export type Crossing = Of<typeof Crossing>;
/** What ties the three together (content/faction-weave.json): the crossings, and which hook's echo is said first
 * when several are waiting. */
export const Weave = obj({
  order: arr(oneOf(HOOKS), 40), crossings: arr(Crossing, 80),
  /** A promise not to bind a creature: `flag` is the promise. Made while the Book already holds it, the promise came
   * too late, and `<flag>-late` is set with it, so a crossing can tell a broken promise from one that never could be kept. */
  promises: arr(obj({ flag: str(40, { re: FLAG }), creature: str(64) }), 8),
});
export type Weave = Of<typeof Weave>;

// --- the save ---------------------------------------------------------------------------------------------------
/** What a faction counted of you when it met you: the time, where, how many section pages you had, and the counts. */
export const Snapshot = obj({
  at: num(0, 1e14), n: int(1, 64), k: int(0, 11), pages: int(0, 2000),
  fires: int(0, 2000), tapes: int(0, 2000), sights: int(0, 2000), hunts: int(0, 500), binds: int(0, 500), nights: int(0, 1_000_000), regions: int(0, 64),
  /** How many of you there were. */ party: int(1, 16),
});
export type Snapshot = Of<typeof Snapshot>;
/** One person as they know you: when you last spoke, how often, and how you answered (straight, dry, hard). */
export const Known = obj({ at: num(0, 1e14), talks: int(0, 100_000), styles: arr(int(0, 100_000), 3, { min: 3 }), last: opt(oneOf(STYLES)) });
export type Known = Of<typeof Known>;
/** One faction's side of the save. `s` is your standing now, `area` the sum of your standing after every dealing and
 * `deals` how many there were (so area / deals is where you have stood on the whole), `recent` the last standings (the trend). */
export const Standing = obj({
  intro: opt(Snapshot),
  s: int(-10, 10), area: int(-10_000_000, 10_000_000), deals: int(0, 1_000_000), recent: arr(int(-10, 10), 4),
  won: int(0, 1_000_000), lost: int(0, 1_000_000),
  people: rec(Known, 12),
  /** Posts beaten, by id, and when: one comes back for another go a day later. */ beaten: rec(num(0, 1e14), 400),
  /** A stage whose talk is done and whose fight is not won yet. */ pending: opt(str(16, { re: STAGE })),
  /** Echoes this faction has said to you (hooks). */ heard: arr(str(40), 60, { drop: true }),
});
export type Standing = Of<typeof Standing>;
export const Factions = obj({
  /** The factions in the order you met them. */ met: arr(oneOf(FACTIONS), 3, { drop: true }),
  flags: arr(str(40, { re: FLAG }), 200, { drop: true }),
  /** Quest stages in the order you finished them: the order is the story. */ done: arr(str(16, { re: STAGE }), 24, { drop: true }),
  by: rec(Standing, 3),
  /** When you cleared your last few sections: your pace. */ marks: arr(num(0, 1e14), 8, { drop: true }),
  /** When you last played, to know a long time away. */ seen: opt(num(0, 1e14)),
});
export type Factions = Of<typeof Factions>;
