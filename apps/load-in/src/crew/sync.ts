// Between your world (sim.ts) and the crew's room (room.ts): what to tell the room, and what its views do to your
// world. No socket here, so a test passes messages between two worlds and a room by hand.
import { heldItem, holdPose, seeCrew, type World } from "../sim.ts";
import { endAt, setEnd, type Cables, type EndAt } from "../cables/cables.ts";
import { whole, type Sent, type ServerMsg, type Wire, type WireEnd } from "./room.ts";
import { tickDecks, type Decks } from "../audio/decks.ts";

/**
 * The decks on this page, as the crew room sees them (venues/dj-booth-view.ts owns one): its deck state, whether you
 * want the DJ seat, and what the room last said: whether there is a room at all, and who is on the decks.
 */
export type Booth = {
  decks: Decks; want: boolean; room: boolean; dj: { me: boolean; name: string } | null; note: string;
  /** The dance floor's mood on this page, and the room's word on it when one has just come in (the page takes it, then clears it). */
  mood: number; heardMood: number | null;
};
/** What the DJ's hands set (not where the track has got to): a change here is worth telling the room. */
const hands = (d: Decks) => JSON.stringify([d.deck.map((k) => [k.playing, k.pitch]), d.fader, d.cross]);

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** What one page remembers between ticks: the hold it last told the room about, the newest drop it has taken per piece,
 * and for cables, where each end was last told or heard to be (`"power-10 a"` to "plug:outlet power-out-1"), the ends
 * it has told the room about and not yet seen come back, and the room's newest word on each cable. */
export interface Synced {
  held: string | null; seen: Map<string, number>; you: string;
  ends: Map<string, string>; pending: Map<string, string>; wires: Map<string, Wire>;
  /** Each switch as the room last had it from or for this page, and the newest count taken per switch. */
  on: Map<string, boolean>; thrown: Map<string, number>;
  /** The seat you last asked for, the decks' controls you last sent, and the newest decks count taken. */
  djWant: boolean; sentDecks: string; spun: number;
}
export const synced = (): Synced => ({ held: null, seen: new Map(), you: "", ends: new Map(), pending: new Map(), wires: new Map(), on: new Map(), thrown: new Map(), djWant: false, sentDecks: "", spun: 0 });

const ENDS = ["a", "b"] as const;
/** One end as a short word to compare: yours is "hand:", a friend's "hand:<their id>". */
const word = (e: EndAt) => ("plug" in e ? `plug:${e.plug.join(" ")}` : "hand" in e ? "hand:" : "mate" in e ? `hand:${e.mate}` : "case" in e ? "case" : "loose");
const wireWord = (e: WireEnd, you: string) => (e.at === "plug" ? `plug:${e.plug!.join(" ")}` : e.at === "hand" ? `hand:${e.hand === you ? "" : e.hand}` : e.at);
const toLocal = (e: WireEnd, you: string): EndAt =>
  e.at === "plug" ? { plug: [e.plug![0]!, e.plug![1]!] } : e.at === "hand" ? (e.hand === you ? { hand: true } : { mate: e.hand ?? "" }) : e.at === "case" ? { case: true } : { loose: true };
const CASED: Omit<Wire, "key"> = { n: 0, a: { at: "case" }, b: { at: "case" }, twists: 0 };

/** The cable ends that moved on this page since last time (not a friend's: the room tells you those). */
function cableOutbox(w: World, c: Cables, s: Synced): Sent[] {
  const out: Sent[] = [];
  for (const run of c.runs) for (const end of ENDS) {
    const e = run[end], k = word(e), id = `${run.key} ${end}`;
    if ("mate" in e || k === (s.ends.get(id) ?? "case")) continue;
    const p = "loose" in e ? endAt(w, c, run, end) : null;
    const to: WireEnd = "plug" in e ? { at: "plug", plug: [...e.plug] } : "hand" in e ? { at: "hand", hand: "" } : "case" in e ? { at: "case" } : { at: "loose", x: r3(p?.x ?? 0), y: r3(p?.y ?? 0), z: r3(p?.z ?? 0) };
    out.push({ t: "end", key: run.key, end, to, ...("case" in e ? { twists: run.twists ?? 0 } : {}) });
    s.ends.set(id, k);
    s.pending.set(id, k);
  }
  return out;
}

/** The room's word on a cable onto your page. An end you moved and haven't seen come back stays as you have it, unless
 * `force` (the room refused it). */
function hearWire(w: World, c: Cables, s: Synced, wire: Omit<Wire, "n">, force: boolean) {
  for (const end of ENDS) {
    const id = `${wire.key} ${end}`, k = wireWord(wire[end], s.you), mine = s.pending.get(id);
    if (mine !== undefined && !force) { if (mine !== k) continue; s.pending.delete(id); }
    if (force) s.pending.delete(id);
    s.ends.set(id, k);
    const run = c.runs.find((r) => r.key === wire.key);
    if (!run || word(run[end]) === k) continue;
    const e = wire[end];
    setEnd(w, c, wire.key, end, toLocal(e, s.you), e.at === "loose" ? { x: e.x!, y: e.y!, z: e.z! } : undefined, wire.twists);
  }
}

