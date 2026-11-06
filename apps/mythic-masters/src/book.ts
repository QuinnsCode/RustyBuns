// The Book talks back (#3532). At a story beat (the first open, the first bind, a member down, the whole line-up down,
// a campfire, a trail's end, a region's mythic) the journey stops and the Book says something you have to answer. The
// lines are data (content/book.json, edited with `bun run cms` and checked by `Lines` below), so a writer adds beats without touching this file. What
// you answered is kept in the save (`Journey.talk`), with the region you said it in, and quoted back later through a
// talk's `recall`. No DOM here: main.ts draws a moment and waits for the reply; book-party.ts carries a host's reply.
import { arr, int, obj, oneOf, opt, str, type Of } from "@rustybuns/util/guard";
import type { Journey } from "./journey.ts";
import { ARCHETYPES } from "./roster.ts";
import raw from "../content/book.json";

/** `bind-fail` is the ink tearing free (it opens mid-fight), `streak` a second lost fight in a row, `last-stone` the keeper before the
 * mythic beaten, `named` the first time a reply gives you a nickname. */
export const BEATS = ["open", "bind", "bind-fail", "downed", "loss", "streak", "campfire", "last-stone", "trail-end", "mythic", "named"] as const;
export type Beat = (typeof BEATS)[number];
/** The beats where the Book is laying down terms, so it signs them: the first page, the last stone, a trail's end, a mythic. */
const SIGNED: ReadonlySet<Beat> = new Set(["open", "last-stone", "trail-end", "mythic"]);
export const signedOf = (t: Talk) => SIGNED.has(t.beat);

const Reply = obj({
  id: str(32), say: str(120), book: str(240),
  /** What the Book calls you from then on. */ nick: opt(str(40)),
  /** A line it writes about you in its ledger, shown under its standing demand. */ note: opt(str(120)),
  /** Spare drops of ink it hands you for the next fight. */ ink: opt(int(1, 2)),
  /** The kind of beast its next demand names, while one is left. */ wants: opt(oneOf(ARCHETYPES)),
});
/** One thing the Book says at a beat. `from` is the lowest region number it plays in, `region` (a region id) the only region it
 * plays in, ahead of the beat's other talks; `recall` lines come first when you gave that reply ("talkId.replyId") earlier,
 * `{said}` quoting it, `{where}` and `{ago}` saying where and how far back you said it. */
const Talk = obj({
  id: str(40), beat: oneOf(BEATS), from: opt(int(1, 64)), region: opt(str(64)),
  ask: str(240), replies: arr(Reply, 3, { min: 2 }),
  recall: opt(arr(obj({ of: str(80), line: str(240) }), 8)),
});
export type Talk = Of<typeof Talk>;
export const Lines = arr(Talk, 500, { min: 1 });
/** A broken lines file fails loudly here, at load, rather than as a silent Book. */
export const LINES: readonly Talk[] = Lines(raw);

/** What a moment fills in: the region it happens in, the ledger count, the mythic, who went down, your name. */
export interface Ctx { n?: number; regionId?: string; region?: string; item?: number; mythic?: string; down?: string; name?: string }
/** A beat that found something to say: the talk, and its line with any callback in front, filled in. */
export interface Moment { talk: Talk; recall: string | null; ask: string; ctx: Ctx }

const talkOf = (j: Journey) => (j.talk ??= { heard: [], said: {} });
/** The ledger's notes on you, newest last. */
export const notesOf = (j: Journey | null) => j?.talk?.notes ?? [];
/** A fight ended: lost ones in a row so far (a win resets it). */
export function tally(j: Journey, lost: boolean): number {
  const t = talkOf(j);
  t.losses = lost ? (t.losses ?? 0) + 1 : 0;
  return t.losses;
}
/** A world fight starts: the spare ink the Book handed you goes into it, once. */
export function spendInk(j: Journey): number {
  const n = j.talk?.ink ?? 0;
  if (n && j.talk) delete j.talk.ink;
  return n;
}

/** A fight was lost: the beats to try, in order, until one has something to say. With someone left to send in, a second
 * loss in a row is a streak before it is a member down; with nobody left it is the whole line-up down, then the streak. */
export function lossBeats(lost: number, more: boolean): Beat[] {
  if (more) return lost >= 2 ? ["streak", "downed"] : ["downed"];
  return lost >= 2 ? ["loss", "streak"] : ["loss"];
}

