// The Book talks back (#3532). At a story beat (the first open, the first bind, a member down, the whole line-up down,
// a campfire, a trail's end, a region's mythic) the journey stops and the Book says something you have to answer. The
// lines are data (book-lines.json, checked by `Lines` below), so a writer adds beats without touching this file. What
// you answered is kept in the save (`Journey.talk`) and quoted back later through a talk's `recall`. No DOM here:
// main.ts draws a moment and waits for the reply.
import { arr, bool, int, obj, oneOf, opt, str, type Of } from "@rustybuns/util/guard";
import type { Journey } from "./journey.ts";
import raw from "./book-lines.json";

export const BEATS = ["open", "bind", "downed", "loss", "campfire", "trail-end", "mythic"] as const;
export type Beat = (typeof BEATS)[number];

const Reply = obj({ id: str(32), say: str(120), book: str(240), /** What the Book calls you from then on. */ nick: opt(str(40)) });
/** One thing the Book says at a beat. `from` is the lowest region number it plays in; `recall` lines come first when
 * you gave that reply ("talkId.replyId") earlier, `{said}` quoting it. */
const Talk = obj({
  id: str(40), beat: oneOf(BEATS), from: opt(int(1, 64)), signed: opt(bool(false)),
  ask: str(240), replies: arr(Reply, 3, { min: 2 }),
  recall: opt(arr(obj({ of: str(80), line: str(240) }), 8)),
});
export type Talk = Of<typeof Talk>;
export const Lines = arr(Talk, 500, { min: 1 });
/** A broken lines file fails loudly here, at load, rather than as a silent Book. */
export const LINES: readonly Talk[] = Lines(raw);

/** What a moment fills in: the region it happens in, the ledger count, the mythic, who went down, your name. */
export interface Ctx { n?: number; region?: string; item?: number; mythic?: string; down?: string; name?: string }
/** A beat that found something to say: the talk, and its line with any callback in front, filled in. */
export interface Moment { talk: Talk; recall: string | null; ask: string; ctx: Ctx }

const talkOf = (j: Journey) => (j.talk ??= { heard: [], said: {} });

function fill(text: string, j: Journey, ctx: Ctx, said = "") {
  const vars: Record<string, string> = {
    name: ctx.name ?? "you", nick: j.talk?.nick ?? ctx.name ?? "You", item: String(ctx.item ?? 1),
    region: ctx.region ?? "these pines", mythic: ctx.mythic ?? "The mythic", down: ctx.down ?? "One of yours", said,
  };
  return text.replace(/\{(\w+)\}/g, (all, k: string) => vars[k] ?? all);
}

/** The next thing the Book has to say at `beat`, or null when it has said all it has for it (or nothing for this region). */
export function momentFor(beat: Beat, j: Journey, ctx: Ctx = {}, lines: readonly Talk[] = LINES): Moment | null {
  const heard = j.talk?.heard ?? [];
  const talk = lines.find((t) => t.beat === beat && !heard.includes(t.id) && (t.from ?? 1) <= (ctx.n ?? 1));
  if (!talk) return null;
  const said = j.talk?.said ?? {};
  const hit = talk.recall?.find((r) => { const [id, reply] = r.of.split("."); return !!id && said[id] === reply; });
  const quoted = hit ? lines.find((t) => t.id === hit.of.split(".")[0])?.replies.find((r) => r.id === said[hit.of.split(".")[0]!])?.say ?? "" : "";
  return { talk, recall: hit ? fill(hit.line, j, ctx, quoted) : null, ask: fill(talk.ask, j, ctx), ctx };
}

/** You answered: the reply goes in the save (and its nickname, if it has one), and the Book's answer comes back. */
export function answer(j: Journey, m: Moment, replyId: string): string | null {
  const r = m.talk.replies.find((x) => x.id === replyId);
  if (!r) return null;
  const t = talkOf(j);
  if (!t.heard.includes(m.talk.id)) t.heard.push(m.talk.id);
  t.said[m.talk.id] = r.id;
  if (r.nick) t.nick = r.nick;
  return fill(r.book, j, m.ctx);
}

/** In a party only the host answers; everyone else's page holds with who the Book is waiting on. */
export function holdOf(party: { host: boolean; hostName: string } | null): { canAnswer: boolean; note: string | null } {
  if (!party || party.host) return { canAnswer: true, note: null };
  return { canAnswer: false, note: `The Book is waiting on ${party.hostName}.` };
}
