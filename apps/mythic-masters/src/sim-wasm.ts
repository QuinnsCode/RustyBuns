// The page's fight on the Rust sim (sim-rs/, #3657): src/sim.wasm plays the ticks, and every tick its state comes
// back as one flat list of numbers (sim-rs/src/state.rs) that `readInto` walks into an ordinary Match, so the page,
// the puppets, the effects and the bots read the same Match they read off sim.ts. sim.ts stays the source of truth:
// `tsSim` is the same fight on it, the page falls back to it when the wasm won't load, and test/sim-rust.test.ts
// plays both side by side, hashing every tick.
//
// `walk` is the layout (state.rs `walk`, number for number): the hash the Rust check compares, the mirror's shape,
// and how a fighter the page changed (health carried between fights, a fighter put on the ledge) goes back in.
import { FIELDS, STRONG, type Field } from "./fields.ts";
import { body, SLOTS, type Creature, type Move, type Slot } from "./roster.ts";
import { IDLE, newMatch, newTeamMatch, step, type Area, type Event, type Fighter, type Input, type Match, type Ranged, type State } from "./sim.ts";

const KEYS = ["up", "down", "light", "heavy", "special", "ultimate", "guard", "dash", "big"] as const;
const STATES: readonly State[] = ["free", "attack", "stun", "guard", "dash", "ledge"];
const SHAPES = ["touch", "column", "wall", "cone", "blast", "nova"] as const;
const HOW = ["hp", "ring-out", "time"] as const;
const key = (k: string) => KEYS.indexOf(k as (typeof KEYS)[number]);
const slot = (s: Slot) => SLOTS.indexOf(s);
type Sink = (x: number) => void;

/** One fighter in state.rs `walk_fighter`'s order. */
export function walkFighter(m: Match, f: Fighter, n: Sink) {
  const flag = (b: boolean) => n(b ? 1 : 0);
  n(f.pos.x); n(f.pos.y); n(f.pos.z); n(f.vel.x); n(f.vel.y); n(f.vel.z); n(f.yaw); n(f.hp); n(f.launch); n(f.stamina); n(f.energy);
  n(STATES.indexOf(f.state)); n(f.t); n(f.stun); n(f.clipped); flag(f.flying); flag(f.onGround); n(f.airJumps); flag(f.rise); flag(f.exhausted); n(f.invuln);
  n(f.buf ? key(f.buf.k) : -1); n(f.buf ? f.buf.left : 0);
  flag(f.hop);
  n(f.ring); n(f.spin); n(f.orbit); n(f.bearing); n(f.red); n(f.hurt);
  flag(f.fresh); n(f.drop); n(f.team); flag(f.down);
  const k = f.marks;
  n(k.dot); n(k.dotPer); n(k.dotField ? FIELDS.indexOf(k.dotField) : -1); n(k.chill); n(k.root);
  const p = f.prev;
  n(p.mx); n(p.mz);
  for (const b of KEYS) flag(p[b]);
  const a = f.act;
  if (!a) return n(-1);
  n(slot(a.move.slot)); flag(a.hit); flag(a.dive); flag(!!a.tired);
  if (a.aim) { n(1); n(a.aim.yaw); n(a.aim.pitch); } else n(0);
  n(a.key ? key(a.key) : -1); n(a.hold ?? 0); n(a.lead ?? 0);
  n(a.area ? m.areas.indexOf(a.area) : -2);
}

