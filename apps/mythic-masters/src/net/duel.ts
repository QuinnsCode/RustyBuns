// Fighting with friends: two to four pages, one fight. A duel is two friends against each other; a co-op room (#4400)
// is two to four of them on one team against a wild one, a seeded bot every page runs. The sim is deterministic, so
// nothing but the players' inputs crosses the wire, and each page plays the same fight from them: lockstep with an
// input delay. Your input for tick n is sampled DELAY ticks early and sent at once, so by the time any page plays
// tick n every seat's input is usually in; when one isn't, that page waits a frame instead of guessing. The room
// (edge/duel.ts) seats them, holds their picks until all are in, and relays each seat's inputs to the rest. Every
// SUM_EVERY ticks each page sends a hash of the fight; if two ever disagree, the room says so and the fight is off.
//
// Pure, so the room, the page (net/duel-link.ts) and the tests run the same rules.
import { clamp } from "@rustybuns/util";
import { arr, Bad, bool, check, int, nul, obj, oneOf, opt, str, type Guard } from "@rustybuns/util/guard";
import { IDLE, type Input, type Match } from "../sim.ts";

/** A duel's room code: what `?duel=` carries and the challenge's link names. */
export const DUEL_CODE = /^[A-Z0-9]{6,12}$/;
export const duelCode = (search: string) => (new URLSearchParams(search).get("duel") ?? "").toUpperCase().match(DUEL_CODE)?.[0] ?? null;
/** A co-op room's code: what `?coop=` carries. */
export const coopCode = (search: string) => (new URLSearchParams(search).get("coop") ?? "").toUpperCase().match(DUEL_CODE)?.[0] ?? null;
/** Chairs in a room: a duel seats two, a co-op room up to four (and starts with two or more). */
export const SEATS = { duel: 2, coop: 4 } as const;
export type RoomKind = keyof typeof SEATS;
const LETTERS = "BCDFGHJKLMNPQRSTVWXZ23456789";
/** A fresh room code for a challenge. */
export const mintDuel = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => LETTERS[b % LETTERS.length]).join("");

/** Ticks sent at most in one message (half a second): a page that stalled sends what it owes in a few. */
export const BATCH = 30;
/** Our played inputs kept for a resend (two seconds). */
const KEEP = 120;
/** Ticks of waiting between nudges (half a second). */
const NUDGE = 30;
/** A fight hash goes out every this many ticks. */
export const SUM_EVERY = 60;
/** Input delay bounds (ticks): never under 3 (50 ms), never over 10 (a laggy link plays heavy rather than stalling). */
export const DELAY = { min: 3, max: 10 } as const;
/** The delay a round trip of `rttMs` wants: half of it, in ticks, plus two for a frame's jitter. */
export const delayFor = (rttMs: number) => clamp(Math.ceil(rttMs / 2 / (1000 / 60)) + 2, DELAY.min, DELAY.max);

// --- inputs on the wire ------------------------------------------------------------------------------
const BUTTONS = ["up", "down", "light", "heavy", "special", "ultimate", "guard", "dash", "big"] as const;
/** One tick's input: the move stick in 127ths, and the buttons as bits. */
export type Packed = [number, number, number];
export const pack = (i: Input): Packed => [Math.round(clamp(i.mx, -1, 1) * 127), Math.round(clamp(i.mz, -1, 1) * 127), BUTTONS.reduce((b, k, n) => (i[k] ? b | (1 << n) : b), 0)];
/** Both pages play what came off the wire, the sender included, so a stick rounds the same way on each. */
export function unpack([x, z, b]: Packed): Input {
  const i: Input = { ...IDLE, mx: x / 127, mz: z / 127 };
  const l = Math.hypot(i.mx, i.mz);
  if (l > 1) { i.mx /= l; i.mz /= l; }
  for (const [n, k] of BUTTONS.entries()) i[k] = (b & (1 << n)) !== 0;
  return i;
}
const STICK = int(-127, 127), KEYBITS = int(0, 2 ** BUTTONS.length - 1);
const PACKED: Guard<Packed> = (v) => {
  const a = arr((x: unknown) => x, 3, { min: 3 })(v);
  return [STICK(a[0]), STICK(a[1]), KEYBITS(a[2])];
};

