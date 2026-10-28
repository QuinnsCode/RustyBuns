// Guards: read an `unknown` (a parsed body, a socket message, a stored string) and hand back the value typed,
// so the schema is the type. Without a default a guard throws `Bad` saying what's wrong (a route turns that into
// a 400); with one it never throws, it makes the value fit: a missing or wrong value becomes the default, a number
// out of range is clamped, a long string is cut (what a game does with a peer's message).
//
//   const Note = obj({ s: num(0, 16), l: num(1 / 64, 16, 0.25), m: int(0, 127, 60) });
//   type Note = Of<typeof Note>;      // { s: number; l: number; m: number }
//   const n = Note(raw);               // throws Bad("s: a number from 0 to 16") when s isn't one

/** What a guard found wrong, with the field it was in: "name: text up to 100 characters". */
export class Bad extends Error {}

export type Guard<T> = (v: unknown) => T;
/** The type a guard hands back. */
export type Of<G> = G extends Guard<infer T> ? T : never;

const fail = (why: string): never => { throw new Bad(why); };
const range = (lo: number, hi: number) => hi === Infinity ? (lo === -Infinity ? "" : ` from ${lo} up`) : ` from ${lo} to ${hi}`;

/** Anything, as `unknown`: a field passed on for something further in to check. */
export const raw: Guard<unknown> = (v) => v;

/** Text of `min` to `max` characters (cut to `max` with a default), matching `re` when given. */
export const str = (max = 1000, o: { min?: number; re?: RegExp; dflt?: string } = {}): Guard<string> => (v) => {
  const { min = 1, re, dflt } = o;
  if (dflt !== undefined) {
    const s = typeof v === "string" ? v.slice(0, max) : dflt;
    return s.length >= min && (!re || re.test(s)) ? s : dflt;
  }
  if (typeof v !== "string" || v.length < min || v.length > max || (re && !re.test(v)))
    return fail(re ? "text in the right form" : max === Infinity ? "text" : min > 1 ? `text of ${min} to ${max} characters` : `text up to ${max} characters`);
  return v;
};

/** A finite number from `lo` to `hi`; with a default, clamped into range. */
export const num = (lo: number, hi: number, dflt?: number): Guard<number> => (v) => {
  if (typeof v === "number" && Number.isFinite(v)) {
    if (v >= lo && v <= hi) return v;
    if (dflt !== undefined) return Math.min(hi, Math.max(lo, v));
  }
  return dflt ?? fail(`a number${range(lo, hi)}`);
};

/** A whole number from `lo` to `hi`; with a default, rounded and clamped. */
export const int = (lo: number, hi: number, dflt?: number): Guard<number> => {
  const n = num(lo, hi, dflt);
  return (v) => {
    if (dflt !== undefined) return Math.round(n(v));
    return Number.isInteger(v) ? n(v) : fail(`a whole number${range(lo, hi)}`);
  };
};

/** true or false; with a default, anything but a boolean is the default. */
export const bool = (dflt?: boolean): Guard<boolean> => (v) => typeof v === "boolean" ? v : dflt ?? fail("true or false");

/** One of `list`, as the list's own type. */
export const oneOf = <const T extends readonly (string | number)[]>(list: T, dflt?: T[number]): Guard<T[number]> => (v) =>
  list.find((x) => x === v) ?? dflt ?? fail(`one of ${list.join(", ")}`);

/**
 * A list of `min` to `max` items, each through `of`. With `drop`, an item that fails is left out and a long list
 * is cut (a non-list is empty); without, the first bad item fails the list, saying which.
 */
export const arr = <T>(of: Guard<T>, max: number, o: { drop?: boolean; min?: number } = {}): Guard<T[]> => (v) => {
  const { min = 0 } = o, why = max === Infinity ? `a list${min ? ` of at least ${min}` : ""}` : `a list of ${min ? `${min} to ` : "up to "}${max}`;
  if (!Array.isArray(v)) return o.drop ? [] : fail(why);
  if (!o.drop) return v.length > max || v.length < min ? fail(why) : v.map((x, i) => at(i, of, x));
  const out: T[] = [];
  for (const x of v.slice(0, max)) try { out.push(of(x)); } catch (e) { if (!(e instanceof Bad)) throw e; }
  return out;
};

/** Left out (undefined or null) is fine and reads as undefined; otherwise through `g`. */
export const opt = <T>(g: Guard<T>): Guard<T | undefined> => (v) => (v === undefined || v === null ? undefined : g(v));

/** Runs `g` on a field, naming the field in what it throws. */
const at = <T>(key: string | number, g: Guard<T>, v: unknown): T => {
  try { return g(v); } catch (e) { throw e instanceof Bad ? new Bad(`${key}${e.message.includes(": ") ? "." : ": "}${e.message}`) : e; }
};

type Shape = Record<string, Guard<unknown>>;
type Optional<S extends Shape> = { [K in keyof S]: undefined extends Of<S[K]> ? K : never }[keyof S];
type Built<S extends Shape> = { [K in Exclude<keyof S, Optional<S>>]: Of<S[K]> } & { [K in Optional<S>]?: Of<S[K]> };
type Flat<T> = { [K in keyof T]: T[K] };

/** An object with these fields, each through its guard; other fields are dropped. A field `opt` lets go missing is optional. */
export const obj = <S extends Shape>(shape: S): Guard<Flat<Built<S>>> => (v) => {
  const o = typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : fail("an object");
  const out: Record<string, unknown> = {};
  for (const k in shape) {
    const x = at(k, shape[k]!, o[k]);
    if (x !== undefined) out[k] = x;
  }
  return out as Flat<Built<S>>;
};

/** `g`'s value, or null when it throws `Bad`: for a message that's dropped rather than answered. */
export const check = <T>(g: Guard<T>, v: unknown): T | null => {
  try { return g(v); } catch (e) { if (e instanceof Bad) return null; throw e; }
};