/** The whole of a Match as numbers, in state.rs `walk`'s order. */
export function walk(m: Match, n: Sink) {
  const flag = (b: boolean) => n(b ? 1 : 0);
  n(m.tick); flag(m.over); n(m.winner ?? -1);
  for (const f of m.f) walkFighter(m, f, n);
  n(m.areas.length);
  for (const a of m.areas) {
    n(a.owner); n(slot(a.move.slot));
    for (const x of [a.power, a.at.x, a.at.y, a.at.z, a.from.x, a.from.y, a.from.z, a.dir.x, a.dir.y, a.dir.z, a.t, a.life, a.land, a.every, a.ramp]) n(x);
    // One per fighter: a slot nobody was caught in yet reads 0 (the list starts two long and grows).
    m.f.forEach((_, k) => n(a.hits[k] ?? 0));
    m.f.forEach((_, k) => flag(!!a.struck[k]));
    const d = a.d;
    n(SHAPES.indexOf(d.shape));
    if (d.shape === "column") { n(d.length); n(d.width); n(d.speed); }
    else if (d.shape === "wall") { n(d.width); n(d.depth); n(d.travel); n(d.speed); }
    else if (d.shape === "cone") { n(d.angle); n(d.length); }
    else if (d.shape === "blast") { n(d.range); n(d.radius); n(d.flight); }
    else n(d.radius);
  }
  n(m.events.length);
  for (const e of m.events) {
    if (e.kind === "hit") { n(0); n(e.by); n(e.on); n(slot(e.slot)); n(FIELDS.indexOf(e.field)); n(e.damage); flag(e.guarded); flag(e.rear); flag(e.spike); n(e.at.x); n(e.at.y); n(e.at.z); }
    else if (e.kind === "move") { n(1); n(e.by); n(slot(e.move.slot)); for (const x of [e.at.x, e.at.y, e.at.z, e.yaw, e.target.x, e.target.y, e.target.z]) n(x); }
    else if (e.kind === "land") { n(2); n(e.who); n(e.speed); }
    else if (e.kind === "clipped") { n(3); n(e.who); }
    else if (e.kind === "ledge") { n(4); n(e.who); }
    else { n(5); n(e.who); n(HOW.indexOf(e.how)); }
  }
}

// FNV-1a over every number's f64 bits (state.rs `Fnv`).
const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
let h = 0;
const word = (w: number) => { h = Math.imul(h ^ w, 16777619) >>> 0; };
const fnv = (x: number) => { if (x !== x) { word(0); word(0x7ff80000); return; } f64[0] = x; word(u32[0]!); word(u32[1]!); };

/** The whole of a Match as one 32-bit hash, the same as state.rs `hash_match` gives the Rust one. */
export function hashMatch(m: Match): number {
  h = 2166136261;
  walk(m, fnv);
  return h;
}

/** Where each fighter's numbers start and end in a state list, as `readInto` found them. */
export type Spans = [number, number][];

/** state.rs's numbers into `m`, in place: the fighters keep their creature, body and moves (and their identity), and
 * a shape or an event names its move by slot, which is looked up on its fighter. */
