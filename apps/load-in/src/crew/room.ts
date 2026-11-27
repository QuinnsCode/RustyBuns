// A crew's room: who is here, where each one stands, who holds what, and where gear was last set down. Pure, so the
// Durable Object (edge/world.ts), the page (crew/online.ts) and the tests share the rules. Each player walks their own
// body and the room relays it; what the room decides is the hands: one person a piece, or two on something heavy.
import { arr, bool, check, int, nul, num, obj, oneOf, opt, str, type Of } from "@rustybuns/util/guard";

/** Players in one crew. */
export const MAX_CREW = 6;

const at = num(-1000, 1000);
const turn = num(-1e4, 1e4);
const key = str(64);
/** What a page sends: its pose (and where the piece it carries is drawn), a grab, or where it set a piece down. */
export const PoseMsg = obj({ t: oneOf(["pose"]), x: at, z: at, yaw: turn, crouch: bool(false), carry: opt(obj({ key, ...placeShape() })) });
export const GrabMsg = obj({ t: oneOf(["grab"]), key, team: bool(false) });
export const DropMsg = obj({ t: oneOf(["drop"]), key, ...placeShape() });
export type PoseMsg = Of<typeof PoseMsg>;
export type GrabMsg = Of<typeof GrabMsg>;
export type DropMsg = Of<typeof DropMsg>;
function placeShape() { return { x: at, y: at, z: at, rot: turn }; }

/** A coil lying loose on a cable's `b` end: bowled (where it left the hand, which way, how fast, and the seed that
 * wobbles it, so each page plays the same roll) or lying where it stopped. `paid` is the cable off it, in rope steps. */
export const WireRoll = obj({
  state: oneOf(["rolling", "down"]), x: at, z: at, paid: int(0, 1e5),
  dir: opt(turn), v: opt(num(0, 50)), seed: opt(int(0, 2 ** 32 - 1)),
});
export type WireRoll = Of<typeof WireRoll>;
/** Where one end of a cable is, as the room keeps it: coiled in the case, in a jack, in someone's hand (`hand` names
 * them), or lying loose where it was let go (with its coil, if it is the `b` end and not all paid out). A page sends
 * `hand` as "" for its own. */
export const WireEnd = obj({
  at: oneOf(["case", "plug", "hand", "loose"]),
  plug: opt(arr(key, 2, { min: 2 })), hand: opt(str(200, { min: 0 })), x: opt(at), y: opt(at), z: opt(at),
  roll: opt(WireRoll),
});
export type WireEnd = Of<typeof WireEnd>;
/** One end of a cable moved on your page: taken, plugged, dropped, or (with the twists it was coiled with) back in the case. */
export const EndMsg = obj({ t: oneOf(["end"]), key, end: oneOf(["a", "b"]), to: WireEnd, twists: opt(int(0, 1000)) });
export type EndMsg = Of<typeof EndMsg>;
/** A switch thrown on your page: an amp, a powered speaker, a desk. The room keeps it, so the whole crew hears the same system. */
export const SwitchMsg = obj({ t: oneOf(["switch"]), key, on: bool() });
export type SwitchMsg = Of<typeof SwitchMsg>;
/** Taking the DJ seat, or leaving it: one pair of hands on the decks at a time. */
export const DjMsg = obj({ t: oneOf(["dj"]), take: bool() });
export type DjMsg = Of<typeof DjMsg>;
const deckSet = () => ({
  /** Each deck: playing, its pitch, where in the track, the track's own tempo, and the FM DAW sesh it is ("" for the deck's own). */
  deck: arr(obj({ playing: bool(), pitch: num(-8, 8), beat: num(0, 1e6), bpm: num(40, 240), sesh: str(64, { min: 0, re: /^[a-z0-9-]*$/ }) }), 2, { min: 2 }),
  fader: arr(num(0, 1), 4, { min: 4 }), cross: num(-1, 1),
  /** The dance floor's mood on the DJ's page (audio/set-mood.ts), so a page that joins late starts where the room is. */
  mood: num(0, 100, 50),
});
/** The decks as the DJ's page has them now: what plays, how fast, where in the track, and the mixer. */
export const DecksMsg = obj({ t: oneOf(["decks"]), ...deckSet() });
export type DecksMsg = Of<typeof DecksMsg>;
/** The decks as the room keeps them: the DJ's last word, when it came on the room's clock (ms), and a count. */
export const Spun = obj({ n: int(1, 1e9), at: num(0, 1e15), ...deckSet() });
export type Spun = Of<typeof Spun>;
export type Sent = PoseMsg | GrabMsg | DropMsg | EndMsg | SwitchMsg | DjMsg | DecksMsg;
/** Whether an end says all it needs to: the jack it is in, or where it lies. */
export const whole = (e: WireEnd) => (e.at === "plug" ? !!e.plug : e.at === "loose" ? e.x !== undefined && e.y !== undefined && e.z !== undefined : true);