/** A cheap hash of where the fight stands: if two pages ever disagree on it, they are no longer playing the same fight. */
export function sum(m: Match): number {
  const v = new Float64Array([m.tick, ...m.f.flatMap((f) => [f.pos.x, f.pos.y, f.pos.z, f.hp, f.energy, f.stamina, f.launch])]);
  let h = 0x811c9dc5;
  for (const byte of new Uint8Array(v.buffer)) h = Math.imul(h ^ byte, 0x01000193) >>> 0;
  return h;
}

// --- the messages ------------------------------------------------------------------------------------
/** Who fights: a line-up member's creature and level (journey.ts `asCreature`), read the same on both pages. */
export interface Pick { c: string; lv: number }
const PICK = obj({ c: str(40, { re: /^[a-z0-9-]{1,40}$/ }), lv: int(1, 100) });
/** A wild den's or a keeper's creature a co-op room fights (#4413): the den as the world names it (`12,34`,
 *  `keeper:3:1`, party.ts DEN), and who lives there at what level. Seat 0 brings it; the room checks it (dens.ts `holds`). */
export interface DenFoe { den: string; c: string; lv: number }
const DEN_FOE = obj({ den: str(48, { re: /^[a-z0-9:.,_-]{1,48}$/ }), c: str(40, { re: /^[a-z0-9-]{1,40}$/ }), lv: int(1, 200) });
/** A page to the room: who it picks (again, for a rematch), inputs from tick `n` of round `r`, a fight hash, a ping. */
export type DuelIn =
  | ({ e: "pick"; foe?: DenFoe } & Pick)
  | { e: "in"; r: number; n: number; i: Packed[] }
  | { e: "sum"; r: number; n: number; h: number }
  | { e: "echo"; at: number };
const ROUND = int(1, 1e6), TICK = int(1, 1e6), PICK_C = str(40, { re: /^[a-z0-9-]{1,40}$/ }), PICK_LV = int(1, 100);
const CLIENT: Guard<DuelIn> = (v) => {
  const e = typeof v === "object" && v !== null && "e" in v ? v.e : undefined;
  if (e === "pick") { const p = obj({ c: PICK_C, lv: PICK_LV, foe: opt(DEN_FOE) })(v); return { e: "pick", c: p.c, lv: p.lv, ...(p.foe && { foe: p.foe }) }; }
  if (e === "in") return obj({ e: oneOf(["in"]), r: ROUND, n: TICK, i: arr(PACKED, BATCH, { min: 1 }) })(v);
  if (e === "sum") return obj({ e: oneOf(["sum"]), r: ROUND, n: TICK, h: int(0, 2 ** 32 - 1) })(v);
  return obj({ e: oneOf(["echo"]), at: int(0, 1e15) })(v);
};
export const parseDuelIn = (raw: unknown): DuelIn | null => check(CLIENT, raw);

/** The room to a page. `seats`: who is in, one entry a chair (your seat is `you`), and who has picked; `go`: round `r`
 *  starts with one pick a seat, and `seed` for the co-op room's wild one (or `foe`, the den's creature seat 0 walked into); `in`: seat `s`'s inputs; `from`: the room
 *  missed yours, send again from tick `n`; `desync`: two pages played round `r` differently, so it's off. */
export type DuelOut =
  | { t: "seats"; you: number; names: (string | null)[]; picked: boolean[] }
  | { t: "go"; r: number; picks: Pick[]; seed: number; foe?: DenFoe }
  | { t: "in"; s: number; r: number; n: number; i: Packed[] }
  | { t: "desync"; r: number; n: number }
  | { t: "from"; r: number; n: number }
  | { t: "echo"; at: number };