export function readInto(m: Match, s: ArrayLike<number>): Spans {
  let at = 0;
  const n = () => s[at++]!, flag = () => s[at++] !== 0, v3 = () => ({ x: n(), y: n(), z: n() });
  const into = (p: { x: number; y: number; z: number }) => { p.x = n(); p.y = n(); p.z = n(); };
  m.tick = n(); m.over = flag();
  const w = n();
  m.winner = w < 0 ? null : w ? 1 : 0;
  const spans: [number, number][] = [], held: (number | null)[] = [];
  for (const f of m.f) {
    const from = at;
    into(f.pos); into(f.vel);
    f.yaw = n(); f.hp = n(); f.launch = n(); f.stamina = n(); f.energy = n();
    f.state = STATES[n()]!; f.t = n(); f.stun = n(); f.clipped = n();
    f.flying = flag(); f.onGround = flag(); f.airJumps = n(); f.rise = flag(); f.exhausted = flag(); f.invuln = n();
    const bk = n(), left = n();
    f.buf = bk < 0 ? null : { k: KEYS[bk] as NonNullable<Fighter["buf"]>["k"], left };
    f.hop = flag();
    f.ring = n(); f.spin = n(); f.orbit = n(); f.bearing = n(); f.red = n(); f.hurt = n();
    f.fresh = flag(); f.drop = n(); f.team = n() ? 1 : 0; f.down = flag();
    const k = f.marks;
    k.dot = n(); k.dotPer = n();
    const df = n();
    k.dotField = df < 0 ? null : FIELDS[df]!;
    k.chill = n(); k.root = n();
    const prev = { mx: n(), mz: n() } as Input;
    for (const b of KEYS) prev[b] = flag();
    f.prev = prev;
    const sl = n();
    if (sl < 0) { f.act = null; held.push(null); }
    else {
      const move = f.moves[SLOTS[sl]!], hit = flag(), dive = flag(), tired = flag();
      const aim = flag() ? { yaw: n(), pitch: n() } : undefined, kk = n(), hold = n(), lead = n(), area = n();
      // A stream no longer among the live shapes (-1) is still the one it held.
      const gone = area === -1 ? (f.act?.area ?? stub(move)) : undefined;
      f.act = { move, hit, dive, tired, aim, key: kk < 0 ? undefined : (KEYS[kk] as NonNullable<Fighter["act"]>["key"]), hold, lead, area: gone };
      held.push(area >= 0 ? area : null);
    }
    spans.push([from, at]);
  }
  const areas: Area[] = [];
  for (let c = n(); c > 0; c--) {
    const owner = n(), move = m.f[owner]!.moves[SLOTS[n()]!];
    const power = n(), aAt = v3(), from = v3(), dir = v3(), t = n(), life = n(), land = n(), every = n(), ramp = n();
    const hits = m.f.map(() => n()), struck = m.f.map(() => flag());
    const shape = SHAPES[n()]!;
    const d = (shape === "column" ? { shape, length: n(), width: n(), speed: n() }
      : shape === "wall" ? { shape, width: n(), depth: n(), travel: n(), speed: n() }
      : shape === "cone" ? { shape, angle: n(), length: n() }
      : shape === "blast" ? { shape, range: n(), radius: n(), flight: n() }
      : { shape: "nova", radius: n() }) as Ranged;
    areas.push({ owner, move, d, power, at: aAt, from, dir, t, life, land, every, ramp, hits, struck });
  }
  m.areas = areas;
  m.f.forEach((f, i) => { const k = held[i]; if (f.act && k != null) f.act.area = areas[k]; });
  const events: Event[] = [];
  for (let c = n(); c > 0; c--) {
    const kind = n();
    if (kind === 0) {
      const by = n(), on = n(), move = m.f[by]!.moves[SLOTS[n()]!], field = FIELDS[n()] as Field;
      events.push({ kind: "hit", by, on, move: move.name, slot: move.slot, fx: move.fx, field, damage: n(), guarded: flag(), rear: flag(), spike: flag(), at: v3() });
    } else if (kind === 1) {
      const by = n(), move = m.f[by]!.moves[SLOTS[n()]!];
      events.push({ kind: "move", by, move, at: v3(), yaw: n(), target: v3() });
    } else if (kind === 2) events.push({ kind: "land", who: n(), speed: n() });
    else if (kind === 3) events.push({ kind: "clipped", who: n() });
    else if (kind === 4) events.push({ kind: "ledge", who: n() });
    else events.push({ kind: "ko", who: n(), how: HOW[n()]! });
  }
  m.events = events;
  if (at !== s.length) throw new Error(`sim.wasm state: read ${at} of ${s.length} numbers`);
  return spans;
}
/** A stream its fighter still holds after it left the live shapes: nothing reads it but the hash, which only asks that it is one. */
const stub = (move: Move): Area => ({
  owner: 0, move, d: move.delivery as Ranged, power: 0, at: { x: 0, y: 0, z: 0 }, from: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: 0, z: 0 },
  t: 0, life: 0, land: 0, every: 0, ramp: 0, hits: [0, 0], struck: [false, false],
});

/** A creature as sim-rs reads it (data.rs): its numbers, its body (worked out here, so both sims start from the same
 * bits) and its six moves. */
export function creatureJson(c: Creature) {
  const field = (f: Field) => FIELDS.indexOf(f), s = c.stats, moves = SLOTS.map((sl) => c.moves.find((m) => m.slot === sl)!);
  return {
    archetype: c.archetype, fields: c.fields.map(field), stats: [s.vigor, s.might, s.guard, s.focus, s.will, s.speed], edge: c.edge,
    body: body(c), moves: moves.map((m) => ({ field: field(m.field), power: m.power, ranged: m.ranged, drain: m.drain, delivery: m.delivery, tempo: m.tempo })),
  };
}
/** The field chart and these creatures, as sim-rs's `roster`. */
export const rosterJson = (cs: readonly Creature[]) => ({ strong: FIELDS.map((f) => STRONG[f].map((g) => FIELDS.indexOf(g))), creatures: cs.map(creatureJson) });

