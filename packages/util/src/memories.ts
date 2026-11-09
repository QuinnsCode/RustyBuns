// Memories: the scenes you have seen, kept so you can watch them again. A scene is only a memory once it has played
// to its end (a skip to the end counts: you were there), so nothing is rewatchable before you've earned it, and
// rewatching is recalling: it plays where you stand now, from the same table of scenes the game already has.
//
// The game decides what is remembered and when. It wraps the scenes it wants kept as it plays them, with a title
// and whatever the scene needs to play again (a region's number, a tape's lines), and passes the director's frames
// through `step`; a scene it never wraps (a passing gag, a fight's faceoff) is never a memory.
//
//   const memories = new Memories("my-game:memories");
//   director.play(memories.mark(arrival(n, at, view), { id: `arrival:${n}`, scene: "arrival", title: region.name, args: { n } }));
//   ...each frame: memories.step(director.frame)
//   memories.list() // what you can rewatch, in the order you first saw it
//
// No DOM and no three.js: the page draws the list and plays a memory back with `playNamed` (director.ts).
import type { Frame, Scene } from "./director.ts";
import { arr, check, obj, opt, raw, rec, str } from "./guard.ts";

/** What a memory needs to play again: flat values, or a list of lines. */
export type Args = Record<string, string | number | readonly string[]>;
/** A scene you've seen: its own id (one per region, tape...), the scene table's name to play it by, and a title. */
export interface Memory { id: string; scene: string; title: string; sub?: string; args?: Args }

/** Where the list is kept: the page's localStorage by default, anything with a get and a set in a test. */
export interface Keep { get(): string | null; set(v: string): void }
const local = (key: string): Keep => ({
  get: () => { try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; } },
  set: (v) => { try { globalThis.localStorage?.setItem(key, v); } catch { /* this session only */ } },
});

/** At most this many memories are kept (a long journey's regions, landmarks and tapes fit many times over). */
export const MAX_MEMORIES = 500;
const Row = obj({ id: str(160), scene: str(80), title: str(200), sub: opt(str(200)), args: opt(rec(raw, 16)) });
const argsOf = (a: Record<string, unknown> | undefined): Args | undefined => {
  if (!a) return undefined;
  const out: Args = {};
  for (const [k, v] of Object.entries(a)) {
    if (typeof v === "string" && v.length <= 2000) out[k] = v;
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (Array.isArray(v) && v.length <= 40 && v.every((s) => typeof s === "string" && s.length <= 2000)) out[k] = v;
  }
  return out;
};
/** Reads a stored list, dropping any row that isn't a memory. */
export function readMemories(text: string | null): Memory[] {
  let v: unknown = null;
  try { v = text ? JSON.parse(text) : null; } catch { return []; }
  const rows = check(arr(raw, MAX_MEMORIES * 2), v) ?? [];
  const seen = new Set<string>(), out: Memory[] = [];
  for (const r of rows) {
    const m = check(Row, r);
    if (!m || seen.has(m.id)) continue;
    seen.add(m.id);
    const args = argsOf(m.args);
    out.push({ id: m.id, scene: m.scene, title: m.title, ...(m.sub ? { sub: m.sub } : {}), ...(args ? { args } : {}) });
  }
  return out.slice(0, MAX_MEMORIES);
}

export class Memories {
  private rows: Memory[];
  private readonly keep: Keep;
  private readonly marked = new WeakMap<Scene, Memory>();

  /** `key`: the localStorage key (or a Keep of your own). */
  constructor(key: string | Keep) {
    this.keep = typeof key === "string" ? local(key) : key;
    this.rows = readMemories(this.keep.get());
  }

  /** What you can watch again, in the order you first saw it. */
  list(): readonly Memory[] { return this.rows; }
  has(id: string): boolean { return this.rows.some((m) => m.id === id); }
  get(id: string): Memory | undefined { return this.rows.find((m) => m.id === id); }

  /** Files a scene as memory `m` once it plays to its end; hands the scene straight back for `director.play`. */
  mark<S extends Scene>(s: S, m: Memory): S { this.marked.set(s, m); return s; }

  /** Remembers `m` now (already there: kept where it was). True if it's new. */
  remember(m: Memory): boolean {
    if (this.has(m.id)) return false;
    this.rows = [...this.rows, m].slice(-MAX_MEMORIES);
    this.keep.set(JSON.stringify(this.rows));
    return true;
  }

  /** Each director frame: a marked scene that ended this step becomes a memory. Answers it if it's new. */
  step(f: Pick<Frame, "ended">): Memory | null {
    const m = f.ended && this.marked.get(f.ended);
    return m && this.remember(m) ? m : null;
  }

  /** Forgets everything (a fresh start, or a test). */
  forget(): void { this.rows = []; this.keep.set("[]"); }
}
