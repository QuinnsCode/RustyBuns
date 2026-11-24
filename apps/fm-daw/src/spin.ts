// Who may spin: the decks' own rules on top of the grants (src/grants.ts). A room is in one of two modes, the host's
// call. LINEUP: a running order of slots (a person, a start on the room's clock, a length); the decks are whoever's
// slot it is now, and the next DJ may cue up on a free deck in the last CUE_MS of the slot before theirs. OPEN DECKS:
// whoever the grants let play steps up when nobody is on (their first deck command does it), the rest ask to go next
// and the queue hands on when the one on steps down. In both, the host (the grants' leaders) and the moderators they
// name refuse people the decks (`refused`: they still dance and listen), take whoever is on off at once, and edit the
// lineup. The World checks every deck command against `mayDeck`; the page only shows it. Pure: World, page, tests.
import { arr, Bad, bool, check, int, num, obj, oneOf, opt, str, type Guard, type Of } from "@rustybuns/util/guard";
import type { DeckPress, DeckSay, MixSay } from "./dj/booth.ts";

/** A person id (src/chat.ts), as the grants key them. */
const ID = str(64, { re: /^[0-9a-f]{8,64}$/ });
export const MODES = ["open", "lineup"] as const;
export type Mode = (typeof MODES)[number];
export const MAX_SLOTS = 48;
export const MAX_MODS = 16;
export const MAX_REFUSED = 64;
export const MAX_QUEUE = 32;
/** A slot is this long at most, minutes. */
export const MAX_SLOT_MIN = 240;
/** The next DJ may cue up on a free deck this long before their slot starts, ms. */
export const CUE_MS = 5 * 60_000;
const MS = num(0, 1e15);

/** One slot of a lineup: who, from when (the room's clock, ms) and for how many minutes. */
export const Slot = obj({ who: ID, at: MS, min: int(1, MAX_SLOT_MIN) });
export type Slot = Of<typeof Slot>;
/** A room's spin rules. `on`/`queue` are open decks' (who is on, who asked to go next). */
export const Spin = obj({
  mode: oneOf(MODES), mods: arr(ID, MAX_MODS), refused: arr(ID, MAX_REFUSED),
  lineup: arr(Slot, MAX_SLOTS), on: opt(ID), queue: arr(ID, MAX_QUEUE),
});
export type Spin = Of<typeof Spin>;
export const noSpin = (): Spin => ({ mode: "open", mods: [], refused: [], lineup: [], queue: [] });
export const sanitizeSpin = (v: unknown): Spin => check(Spin, v) ?? noSpin();

/** Page to World. `who` acts on someone; `ask`, `up` and `down` are for yourself. */
export type SpinOp =
  | { o: "mode"; mode: Mode } | { o: "mod"; who: string; on: boolean } | { o: "refuse"; who: string; on: boolean }
  | { o: "lineup"; slots: Slot[] } | { o: "off"; who?: string } | { o: "ask" } | { o: "up" } | { o: "down" };
const tag = <T extends string>(t: T) => oneOf([t]);
const OPS: Guard<SpinOp>[] = [
  obj({ o: tag("mode"), mode: oneOf(MODES) }), obj({ o: tag("mod"), who: ID, on: bool() }), obj({ o: tag("refuse"), who: ID, on: bool() }),
  obj({ o: tag("lineup"), slots: arr(Slot, MAX_SLOTS) }), obj({ o: tag("off"), who: opt(ID) }), obj({ o: tag("ask") }), obj({ o: tag("up") }), obj({ o: tag("down") }),
];
const SpinOpG: Guard<SpinOp> = (v) => { for (const g of OPS) { const ok = check(g, v); if (ok) return ok; } throw new Bad("a spin op"); };
export const SpinClient = obj({ t: tag("spin"), op: SpinOpG });
export type SpinClient = Of<typeof SpinClient>;
/** World to page: the rules, on every change and to whoever comes in; `off`: the person just taken off, whose page stops. */
export const SpinServer = obj({ t: tag("spin"), spin: Spin, off: opt(ID) });
export type SpinServer = Of<typeof SpinServer>;
export const decodeSpinClient = (v: unknown) => check(SpinClient, v);
export const decodeSpinServer = (v: unknown) => check(SpinServer, v);

const ends = (s: Slot) => s.at + s.min * 60_000;
/** The slot playing at `now`, or null. */
export const slotNow = (s: Spin, now: number): Slot | null => s.lineup.find((x) => x.at <= now && now < ends(x)) ?? null;
/** The next slot to start after `now`, or null. */
export const slotNext = (s: Spin, now: number): Slot | null =>
  s.lineup.filter((x) => x.at > now).sort((a, b) => a.at - b.at)[0] ?? null;
/** Slots back to back from `start`, in the order given (a reorder or an edit keeps the night's start). */
export const chain = (slots: { who: string; min: number }[], start: number): Slot[] => {
  let at = start;
  return slots.map((x) => { const s = { who: x.who, at, min: x.min }; at += x.min * 60_000; return s; });
};

/** Who runs the decks: `lead` (the grants say they lead) or a moderator the host named. */
export const runs = (s: Spin, who: string | undefined, lead: boolean) => lead || (!!who && s.mods.includes(who));
/** Who has the decks now: the slot's person (lineup) or whoever stepped up (open). */
export const onNow = (s: Spin, now: number): string | null => (s.mode === "lineup" ? slotNow(s, now)?.who ?? null : s.on ?? null);