/** A fight the page plays a tick at a time: `m` is what it reads (and may write a fighter of), `step` one tick with
 * an input a fighter. */
export interface Live { m: Match; step(inputs: Input[]): void; readonly engine: "ts" | "wasm" }
/** A fight between one creature a side, or a team a side (#3929: two friends against a wild one). */
export type Sim = (a: Creature | Creature[], b: Creature | Creature[]) => Live;
const teams = (a: Creature | Creature[], b: Creature | Creature[]): [Creature[], Creature[]] => [Array.isArray(a) ? a : [a], Array.isArray(b) ? b : [b]];
const matchOf = (a: Creature | Creature[], b: Creature | Creature[]) => (Array.isArray(a) || Array.isArray(b) ? newTeamMatch(teams(a, b)) : newMatch(a, b));

/** The fight on sim.ts. */
export const tsSim: Sim = (a, b) => {
  const m = matchOf(a, b);
  return { m, engine: "ts", step: (inputs) => step(m, inputs) };
};

const INPUT_LEN = 11, IO_LEN = 256;
const inputInto = (io: Float64Array, at: number, i: Input) => {
  io[at] = i.mx; io[at + 1] = i.mz;
  KEYS.forEach((b, k) => { io[at + 2 + k] = i[b] ? 1 : 0; });
};

/** sim.wasm's bytes into a Sim. One fight at a time: starting the next drops the last on the Rust side. */
export async function wasmSim(bytes: BufferSource): Promise<Sim> {
  const instance = await WebAssembly.instantiate(await WebAssembly.compile(bytes));
  const x = instance.exports, memory = x.memory;
  const fn = (name: string) => {
    const f = x[name];
    if (typeof f !== "function") throw new Error(`sim.wasm: no ${name} export`);
    return (...args: number[]) => Number(f(...args));
  };
  if (!(memory instanceof WebAssembly.Memory)) throw new Error("sim.wasm: no memory export");
  const alloc = fn("alloc"), liveNew = fn("live_new"), liveIo = fn("live_io"), liveStep = fn("live_step"), liveLoad = fn("live_load");
  const liveState = fn("live_state"), liveStateLen = fn("live_state_len"), outPtr = fn("out_ptr"), outLen = fn("out_len");
  const error = () => new TextDecoder().decode(new Uint8Array(memory.buffer, outPtr(), outLen()));
  // Views go stale when the module's memory grows, so each is made fresh where it is used.
  const io = () => new Float64Array(memory.buffer, liveIo(), IO_LEN);
  const state = () => new Float64Array(memory.buffer, liveState(), liveStateLen());
  let current = 0;
  return (a, b) => {
    const [left, right] = teams(a, b);
    const cmd = new TextEncoder().encode(JSON.stringify({ roster: rosterJson([...left, ...right]), left: left.length })), at = alloc(cmd.length);
    new Uint8Array(memory.buffer, at, cmd.length).set(cmd);
    if (!liveNew(at, cmd.length)) throw new Error(`sim.wasm: ${error()}`);
    const me = ++current, m = matchOf(a, b);
    let spans = readInto(m, state()), last = state().slice();
    const mine: number[] = [];
    return {
      m, engine: "wasm",
      step(inputs) {
        if (me !== current) throw new Error("sim.wasm: a newer fight has started");
        // A fighter the page wrote to since the last tick goes back in before this one.
        m.f.forEach((f, side) => {
          mine.length = 0;
          walkFighter(m, f, (v) => mine.push(v));
          const [from, to] = spans[side]!;
          if (mine.length === to - from && mine.every((v, k) => Object.is(v, last[from + k]))) return;
          io().set(mine);
          if (!liveLoad(side, mine.length)) throw new Error(`sim.wasm: ${error()}`);
        });
        const view = io();
        m.f.forEach((_, k) => inputInto(view, k * INPUT_LEN, inputs[k] ?? IDLE));
        liveStep();
        last = state().slice();
        spans = readInto(m, last);
      },
    };
  };
}