/** What changed in your hands since last time, as messages: the cable ends you moved, a drop where the piece landed, then a grab. */
export function outbox(w: World, s: Synced, c?: Cables, on?: ReadonlySet<string>, booth?: Booth | null): Sent[] {
  const now = w.held?.key ?? null, out: Sent[] = c ? cableOutbox(w, c, s) : [];
  if (booth) {
    if (booth.want !== s.djWant) { s.djWant = booth.want; out.push({ t: "dj", take: booth.want }); }
    // On the decks, every move of your hands goes to the room with where each track is right now.
    const set = hands(booth.decks);
    if (booth.dj?.me && set !== s.sentDecks) {
      s.sentDecks = set;
      const d = booth.decks;
      out.push({ t: "decks", deck: d.deck.map((k) => ({ playing: k.playing, pitch: k.pitch, beat: r3(k.beat) })), fader: [...d.fader], cross: d.cross, mood: Math.round(booth.mood) });
    }
  }
  // The switches you threw (`on` is what is switched on, on your page).
  if (on) for (const key of new Set([...on, ...s.on.keys()])) {
    if (on.has(key) === (s.on.get(key) ?? false)) continue;
    s.on.set(key, on.has(key));
    out.push({ t: "switch", key, on: on.has(key) });
  }
  if (now === s.held) return out;
  const was = s.held && w.items.find((i) => i.key === s.held);
  if (was) out.push({ t: "drop", key: was.key, x: r3(was.x), y: r3(was.y), z: r3(was.z), rot: r3(was.rot) });
  if (now) out.push({ t: "grab", key: now, team: !!w.held?.team });
  s.held = now;
  return out;
}

/** Where you stand, and where what you carry is drawn, for the friends to see. */
export function poseOf(w: World): Sent {
  const p = holdPose(w), you = w.you;
  return {
    t: "pose", x: r3(you.x), z: r3(you.z), yaw: r3(you.yaw), crouch: you.crouch,
    carry: p && w.held ? { key: w.held.key, x: r3(p.x), y: r3(p.y), z: r3(p.z), rot: r3(p.rot) } : undefined,
  };
}

/** A message from the room. A view moves your friends and the pieces they carry or set down; a piece set down that was in
 * your hands (the friend on the other end put it down) leaves them, and each cable's ends go where the room says. A
 * refusal takes back the grab, or puts the cable end back where the room has it. */
export function hear(w: World, s: Synced, m: ServerMsg, c?: Cables, on?: Set<string>, booth?: Booth | null) {
  if (m.t === "refused" && m.key === "decks") {
    // Someone else has the seat: stop asking, and say who.
    s.djWant = false;
    if (booth) { booth.want = false; booth.note = m.why; }
    return;
  }
  if (m.t === "refused") {
    if (w.held?.key === m.key) { w.held = null; s.held = null; }
    if (c?.runs.some((r) => r.key === m.key)) hearWire(w, c, s, s.wires.get(m.key) ?? { key: m.key, ...CASED }, true);
    return;
  }
  s.you = m.you;
  if (booth) {
    const mine = m.dj === m.you;
    booth.room = true;
    booth.dj = m.dj ? { me: mine, name: m.djName } : null;
    if (mine) booth.note = "";
    // Anyone not on the decks plays what the DJ last set, moved on by the time since: in step, wherever they joined.
    if (m.decks && m.decks.n > s.spun) {
      s.spun = m.decks.n;
      if (!mine) {
        const d = booth.decks;
        m.decks.deck.forEach((k, i) => Object.assign(d.deck[i]!, k));
        m.decks.fader.forEach((v, i) => { d.fader[i] = v; });
        d.cross = m.decks.cross;
        booth.heardMood = m.decks.mood;
        tickDecks(d, Math.max(0, m.clock - m.decks.at) / 1000);
      }
    }
    // Off the decks, the next time you take them your first move is told whole.
    if (!mine) s.sentDecks = "";
  }
  if (c) for (const wire of m.cables) {
    if (wire.n <= (s.wires.get(wire.key)?.n ?? 0) || !whole(wire.a) || !whole(wire.b)) continue;
    s.wires.set(wire.key, wire);
    hearWire(w, c, s, wire, false);
  }
  // A switch a friend threw is thrown on your page too: one system, heard by each from where they stand.
  if (on) for (const t of m.switches) {
    if (t.n <= (s.thrown.get(t.key) ?? 0)) continue;
    s.thrown.set(t.key, t.n);
    s.on.set(t.key, t.on);
    if (t.on) on.add(t.key); else on.delete(t.key);
  }
  for (const p of m.placed) {
    if (p.n <= (s.seen.get(p.key) ?? 0)) continue;
    s.seen.set(p.key, p.n);
    const i = w.items.find((x) => x.key === p.key);
    if (!i) continue;
    if (w.held?.key === p.key) { w.held = null; s.held = null; }
    Object.assign(i, { x: p.x, y: p.y, z: p.z, rot: p.rot });
  }
  const mine = heldItem(w);
  for (const m2 of m.mates) {
    const i = m2.carry && w.items.find((x) => x.key === m2.carry!.key);
    if (i && i !== mine) Object.assign(i, { x: m2.carry!.x, y: m2.carry!.y, z: m2.carry!.z, rot: m2.carry!.rot });
  }
  seeCrew(w, m.mates.map(({ id, name, x, z, yaw, crouch, holding }) => ({ id, name, x, z, yaw, crouch, holding })));
}
