// The manifest step: a package.json both sides changed merges by key, not by line. Imports nothing.
//
// A line merge asks whenever two branches bump neighbouring dependencies or add scripts at one spot, though
// the edits are independent keys. This reads the three files as JSON and merges each key on its own:
//   - a key only one side changed (or added, or removed) takes that side;
//   - both sides' new keys land, in sorted order when main's were sorted;
//   - a dependency both bumped takes the higher version (a range's lower bound), a `version` likewise;
//   - anything else both changed (a script, a field, an array) is not settled here, and the lines merge asks.
// Null means "not mine to settle": unparseable, or a key it would have to guess on.

const DEPS = new Set(["dependencies", "devDependencies", "peerDependencies", "optionalDependencies", "overrides", "resolutions"]);
type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
const isObj = (v: unknown): v is { [k: string]: Json } => typeof v === "object" && v !== null && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** `^1.2.3` -> [1, 2, 3]; null when it isn't a plain range (a tag, a URL, `workspace:*`, `||`). */
export function floor(range: string): number[] | null {
  const m = range.trim().match(/^[\^~>=<\s]*v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?(-[\w.]+)?$/);
  return m ? [Number(m[1]), Number(m[2]) || 0, Number(m[3]) || 0] : null;
}
/** The higher of two version ranges, or null when either isn't comparable or they differ only in prerelease. */
export function higher(a: string, b: string): string | null {
  const [x, y] = [floor(a), floor(b)];
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! > y[i]! ? a : b;
  return null;
}

function mix(base: Json | undefined, main: Json | undefined, branch: Json | undefined, deps: boolean, version: boolean): { v: Json | undefined } | null {
  if (same(main, branch)) return { v: main };
  if (same(base, main)) return { v: branch };
  if (same(base, branch)) return { v: main };
  if (isObj(main) && isObj(branch)) {
    const o = mixObj(isObj(base) ? base : {}, main, branch, deps);
    return o ? { v: o } : null;
  }
  // Two different versions of a dependency neither had before is a choice, not a bump.
  if (base !== undefined && (deps || version) && typeof main === "string" && typeof branch === "string") {
    const h = higher(main, branch);
    return h === null ? null : { v: h };
  }
  return null;
}

function mixObj(base: { [k: string]: Json }, main: { [k: string]: Json }, branch: { [k: string]: Json }, deps: boolean): { [k: string]: Json } | null {
  const out: { [k: string]: Json } = {};
  const keys = [...Object.keys(main), ...Object.keys(branch).filter((k) => !(k in main))];
  for (const k of keys) {
    const r = mix(base[k], main[k], branch[k], deps || DEPS.has(k), k === "version");
    if (!r) return null;
    if (r.v !== undefined) out[k] = r.v;
  }
  const order = Object.keys(main);
  const sorted = order.length > 1 && order.every((k, i) => i === 0 || order[i - 1]! <= k);
  return sorted ? Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : out;
}

/** Whether the path is a package manifest. */
export const isManifest = (path: string) => /(^|\/)package\.json$/.test(path);

/** The merged file's text, or null when it can't be settled by key. Indentation and the last newline follow main. */
export function mergeManifest(base: string, main: string, branch: string): string | null {
  try {
    const [b, m, br] = [base, main, branch].map((t) => JSON.parse(t) as Json);
    if (!isObj(b) || !isObj(m) || !isObj(br)) return null;
    const out = mixObj(b, m, br, false);
    if (!out) return null;
    const indent = main.match(/^[ \t]+(?=")/m)?.[0] ?? "  ";
    return JSON.stringify(out, null, indent) + (main.endsWith("\n") ? "\n" : "");
  } catch { return null; }
}
