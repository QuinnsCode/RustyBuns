/**
 * A save/load contract for game sims, after libretro's (#4686): a sim that keeps all of its state, its random
 * stream too (`nextRandom`), in one plain object can be saved to bytes and loaded back, and every frontend trick
 * (save states, rewind, replays, run-ahead, rollback netplay) is built on those two calls and `step`.
 *
 * The state is JSON with three extras JSON alone would lose: -0, NaN and ±Infinity come back as they went.
 * Shared references come back as copies, and a key holding `undefined` comes back missing, so a sim that
 * tells `"k" in o` from `o.k !== undefined`, or `a === b` across two places in its state, won't round-trip.
 * `firstDiff` finds where two states part, for a test that saves, loads and steps on.
 */

/** A sim behind the contract: start one, step it a frame, save it, load it. `S` is plain data. */
export interface Core<S, I> {
  step(s: S, input: I): void;
}

const TAG = "\u0000n:";
const enc = new TextEncoder(), dec = new TextDecoder();

function out(_k: string, v: unknown): unknown {
  return typeof v === "number" && (!Number.isFinite(v) || Object.is(v, -0)) ? TAG + (Object.is(v, -0) ? "-0" : String(v)) : v;
}
function back(_k: string, v: unknown): unknown {
  return typeof v === "string" && v.startsWith(TAG) ? Number(v.slice(TAG.length)) : v;
}

/** The whole state as bytes. */
export function save(state: object): Uint8Array {
  return enc.encode(JSON.stringify(state, out));
}

/**
 * The state `save` wrote, checked against `like`, a state of the same sim (the one it came from, or a fresh
 * one): every top-level key `like` has must be there, with a value of the same kind. A save from another sim,
 * or from an older shape of this one, throws instead of loading half a game.
 */
export function load<S extends object>(bytes: Uint8Array, like: S): S {
  const v: unknown = JSON.parse(dec.decode(bytes), back);
  if (!sameShape(like, v)) throw new Error("load: these bytes are not a save of this sim");
  return v;
}

const kind = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
function sameShape<S extends object>(like: S, v: unknown): v is S {
  if (kind(v) !== kind(like) || typeof v !== "object" || v === null) return false;
  for (const [k, want] of Object.entries(like)) {
    if (want === undefined) continue;
    const got: unknown = Reflect.get(v, k);
    // null is how a sim says "none yet"; a save made later may hold one where `like` has none, or the other way.
    if (got !== null && want !== null && kind(got) !== kind(want)) return false;
  }
  return true;
}

/**
 * The first path where two states differ (`units.3.hp: 12 != 11`), or null when they are the same. Keys holding
 * `undefined` count as missing, as they do after a load.
 */
export function firstDiff(a: unknown, b: unknown, path = ""): string | null {
  if (Object.is(a, b)) return null;
  if (kind(a) !== kind(b) || typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return `${path || "(root)"}: ${String(a)} != ${String(b)}`;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const d = firstDiff(Reflect.get(a, k), Reflect.get(b, k), path ? `${path}.${k}` : k);
    if (d) return d;
  }
  return null;
}

/**
 * Save at frame `at`, load the bytes, and step both the loaded copy and the original on through the same
 * inputs to frame `to`. Returns where they part (see `firstDiff`), or null when the save lost nothing.
 */
export function roundTrip<S extends object, I>(core: Core<S, I>, start: () => S, input: (frame: number) => I, at: number, to: number): string | null {
  const s = start();
  for (let i = 0; i < at; i++) core.step(s, input(i));
  const copy = load(save(s), s);
  for (let i = at; i < to; i++) { core.step(s, input(i)); core.step(copy, input(i)); }
  return firstDiff(s, copy);
}

/**
 * Rewind (#4782): step a sim through this and it keeps a save every `every` frames, the last `keep` of them, and the
 * inputs since the oldest. `back(n)` loads the nearest save at or before `n` frames ago and replays the logged inputs up
 * to it, so the state comes back exactly, not just near. What came after is dropped: stepping on from there is a new branch.
 */
export function rewinder<S extends object, I>(core: Core<S, I>, every = 60, keep = 10) {
  let saves: { frame: number; bytes: Uint8Array }[] = [], inputs: I[] = [], first = 0, frame = 0;
  return {
    /** Frames stepped so far (less any rewound). */
    get frame() { return frame; },
    /** The oldest frame `back` can still reach. */
    get oldest() { return saves[0]?.frame ?? frame; },
    step(s: S, input: I) {
      if (frame % every === 0 && saves.at(-1)?.frame !== frame) {
        saves.push({ frame, bytes: save(s) });
        if (saves.length > keep) { saves.shift(); inputs = inputs.slice(saves[0]!.frame - first); first = saves[0]!.frame; }
      }
      inputs.push(input);
      core.step(s, input);
      frame++;
    },
    /** The state `n` frames back (no further than `oldest`), as a new object; `like` is the state now. */
    back(n: number, like: S): S {
      const to = Math.max(this.oldest, frame - n);
      const at = saves.findLast((v) => v.frame <= to);
      if (!at) return like;
      const s = load(at.bytes, like);
      for (let f = at.frame; f < to; f++) core.step(s, inputs[f - first]!);
      saves = saves.filter((v) => v.frame <= to);
      inputs.length = to - first;
      frame = to;
      return s;
    },
  };
}