/** How the Book names a region in a callback: the first eight by the word you would use there, the rest by name. */
const PLACES: readonly string[] = ["in the pines", "in the hollows", "in the north woods", "in the rainforest", "by the lakes", "in the desert", "in the bayou", "in the Ozarks"];
const NUMBERS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const placeOf = (n: number, name?: string) => PLACES[n - 1] ?? (name ? `in ${name}` : "out there");
/** Where a reply was given, seen from region `now`: here, there, or (an old save that never kept it) somewhere back. */
export function whereOf(at: number | undefined, now: number | undefined, name?: string): string {
  if (!at) return "back there";
  return at === now ? `here ${placeOf(at, name)}` : placeOf(at);
}
/** How long ago, in regions. */
export function agoOf(at: number | undefined, now: number | undefined): string {
  if (!at || !now || now < at) return "a while ago";
  const d = now - at;
  return d === 0 ? "not long ago" : `${NUMBERS[d] ?? d} region${d === 1 ? "" : "s"} ago`;
}

/** Fills `{key}`; a capital `{Key}` capitalises what goes in. `at` is the region the recalled reply was given in. */
function fill(text: string, j: Journey, ctx: Ctx, said = "", at?: number) {
  const vars: Record<string, string> = {
    name: ctx.name ?? "you", nick: j.talk?.nick ?? ctx.name ?? "You", item: String(ctx.item ?? 1),
    region: ctx.region ?? "these pines", mythic: ctx.mythic ?? "The mythic", down: ctx.down ?? "One of yours", said,
    where: whereOf(at, ctx.n, ctx.region), ago: agoOf(at, ctx.n),
  };
  return text.replace(/\{(\w+)\}/g, (all, k: string) => {
    const v = vars[k.toLowerCase()];
    return v === undefined ? all : k[0] === k[0]!.toUpperCase() ? v[0]!.toUpperCase() + v.slice(1) : v;
  });
}

/** The next thing the Book has to say at `beat`, or null when it has said all it has for it (or nothing for this region). */
export function momentFor(beat: Beat, j: Journey, ctx: Ctx = {}, lines: readonly Talk[] = LINES): Moment | null {
  const heard = j.talk?.heard ?? [];
  const open = lines.filter((t) => t.beat === beat && !heard.includes(t.id) && (t.from ?? 1) <= (ctx.n ?? 1) && (!t.region || t.region === ctx.regionId));
  const talk = open.find((t) => t.region) ?? open[0];
  if (!talk) return null;
  const said = j.talk?.said ?? {};
  const hit = talk.recall?.find((r) => { const [id, reply] = r.of.split("."); return !!id && said[id] === reply; });
  const of = hit?.of.split(".")[0] ?? "";
  const quoted = hit ? lines.find((t) => t.id === of)?.replies.find((r) => r.id === said[of])?.say ?? "" : "";
  return { talk, recall: hit ? fill(hit.line, j, ctx, quoted, j.talk?.at?.[of]) : null, ask: fill(talk.ask, j, ctx), ctx };
}

/** You answered: the reply goes in the save (with where you said it, its nickname, its ledger note, its ink and what it
 * asks the Book to want), and the Book's answer comes back. `named` says this reply gave you your first nickname. */
export function answer(j: Journey, m: Moment, replyId: string): { said: string; named: boolean } | null {
  const r = m.talk.replies.find((x) => x.id === replyId);
  if (!r) return null;
  const t = talkOf(j);
  if (!t.heard.includes(m.talk.id)) t.heard.push(m.talk.id);
  t.said[m.talk.id] = r.id;
  if (m.ctx.n) t.at = { ...t.at, [m.talk.id]: m.ctx.n };
  const named = !!r.nick && !t.nick;
  if (r.nick) t.nick = r.nick;
  if (r.note) t.notes = [...(t.notes ?? []), r.note].slice(-20);
  if (r.ink) t.ink = Math.min(3, (t.ink ?? 0) + r.ink);
  if (r.wants) t.wants = r.wants;
  return { said: fill(r.book, j, m.ctx), named };
}

/** In a party only the host answers; everyone else's page holds with who the Book is waiting on, until the host has
 * answered (book-party.ts) or `freed` (the host's Book asked something else, or the host is taking too long: the guest answers). */
export function holdOf(party: { host: boolean; hostName: string } | null, freed = false): { canAnswer: boolean; note: string | null } {
  if (!party || party.host) return { canAnswer: true, note: null };
  if (freed) return { canAnswer: true, note: `The Book stopped waiting on ${party.hostName}. This one is yours.` };
  return { canAnswer: false, note: `The Book is waiting on ${party.hostName}.` };
}