/** A message off the wire, or null if it isn't one. */
export function readSent(raw: unknown): Sent | null {
  const t = check(obj({ t: oneOf(["pose", "grab", "drop", "end", "switch", "dj", "decks"]) }), raw)?.t;
  if (t === "dj") return check(DjMsg, raw);
  if (t === "decks") return check(DecksMsg, raw);
  if (t === "switch") return check(SwitchMsg, raw);
  if (t === "end") { const m = check(EndMsg, raw); return m && whole(m.to) ? m : null; }
  return t === "pose" ? check(PoseMsg, raw) : t === "grab" ? check(GrabMsg, raw) : t === "drop" ? check(DropMsg, raw) : null;
}

export const Mate = obj({
  id: str(200), name: str(200, { min: 0 }), slot: int(0, MAX_CREW),
  x: at, z: at, yaw: turn, crouch: bool(false),
  holding: nul(key),
  carry: opt(obj({ key, ...placeShape() })),
});
export type Mate = Of<typeof Mate>;
/** A piece someone set down, with a count that goes up each time, so a page only takes a newer word than it has. */
export const Placed = obj({ key, n: int(1, 1e9), ...placeShape() });
export type Placed = Of<typeof Placed>;

/** A cable someone has touched: both ends and the twists it was coiled with, with a count that goes up each change. */
export const Wire = obj({ key, n: int(1, 1e9), a: WireEnd, b: WireEnd, twists: int(0, 1000) });
export type Wire = Of<typeof Wire>;

/** A switch someone threw, with a count that goes up each time. */
export const Thrown = obj({ key, n: int(1, 1e9), on: bool() });
export type Thrown = Of<typeof Thrown>;

/** The most a view carries: past it every page drops the whole message, so the room takes no new key beyond it. */
const KEPT = { placed: 500, cables: 100, switches: 500 };
const ViewMsg = obj({ t: oneOf(["view"]), you: str(200), mates: arr(Mate, MAX_CREW), placed: arr(Placed, KEPT.placed), cables: arr(Wire, KEPT.cables), switches: arr(Thrown, KEPT.switches),
  /** Who is on the decks (their id and name), the decks as last set, and the room's clock now (ms). */
  dj: nul(str(200)), djName: str(200, { min: 0 }), decks: opt(Spun), clock: num(0, 1e15) });
const RefusedMsg = obj({ t: oneOf(["refused"]), key, why: str(200) });
export type ServerMsg = Of<typeof ViewMsg> | Of<typeof RefusedMsg>;
/** The room's message read on the page. */
export function readServer(raw: unknown): ServerMsg | null {
  const t = check(obj({ t: oneOf(["view", "refused"]) }), raw)?.t;
  return t === "view" ? check(ViewMsg, raw) : t === "refused" ? check(RefusedMsg, raw) : null;
}

export class Crew {
  private mates = new Map<string, Mate>();
  /** Who holds each piece: one id, or two on a team carry. */
  private hands = new Map<string, string[]>();
  private switches = new Map<string, Thrown>();
  private dj: string | null = null;
  private spun: Spun | undefined;
  private placed = new Map<string, Placed>();
  private wires = new Map<string, Wire>();

  get size() { return this.mates.size; }

  /** False if the crew is full (someone already in is always let back in). */
  join(id: string, name: string): boolean {
    const had = this.mates.get(id);
    if (had) { had.name = name; return true; }
    if (this.mates.size >= MAX_CREW) return false;
    const taken = new Set([...this.mates.values()].map((m) => m.slot));
    let slot = 0;
    while (taken.has(slot)) slot++;
    this.mates.set(id, { id, name, slot, x: 0, z: 0, yaw: 0, crouch: false, holding: null });
    return true;
  }

  /** Gone: whatever they held is let go of where it is (the other end, on a team carry, stays in a friend's hands). */
  leave(id: string) {
    // The DJ walking out frees the seat; what was playing plays on.
    if (this.dj === id) this.dj = null;
    this.mates.delete(id);
    for (const [k, ids] of this.hands) {
      const rest = ids.filter((h) => h !== id);
      if (rest.length) this.hands.set(k, rest); else this.hands.delete(k);
    }
    // A cable end in their hand drops at their feet.
    const was = this.mates.get(id);
    for (const w of this.wires.values()) for (const e of ["a", "b"] as const) {
      if (w[e].at === "hand" && w[e].hand === id) { w[e] = { at: "loose", x: was?.x ?? 0, y: 0, z: was?.z ?? 0 }; w.n++; }
    }
  }

  pose(id: string, p: PoseMsg) {
    const m = this.mates.get(id);
    if (!m) return;
    Object.assign(m, { x: p.x, z: p.z, yaw: p.yaw, crouch: p.crouch, carry: p.carry && m.holding === p.carry.key ? p.carry : undefined });
  }