const NAME = nul(str(40, { min: 0 })), SEAT = int(0, SEATS.coop - 1);
const SERVER: Guard<DuelOut> = (v) => {
  const t = typeof v === "object" && v !== null && "t" in v ? v.t : undefined;
  if (t === "seats") {
    const s = obj({ t: oneOf(["seats"]), you: SEAT, names: arr(NAME, SEATS.coop, { min: 2 }), picked: arr(bool(), SEATS.coop, { min: 2 }) })(v);
    if (s.names.length !== s.picked.length || s.you >= s.names.length) throw new Bad("a name and a pick for every chair, yours among them");
    return s;
  }
  if (t === "go") return obj({ t: oneOf(["go"]), r: ROUND, picks: arr(PICK, SEATS.coop, { min: 2 }), seed: int(1, 2 ** 31 - 1), foe: opt(DEN_FOE) })(v);
  if (t === "in") return obj({ t: oneOf(["in"]), s: SEAT, r: ROUND, n: TICK, i: arr(PACKED, BATCH, { min: 1 }) })(v);
  if (t === "desync") return obj({ t: oneOf(["desync"]), r: ROUND, n: TICK })(v);
  if (t === "from") return obj({ t: oneOf(["from"]), r: ROUND, n: TICK })(v);
  return obj({ t: oneOf(["echo"]), at: int(0, 1e15) })(v);
};
export const decodeDuel = (raw: unknown): DuelOut | null => check(SERVER, raw);

// --- lockstep ----------------------------------------------------------------------------------------
/**
 * One round's inputs, every seat's. The page asks `next(sample)` once per tick it wants to play: it makes our input for
 * DELAY ticks ahead (the first DELAY are idle on every page), and answers every seat's input for the next tick, seat 0
 * first, or null while someone's hasn't come. `outbox` is what to send, a batch at a time.
 */
export class Lockstep {
  private mine = new Map<number, Packed>();
  /** The others' inputs by seat, then by tick. */
  private theirs: Map<number, Packed>[];
  private made = 0;
  private sent = 0;
  /** The next tick to play. */
  tick = 1;
  /** Ticks in a row we've waited on someone's input. */
  waited = 0;

  constructor(readonly seat: number, readonly r: number, readonly delay: number, readonly seats = 2) {
    this.theirs = Array.from({ length: seats }, () => new Map());
  }

  /** Inputs off the wire from seat `s` for ticks `n`, `n+1`, ... */
  hear(n: number, i: readonly Packed[], s = this.seat ? 0 : 1) {
    const got = this.theirs[s];
    if (!got || s === this.seat) return;
    i.forEach((p, k) => { if (n + k >= this.tick) got.set(n + k, p); });
  }

  /** Every seat's input for tick `this.tick`, seat 0's first, and moves on; null when someone's isn't in. */
  next(sample: () => Input): Input[] | null {
    while (this.made < this.tick + this.delay) {
      this.made++;
      this.mine.set(this.made, this.made <= this.delay ? pack(IDLE) : pack(sample()));
    }
    const t = this.tick, all = this.theirs.map((got, s) => (s === this.seat ? this.mine.get(t) : got.get(t)));
    if (all.some((p) => !p)) {
      // Waiting a while: send our last input again, so a room that dropped some of ours sees the gap and says `from`.
      if (++this.waited % NUDGE === 0 && this.sent === this.made) this.sent = this.made - 1;
      return null;
    }
    // Ours is kept a while after it's played: the room may ask for it again (`resend`).
    this.mine.delete(t - KEEP); for (const got of this.theirs) got.delete(t);
    this.tick++; this.waited = 0;
    return all.map((p) => unpack(p!));
  }

  /** The room missed some of ours (a batch over its rate): send again from tick `n`. */
  resend(n: number) { if (n >= 1 && n <= this.sent + 1 && this.mine.has(n)) this.sent = n - 1; }

  /** Our inputs not sent yet, a batch at a time: `{ n, i }` per message. */
  outbox(): { n: number; i: Packed[] }[] {
    const out: { n: number; i: Packed[] }[] = [];
    while (this.sent < this.made) {
      const n = this.sent + 1, i: Packed[] = [];
      for (let t = n; t <= this.made && i.length < BATCH; t++) i.push(this.mine.get(t) ?? pack(IDLE));
      out.push({ n, i });
      this.sent += i.length;
    }
    return out;
  }
}