/**
 * Whether a deck command from `who` goes through. `lead`: they lead the room. `play`: their grants let them play.
 * `freeSide`: the deck the command is about has no one else's track playing on it (a say for your own deck).
 * `holds`: they already have this very track on this deck, so a say about it lets it play out or stop after their
 * turn (the World forgets what they hold when they're taken off). A say that empties a deck is never refused.
 */
export function mayDeck(s: Spin, who: string | undefined, o: { lead: boolean; play: boolean; now: number; e: DeckSay | DeckPress | MixSay; freeSide: boolean; holds?: boolean }): { ok: true } | { ok: false; why: string } {
  if (o.e.t === "deck" && !o.e.name) return { ok: true };
  if (who && s.refused.includes(who)) return { ok: false, why: "The host took you off the decks for tonight" };
  if (o.holds && o.e.t === "deck") return { ok: true };
  if (runs(s, who, o.lead)) return { ok: true };
  if (!who) return { ok: false, why: "Say hello first" };
  if (s.mode === "lineup") {
    if (slotNow(s, o.now)?.who === who) return { ok: true };
    const next = slotNext(s, o.now);
    // the next DJ cues up in the last minutes, on a deck nobody is playing, and presses nobody else's
    if (next?.who === who && next.at - o.now <= CUE_MS && o.e.t === "deck" && o.freeSide) return { ok: true };
    return { ok: false, why: next?.who === who ? "Your slot hasn't started: cue up on a free deck in its last minutes" : "Not your slot" };
  }
  if (!o.play) return { ok: false, why: "Ask the host to let you play" };
  return !s.on || s.on === who ? { ok: true } : { ok: false, why: "Someone is on the decks: ask to go next" };
}

/** Open decks: `who` stepped up by playing (the World calls this when a deck command carrying a track goes through). */
export function stepUp(s: Spin, who: string): Spin {
  if (s.mode !== "open" || s.on) return s;
  return { ...s, on: who, queue: s.queue.filter((x) => x !== who) };
}
/** Open decks: whoever is on steps down (or left, or was taken off): the first in the queue is on, else the decks are free. */
export function stepDown(s: Spin): Spin {
  const { on: _, ...rest } = s;
  const [next, ...queue] = s.queue;
  return next ? { ...rest, on: next, queue } : { ...rest, queue };
}
/** `who` left the room: out of the queue, and off the decks if they were on. */
export function leave(s: Spin, who: string): Spin {
  const q = s.queue.filter((x) => x !== who);
  const t = q.length === s.queue.length ? s : { ...s, queue: q };
  return t.on === who ? stepDown(t) : t;
}

/** An op from `who` (`lead`: they lead; `play`: their grants let them play) at `now`; the same Spin back when it's refused. */
export function applySpin(s: Spin, op: SpinOp, who: string, o: { lead: boolean; play: boolean; now: number }): Spin {
  if (op.o === "ask") {
    if (s.mode !== "open" || !o.play || s.refused.includes(who) || s.on === who || s.queue.includes(who) || s.queue.length >= MAX_QUEUE) return s;
    return { ...s, queue: [...s.queue, who] };
  }
  if (op.o === "up") return o.play && !s.refused.includes(who) ? stepUp(s, who) : s;
  if (op.o === "down") return s.on === who ? stepDown(s) : leave(s, who);
  if (!runs(s, who, o.lead)) return s;
  if (op.o === "mod") {
    // naming moderators is the host's alone
    if (!o.lead || s.mods.includes(op.who) === op.on || (op.on && s.mods.length >= MAX_MODS)) return s;
    return { ...s, mods: op.on ? [...s.mods, op.who] : s.mods.filter((x) => x !== op.who) };
  }
  if (op.o === "mode") return op.mode === s.mode ? s : { ...s, mode: op.mode };
  if (op.o === "refuse") {
    if (s.refused.includes(op.who) === op.on || (op.on && s.refused.length >= MAX_REFUSED)) return s;
    const refused = op.on ? [...s.refused, op.who] : s.refused.filter((x) => x !== op.who);
    return op.on ? leave({ ...s, refused }, op.who) : { ...s, refused };
  }
  if (op.o === "lineup") return { ...s, lineup: [...op.slots].sort((a, b) => a.at - b.at) };
  // off: whoever is on (or `who`) comes off now; in a lineup their slot ends here and the rest keep their times
  if (s.mode === "open") return s.on && (!op.who || op.who === s.on) ? stepDown(s) : s;
  const cur = slotNow(s, o.now);
  if (!cur || (op.who && op.who !== cur.who)) return s;
  const min = Math.floor((o.now - cur.at) / 60_000);
  return { ...s, lineup: min > 0 ? s.lineup.map((x) => (x === cur ? { ...x, min } : x)) : s.lineup.filter((x) => x !== cur) };
}

/** Whether `who` may put a track on a free deck now: what the decks' panel asks before it lets you start. */
export function mayCue(s: Spin, who: string | undefined, o: { lead: boolean; play: boolean; now: number }) {
  const e: DeckSay = { t: "deck", side: 0, name: "a track", len: 1, grid: null, key: null, wave: "", cue: 0, playing: false, pos: 0, rate: 1, at: o.now };
  return mayDeck(s, who, { ...o, e, freeSide: true });
}