  /** Take a piece: free hands on it, or the second pair on a heavy one (`team`). The refusal names who has it. */
  grab(id: string, g: GrabMsg): { ok: true } | { ok: false; why: string } {
    const m = this.mates.get(id);
    if (!m) return { ok: false, why: "not in the crew" };
    const ids = this.hands.get(g.key) ?? [];
    if (ids.includes(id)) return { ok: true };
    const by = ids.map((h) => this.mates.get(h)?.name ?? "someone").join(" and ");
    if (ids.length >= 2 || (ids.length === 1 && !g.team)) return { ok: false, why: `${by} has it` };
    if (m.holding) this.letGo(id, m.holding);
    this.hands.set(g.key, [...ids, id]);
    m.holding = g.key;
    return { ok: true };
  }

  /** Set a piece down: everyone holding it lets go, and the room keeps where it landed. Ignored from empty hands. */
  drop(id: string, d: DropMsg): boolean {
    const ids = this.hands.get(d.key);
    if (!ids?.includes(id)) return false;
    for (const h of ids) { const m = this.mates.get(h); if (m) { m.holding = null; m.carry = undefined; } }
    this.hands.delete(d.key);
    if (!this.placed.has(d.key) && this.placed.size >= KEPT.placed) return false;
    const n = (this.placed.get(d.key)?.n ?? 0) + 1;
    this.placed.set(d.key, { key: d.key, n, x: d.x, y: d.y, z: d.z, rot: d.rot });
    return true;
  }

  /** Move one end of a cable: not out of a friend's hand, and not into a jack another end already fills. */
  end(id: string, m: EndMsg): { ok: true } | { ok: false; why: string } {
    if (!this.mates.has(id)) return { ok: false, why: "not in the crew" };
    if (!this.wires.has(m.key) && this.wires.size >= KEPT.cables) return { ok: false, why: "no room for another cable" };
    const w = this.wires.get(m.key) ?? { key: m.key, n: 0, a: { at: "case" }, b: { at: "case" }, twists: 0 };
    const cur = w[m.end];
    if (cur.at === "hand" && cur.hand !== id) return { ok: false, why: `${this.mates.get(cur.hand ?? "")?.name ?? "someone"} has that end` };
    const jack = m.to.plug?.join(" ");
    if (m.to.at === "plug" && [...this.wires.values()].some((o) => (["a", "b"] as const).some((e) => !(o === w && e === m.end) && o[e].at === "plug" && o[e].plug?.join(" ") === jack))) {
      return { ok: false, why: `${jack} already has a cable in it` };
    }
    w[m.end] = m.to.at === "hand" ? { at: "hand", hand: id } : m.to;
    if (m.twists !== undefined) w.twists = m.twists;
    w.n++;
    this.wires.set(m.key, w);
    return { ok: true };
  }

  /** Take the DJ seat or leave it. One DJ at a time: the refusal names who is on the decks. */
  seat(id: string, take: boolean): { ok: true } | { ok: false; why: string } {
    if (!this.mates.has(id)) return { ok: false, why: "not in the crew" };
    if (!take) { if (this.dj === id) this.dj = null; return { ok: true }; }
    if (this.dj && this.dj !== id) return { ok: false, why: `${this.mates.get(this.dj)?.name ?? "someone"} is on the decks` };
    this.dj = id;
    return { ok: true };
  }

  /** The DJ's word on the decks, kept with the room's time (`now`, ms). Ignored from anyone else. */
  spin(id: string, m: DecksMsg, now: number): boolean {
    if (this.dj !== id) return false;
    this.spun = { n: (this.spun?.n ?? 0) + 1, at: now, deck: m.deck, fader: m.fader, cross: m.cross, mood: m.mood };
    return true;
  }

  /** Throw a switch: the last hand on it wins. */
  throw(id: string, m: SwitchMsg) {
    if (!this.mates.has(id) || (!this.switches.has(m.key) && this.switches.size >= KEPT.switches)) return;
    this.switches.set(m.key, { key: m.key, n: (this.switches.get(m.key)?.n ?? 0) + 1, on: m.on });
  }

  private letGo(id: string, k: string) {
    const rest = (this.hands.get(k) ?? []).filter((h) => h !== id);
    if (rest.length) this.hands.set(k, rest); else this.hands.delete(k);
  }

  /** The room as `id` sees it: everyone else, every piece set down so far, and every cable touched. */
  view(id: string, now = 0): Extract<ServerMsg, { t: "view" }> {
    return { t: "view", you: id, mates: [...this.mates.values()].filter((m) => m.id !== id), placed: [...this.placed.values()], cables: [...this.wires.values()], switches: [...this.switches.values()],
      dj: this.dj, djName: this.dj ? this.mates.get(this.dj)?.name ?? "" : "", decks: this.spun, clock: now };
  }
}
