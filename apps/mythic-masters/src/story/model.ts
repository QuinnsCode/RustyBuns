// The story bible's shape (docs/STORY.md). Every storyline in Mythic Masters is data in content/story.json: arcs of
// beats, each beat pinned to a real place in the game (a trail section, a faction stage, a sighting board, a lair), and
// for every region a list of what its world should hold. `bun run story` checks it against the game and draws the map;
// `bun run story --serve` opens the map with every beat editable. No DOM and no three.js here.
//
// Four kinds of arc, the way a player meets them:
//   main    the Book's ledger, region to region; you cannot finish the game without it
//   sub     a thread that runs beside the main story over several regions (a faction, a person, a mystery)
//   side    one place, one evening: a sighting board, a tape, a job for a believer
//   unlock  what opens the next thing: a road, a line-up slot, a way to travel; each one sits at a level
// Beats the game already plays (mythics, faction stages, sighting boards) are read from the game (infer.ts), so they
// never go stale; the JSON holds only what a writer adds.
import { arr, bool, obj, oneOf, opt, str, type Of } from "@rustybuns/util/guard";

export const KINDS = ["main", "sub", "side", "unlock"] as const;
export type Kind = (typeof KINDS)[number];
/** idea: written down, not agreed. approved: the owner said yes. built: the game plays it (`at` must name it). */
export const STATUSES = ["idea", "approved", "built"] as const;
export type Status = (typeof STATUSES)[number];
/** What a region's world should hold, by sense. */
export const WANTS = ["place", "life", "weather", "sound", "people", "history", "craft"] as const;
export type WantKind = (typeof WANTS)[number];

/** A beat or arc id: lower case words joined by dashes. */
export const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Where a beat happens, one of:
 *   region:<id>            somewhere in a region
 *   section:<n>:<k>        trail section k (0-11, 11 is the mythic) of playable region n
 *   mythic:<n>             region n's mythic, in its lair
 *   stage:<faction>.<n>    a faction quest stage (content/faction-*.json)
 *   board:<n>:<k>          the sighting board in section k of region n (src/world/hunts.ts)
 *   believers:<id>         a believers' camp (src/believers.ts)
 *   lair:<pocket id>       a pocket (src/pockets.ts) */
export const ANCHOR = /^(region:[a-z0-9-]+|section:\d{1,2}:\d{1,2}|mythic:\d{1,2}|stage:(office|institute|lamplighters)\.[1-8]|board:\d{1,2}:\d{1,2}|believers:[a-z]+|lair:[a-z0-9-]+)$/;

export const Beat = obj({
  id: str(48, { re: ID }),
  title: str(80, { min: 1 }),
  /** What happens, in plain words: who, where, what the player does, what changes. */
  text: str(700, { min: 1 }),
  at: str(64, { re: ANCHOR }),
  /** Beats (in any arc) that must be done first. */
  needs: opt(arr(str(48, { re: ID }), 6)),
  /** Roster ids fought or met here. Never a sacred being. */
  fights: opt(arr(str(64), 4)),
  /** What it opens or gives (unlock beats must say). */
  opens: opt(str(160)),
  /** The owner writes these words; agents leave them as a placeholder. */
  owner: opt(bool()),
  status: oneOf(STATUSES),
});
export type Beat = Of<typeof Beat>;

export const Arc = obj({
  id: str(48, { re: ID }),
  kind: oneOf(KINDS),
  title: str(80, { min: 1 }),
  /** The whole thread in two or three sentences. */
  pitch: str(500, { min: 1 }),
  beats: arr(Beat, 40, { min: 1 }),
});
export type Arc = Of<typeof Arc>;

export const Want = obj({
  kind: oneOf(WANTS),
  what: str(240, { min: 1 }),
  /** Where in the region, when it is somewhere in particular. */
  at: opt(str(64, { re: ANCHOR })),
  status: oneOf(STATUSES),
});
export type Want = Of<typeof Want>;

export const Area = obj({
  region: str(64),
  /** How the region should feel in one or two sentences: the thing a player remembers. */
  feel: str(400, { min: 1 }),
  world: arr(Want, 40, { min: 1 }),
});
export type Area = Of<typeof Area>;

export const Story = obj({
  arcs: arr(Arc, 120, { min: 1 }),
  areas: arr(Area, 64),
});
export type Story = Of<typeof Story>;

/** A beat with where it came from: the JSON (`arc` is its arc) or the game itself (`game: true`). */
export interface Placed extends Beat { arc: string; kind: Kind; game?: boolean }
