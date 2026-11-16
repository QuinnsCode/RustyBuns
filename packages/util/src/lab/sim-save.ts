/**
 * Save and load a game sim's whole state as bytes, and check that a sim survives it (#4686).
 *
 * The idea is borrowed from libretro's core contract (not its code): a sim that steps on a fixed timestep
 * from its inputs, keeps every random number in its own state (`nextRandom`), and can save to bytes and
 * load back gets save states, rewind, replays, run-ahead and rollback netplay from one shared layer.
 *
 * `saveSim` writes plain-data state as JSON, keeping what JSON drops: `Infinity`, `-Infinity`, `NaN`
 * and `-0` (a sim's "never" timer is often `Infinity`, and JSON would load it as `null`).
 * `roundTrip` steps a sim straight through, and again with a save and load partway, and names the
 * first path where the two runs differ.
 */

/** A sim's saved bytes. The type remembers which state they came from, so `loadSim` gives it back. */
export type Save<S> = Uint8Array & { readonly __sim?: S };

const TAG = "\u0000n:";
const encode = (_k: string, v: unknown) =>
  typeof v === "number" && (!Number.isFinite(v) || Object.is(v, -0)) ? TAG + (Object.is(v, -0) ? "-0" : String(v)) : v;
const decode = (_k: string, v: unknown) => (typeof v === "string" && v.startsWith(TAG) ? Number(v.slice(TAG.length)) : v);

/** A sim's state as bytes. State must be plain data: objects, arrays, strings, numbers, booleans and null. */
export function saveSim<S>(state: S): Save<S> {
  return new TextEncoder().encode(JSON.stringify(state, encode));
}

/**
 * The state back from this process's own save. Bytes from a file or the network are `unknown`:
 * read them through a guard instead.
 */
export function loadSim<S>(bytes: Save<S>): S {
  // The brand ties the bytes to S: they are the JSON `saveSim` wrote from an S.
  return JSON.parse(new TextDecoder().decode(bytes), decode) as S;
}

/** The first path where two plain-data values differ, or null when they match. `undefined` and a missing key match. */
export function firstDiff(a: unknown, b: unknown, path = "$"): string | null {
  if (Object.is(a, b)) return null;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return `${path}: ${show(a)} vs ${show(b)}`;
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: array vs object`;
  if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) return `${path}.length: ${a.length} vs ${b.length}`;
  const ka = Object.keys(a), kb = Object.keys(b);
  for (const k of new Set([...ka, ...kb])) {
    const d = firstDiff(Reflect.get(a, k), Reflect.get(b, k), `${path}.${k}`);
    if (d) return d;
  }
  return null;
}
const show = (v: unknown) => (typeof v === "number" && Object.is(v, -0) ? "-0" : JSON.stringify(v) ?? String(v));

/** A sim the round trip can drive: a fresh state, and one fixed step that changes it in place. */
export interface SimCore<S, I> {
  start(): S;
  step(state: S, input: I, frame: number): void;
}

export interface RoundTrip {
  /** null when the run with a save and load ended where the straight run did. */
  diff: string | null;
  /** null when saving changed nothing on the spot; otherwise the first path the load got wrong. */
  loadDiff: string | null;
  bytes: number;
}

/** Steps `frames` frames straight, and again with a save and load after frame `at`; compares where they end. */
export function roundTrip<S, I>(sim: SimCore<S, I>, input: (frame: number) => I, at: number, frames: number): RoundTrip {
  const run = (from: S, start: number, end: number) => {
    for (let f = start; f < end; f++) sim.step(from, input(f), f);
    return from;
  };
  const straight = run(sim.start(), 0, frames);
  const before = run(sim.start(), 0, at);
  const bytes = saveSim(before);
  const loaded = loadSim(bytes);
  const loadDiff = firstDiff(before, loaded);
  return { diff: firstDiff(straight, run(loaded, at, frames)), loadDiff, bytes: bytes.length };
}
