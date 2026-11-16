// The live socket (/api/live) between the arena and the page: one type, sent by arena.ts and read by
// app/viewer.ts. Its own file so the page can import the check without the Durable Object.
import { arr, bool, Bad, int, nul, num, obj, oneOf, opt, str, type Guard, type Of } from "@rustybuns/util/guard";
import type { Op, SkeletonEl } from "./engine/types.ts";

// A replay (GET /api/matches/<id>) and the list of them (GET /api/matches), read by this site's viewer and by the
// office's broadcaster (apps/agent-office/live/brawl.ts), which may be a version ahead or behind: so the whole
// thing is checked, and names (models, colours, actions) are plain text a page shows rather than this build's lists.
const text = (max: number) => str(max, { min: 0 });
const at = num(-1e6, 1e6);
const style = { strokeColor: opt(text(64)), backgroundColor: opt(text(64)), fillStyle: opt(oneOf(["solid", "hachure", "cross-hatch"])), strokeWidth: opt(num(0, 1000)), roughness: opt(num(0, 100)) };
const pairs = arr(arr(at, 2, { min: 2 }), 10_000);
const points = (v: unknown): [number, number][] => pairs(v).map(([x, y]) => [x!, y!]);
const Box = obj({ id: text(200), type: oneOf(["rectangle", "ellipse", "diamond"]), x: at, y: at, width: at, height: at, ...style });
const Linear = obj({ id: text(200), type: oneOf(["line", "arrow"]), x: at, y: at, points, ...style });
const Text = obj({ id: text(200), type: oneOf(["text"]), x: at, y: at, text: text(10_000), fontSize: opt(num(0, 1000)), ...style });
const field = (v: unknown, k: string): unknown => (typeof v === "object" && v !== null ? Reflect.get(v, k) : undefined);
/** One shape, by its type. */
const Element: Guard<SkeletonEl> = (v) => { const t = field(v, "type"); return t === "line" || t === "arrow" ? Linear(v) : t === "text" ? Text(v) : Box(v); };
/** An update's fields: never its id or type (engine/ops.ts drops those before it logs one). */
const Patch = obj({ x: opt(at), y: opt(at), width: opt(at), height: opt(at), points: opt(points), text: opt(text(10_000)), fontSize: opt(num(0, 1000)), ...style });
const Add = obj({ element: Element }), Ref = obj({ id: text(200) }), Update = obj({ id: text(200), patch: Patch });
const OpOf: Guard<Op> = (v) => {
  const kind = field(v, "op");
  if (kind === "add") return { op: kind, ...Add(v) };
  if (kind === "update") return { op: kind, ...Update(v) };
  if (kind === "delete") return { op: kind, ...Ref(v) };
  throw new Bad("an add, update or delete");
};
const count = int(0, 1e6);
const Entry = obj({
  side: int(0, 64), turn: count, ops: arr(OpOf, 10_000),
  decision: opt(obj({ action: text(40), target: opt(text(200)), shape: text(40), color: text(64), col: num(-1e3, 1e3), row: num(-1e3, 1e3), size: num(-10, 10), aspect: text(40), step: opt(count), part: opt(text(200)) })),
  pen: opt(obj({ lines: count, skipped: count, look: opt(bool()), done: opt(bool()) })),
  error: opt(text(2000)),
});
/** One side's turn in a replay: LogEntry, with names as text. */
export type ReplayEntry = Of<typeof Entry>;
const Score = obj({ likeness: num(-100, 100), craft: num(-100, 100) });
const Fighter = obj({ model: text(100), name: text(200) });
const time = num(0, Number.MAX_SAFE_INTEGER);
/** A finished fight as the archive keeps it: what a page needs to play it back. */
const fight = {
  id: text(200), prompt: text(2000), fighters: arr(Fighter, 64), turns: count, turn: count, startedAt: time, endedAt: opt(time),
  scenes: arr(arr(Element, 10_000), 64), scores: opt(arr(nul(Score), 64)), winner: opt(int(-1, 64)),
};
export const Replay = obj({ ...fight, log: arr(Entry, 100_000) });
export type Replay = Of<typeof Replay>;
/** The archive's list, newest first. A row that doesn't fit is left out rather than losing the list. */
const Summary = obj({
  id: text(200), prompt: text(2000), fighters: arr(Fighter, 64), turns: count, startedAt: time, endedAt: opt(time),
  shapes: arr(count, 64), scores: opt(arr(nul(Score), 64)), winner: opt(int(-1, 64)),
});
export const Summaries = arr(Summary, 100_000, { drop: true });
export type Summaries = Of<typeof Summaries>;

// The live socket (/api/live), read whole. A fight sends a hello, a start, one message a turn (seconds apart) and
// an end, so checking every field costs nothing a viewer could notice (measured in #4584).
const LiveFight = obj(fight);
/** What the page draws a live fight from: the fight so far, without its log (a hello's scenes stand in for it). */
export type LiveMatch = Of<typeof LiveFight>;
const kinds = {
  hello: obj({ match: nul(LiveFight) }),
  start: obj({ match: LiveFight }),
  turn: obj({ id: text(200), turn: count, entries: arr(Entry, 64) }),
  end: obj({ id: text(200), summary: Summary }),
};
type Kinds = typeof kinds;
/** Everything the live socket sends: the arena writes `x satisfies LiveMessage`, the page reads `check(LiveMessage, v)`. */
export type LiveMessage = { [K in keyof Kinds]: { t: K } & Of<Kinds[K]> }[keyof Kinds];
export const LiveMessage: Guard<LiveMessage> = (v) => {
  const t = field(v, "t");
  if (t === "hello") return { t, ...kinds.hello(v) };
  if (t === "start") return { t, ...kinds.start(v) };
  if (t === "turn") return { t, ...kinds.turn(v) };
  if (t === "end") return { t, ...kinds.end(v) };
  throw new Bad("a hello, start, turn or end");
};
