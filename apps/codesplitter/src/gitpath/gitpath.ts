// Layout (src/gitpath/gitpath.ts, src/gitpath/page.ts, src/gitpath/build.ts, src/gitpath/serve.ts): gitpath, a file's commit graph run down a guitar-neck highway by a unicycle game on the hot path (page.ts draws it; gitpath.ts is the pure parts, tested in `test/gitpath.test.ts`; `bun run gitpath` serves it; data from `scripts/gitpath-log.ts`)
// gitpath replays one file's history as a git graph in perspective: branches fan out and rejoin, and the
// hot path is the route with the most churn. Flip on the game and a unicyclist rides it, with git's own
// events (merges, forks, branches, squashes) as the gusts. Everything that can be wrong without a
// screen is here, with no DOM and no imports, so test/gitpath.test.ts covers it:
//   - reading `git log -p -U0 --parents` (parsePatchLog) and the JSON that scripts/gitpath-log.ts writes (readInput)
//   - cutting the repo's graph down to the commits that touched the file (simplifyParents)
//   - notes: a kind (add, remove, rewrite), a size, parents, in an order where parents come first
//   - the graph's layout (lanes, edges, the hot path), the board's perspective, and the time slider's maths
//   - the ride: the unicycle's balance, the pedal timing, and which commits blow a gust

/** One commit that touched the file. `parents` are the nearest earlier commits that touched it too, first parent first. */
export interface Commit {
  hash: string; author: string; date: string; subject: string;
  added: number; removed: number;
  parents?: string[];
  /** Branch names pointing at it (`main`, `office/gizmo`), without `origin/`. */
  refs?: string[];
}

export type Kind = "add" | "remove" | "rewrite";

export interface Note {
  i: number; hash: string; short: string; author: string; date: string; t: number; subject: string;
  added: number; removed: number; changed: number;
  kind: Kind;
  /** 0..1, how loud the note is: lines changed on a log scale, against the biggest in this file. */
  size: number;
  /** Share of the changed lines that were additions, for a rewrite's two-tone coin. */
  addShare: number;
  /** Indices of its parents, which are always before it. */
  parents: number[];
  refs: string[];
}

/** What a pasted or uploaded file can hold: one history, or a few of a repo's most-edited files. */
export interface Input {
  repo: string;
  files: { path: string; commits: number }[];
  histories: Record<string, Commit[]>;
}

// -- reading git ------------------------------------------------------------------------------------

/** Hash, author, committer date, parents, branch names, subject. The committer date is when it landed, so a rebased commit sorts where it went in. */
export const LOG_FORMAT = "%x1e%H%x1f%an%x1f%cI%x1f%P%x1f%D%x1f%s";
const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** `git log`'s `%D` as branch names: `HEAD -> main, origin/main, tag: v1` is `main`. Tags, HEAD and the game's `pr/` refs are left out. */
export function cleanRefs(decor: string): string[] {
  const out: string[] = [];
  for (const raw of decor.split(", ")) {
    const r = raw.replace(/^HEAD -> /, "").replace(/^origin\//, "").trim();
    if (!r || r === "HEAD" || r.startsWith("tag: ") || r.startsWith("pr/") || r === "stash" || out.includes(r)) continue;
    out.push(r);
  }
  return out;
}

/**
 * `git log --follow -p -U0 --no-merges --format=LOG_FORMAT -- <path>` as commits, newest first like git. Each
 * hunk's added and removed lines are counted. `parents` are git's own, so most are commits that didn't touch
 * the file: simplifyParents cuts them down.
 */
export function parsePatchLog(raw: string): Commit[] {
  const out: Commit[] = [];
  for (const chunk of raw.split("\x1e").slice(1)) {
    const [head = "", ...body] = chunk.split("\n");
    const [hash = "", author = "", date = "", parents = "", decor = "", ...subject] = head.split("\x1f");
    if (!hash) continue;
    let added = 0, removed = 0;
    for (const line of body) {
      const m = HUNK.exec(line);
      if (!m) continue;
      removed += m[2] === undefined ? 1 : Number(m[2]);
      added += m[4] === undefined ? 1 : Number(m[4]);
    }
    const refs = cleanRefs(decor);
    out.push({ hash, author, date, subject: subject.join("\x1f"), added, removed, parents: parents.split(" ").filter(Boolean), ...(refs.length ? { refs } : {}) });
  }
  return out;
}

/**
 * For any commit, the nearest commits at or behind it that are in `keep`: itself if it is, else whichever
 * kept commits are behind it. `dag` is every commit's own parents, first parent first.
 */
export function keptAncestors(dag: Map<string, string[]>, keep: Set<string>): (hash: string) => string[] {
  const near = new Map<string, string[]>();
  return (start) => {
    if (keep.has(start)) return [start];
    const stack = [start];
    while (stack.length) {
      const h = stack[stack.length - 1]!;
      if (near.has(h)) { stack.pop(); continue; }
      const ps = dag.get(h) ?? [];
      const pending = ps.filter((p) => !keep.has(p) && !near.has(p));
      if (pending.length) { stack.push(...pending); continue; }
      const found = new Set<string>();
      for (const p of ps) { if (keep.has(p)) found.add(p); else for (const k of near.get(p)!) found.add(k); }
      near.set(h, [...found]);
      stack.pop();
    }
    return near.get(start)!;
  };
}

/**
 * The graph as the file saw it: for each commit in `keep`, its nearest ancestors that are in `keep` too
 * (a parent that touched the file stands for itself; one that didn't stands for whichever kept
 * commits are behind it). A merge that touched nothing disappears, and the two lines it joined stay
 * joined at the next commit that did.
 */
export function simplifyParents(dag: Map<string, string[]>, keep: Set<string>): Map<string, string[]> {
  const near = keptAncestors(dag, keep);
  const out = new Map<string, string[]>();
  for (const c of keep) {
    const found = new Set<string>();
    for (const p of dag.get(c) ?? []) for (const k of near(p)) found.add(k);
    out.set(c, [...found]);
  }
  return out;
}

/** `git log --all --format=%H %P` as each commit's parents. */
export function parseDag(raw: string): Map<string, string[]> {
  const dag = new Map<string, string[]>();
  for (const line of raw.split("\n")) {
    const [h, ...ps] = line.trim().split(/\s+/);
    if (h) dag.set(h, ps);
  }
  return dag;
}

/**
 * `git log --no-merges -M --name-status --format=%x1e` (newest first) as paths, most-edited first, keeping only `exists`
 * ones. A rename carries a file's older commits over to its new name, so an app that moved folders
 * isn't counted as a new file, and deleted paths drop out.
 */
export function topFiles(statusRaw: string, exists: (path: string) => boolean, limit = 12, skip = /(^|\/)(bun\.lockb?|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock)$/): { path: string; commits: number }[] {
  const counts = new Map<string, number>();
  // Walking back through time, a name a file had earlier stands for the name it has now.
  const alias = new Map<string, string>();
  const now = (p: string) => alias.get(p) ?? p;
  for (const commit of statusRaw.split("\x1e")) {
    const seen = new Set<string>();
    for (const line of commit.split("\n")) {
      const [status = "", a = "", b] = line.split("\t");
      if (!a || !/^[AMDRCT]/.test(status)) continue;
      if (status[0] === "R" && b) { alias.set(a, now(b)); seen.add(now(b)); }
      else seen.add(now(status[0] === "C" && b ? b : a));
    }
    for (const p of seen) if (!skip.test(p)) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  return [...counts].filter(([p]) => exists(p)).map(([path, commits]) => ({ path, commits }))
    .sort((x, y) => y.commits - x.commits || (x.path < y.path ? -1 : 1)).slice(0, limit);
}

// -- reading the JSON ---------------------------------------------------------------------------------

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined);

function readCommit(c: unknown, at: number): Commit {
  const o = c as Record<string, unknown> | null;
  if (!o || typeof o !== "object") throw new Error(`commit ${at} isn't an object`);
  const date = String(o.date ?? "");
  if (!Number.isFinite(Date.parse(date))) throw new Error(`commit ${at} has no usable date`);
  const parents = strings(o.parents), refs = strings(o.refs);
  return {
    hash: String(o.hash ?? ""), author: String(o.author ?? "unknown"), date, subject: String(o.subject ?? ""),
    added: num(o.added), removed: num(o.removed), ...(parents ? { parents } : {}), ...(refs?.length ? { refs } : {}),
  };
}

/**
 * Commits oldest first, and never a commit before one of its parents (a clock that's off, or a rebase, can
 * date a child before its parent). The files hold git's order, newest first, so of two commits with the
 * same date the later one in the list is the older. With no parents it's just a sort by date.
 */
export function orderCommits(commits: Commit[]): Commit[] {
  const at = new Map(commits.map((c, i) => [c.hash, i]));
  const t = commits.map((c) => Date.parse(c.date));
  const waiting = commits.map((c) => new Set((c.parents ?? []).filter((p) => at.has(p) && p !== c.hash)).size);
  const children = commits.map(() => [] as number[]);
  commits.forEach((c, i) => { for (const p of new Set(c.parents ?? [])) { const k = at.get(p); if (k !== undefined && k !== i) children[k]!.push(i); } });
  const before = (a: number, b: number) => t[a]! - t[b]! || b - a;
  const ready = commits.map((_, i) => i).filter((i) => waiting[i] === 0);
  const out: Commit[] = [], done = new Set<number>();
  while (ready.length) {
    let best = 0;
    for (let k = 1; k < ready.length; k++) if (before(ready[k]!, ready[best]!) < 0) best = k;
    const i = ready.splice(best, 1)[0]!;
    done.add(i); out.push(commits[i]!);
    for (const c of children[i]!) if (--waiting[c]! === 0) ready.push(c);
  }
  // A cycle (bad hand-made parents) leaves some behind: they go in date order at the end.
  for (const i of commits.map((_, i) => i).filter((i) => !done.has(i)).sort(before)) out.push(commits[i]!);
  return out;
}

/**
 * Reads what the page was handed: a history (`[…]` or `{path, commits}`) or a bundle
 * (`{repo, files, histories}`), as pasted text or an already parsed value. Throws a sentence the page can show.
 */
export function readInput(source: unknown): Input {
  let v = source;
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch { throw new Error("that isn't JSON"); }
  }
  if (Array.isArray(v)) v = { commits: v };
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object") throw new Error("expected a list of commits or a gitpath bundle");
  const repo = typeof o.repo === "string" ? o.repo : "";
  const histories: Record<string, Commit[]> = {};
  if (o.histories && typeof o.histories === "object") {
    for (const [p, list] of Object.entries(o.histories as Record<string, unknown>)) {
      if (!Array.isArray(list)) throw new Error(`${p}: expected a list of commits`);
      histories[p] = orderCommits(list.map(readCommit));
    }
  } else if (Array.isArray(o.commits)) {
    histories[typeof o.path === "string" && o.path ? o.path : "this file"] = orderCommits(o.commits.map(readCommit));
  } else throw new Error("no commits in there: expected a list, {commits}, or {histories}");
  const paths = Object.keys(histories);
  if (!paths.length || paths.every((p) => histories[p]!.length === 0)) throw new Error("that history has no commits");
  const listed = Array.isArray(o.files) ? (o.files as { path?: unknown; commits?: unknown }[]) : [];
  const files = [
    ...listed.filter((f) => typeof f.path === "string" && f.path in histories).map((f) => ({ path: f.path as string, commits: histories[f.path as string]!.length })),
    ...paths.filter((p) => !listed.some((f) => f.path === p)).map((p) => ({ path: p, commits: histories[p]!.length })),
  ];
  return { repo, files, histories };
}

// -- notes -------------------------------------------------------------------------------------------

/** A commit's colour: mostly adding, mostly removing, or a rewrite (both, and neither dwarfs the other). */
export function kindOf(added: number, removed: number): Kind {
  const lo = Math.min(added, removed), hi = Math.max(added, removed);
  if (lo >= 3 && lo / hi >= 0.4) return "rewrite";
  return added >= removed ? "add" : "remove";
}

/** Notes in playing order: oldest first, parents before children. A parent that isn't in the list is dropped. */
export function buildNotes(commits: Commit[]): Note[] {
  const sorted = orderCommits(commits);
  const at = new Map(sorted.map((c, i) => [c.hash, i]));
  const top = Math.max(1, ...sorted.map((c) => c.added + c.removed));
  let clock = -Infinity;
  return sorted.map((c, i) => {
    const changed = c.added + c.removed;
    // The clock never runs backward, even where a commit is dated before its parent.
    clock = Math.max(clock, Date.parse(c.date));
    return {
      i, hash: c.hash, short: c.hash.slice(0, 7), author: c.author, date: c.date, t: clock, subject: c.subject,
      added: c.added, removed: c.removed, changed,
      kind: kindOf(c.added, c.removed),
      size: changed === 0 ? 0 : Math.log1p(changed) / Math.log1p(top),
      addShare: changed === 0 ? 0.5 : c.added / changed,
      // A history with no parents at all (an older file, a hand-made list) reads as one line: each commit's parent is the one before.
      parents: c.parents ? [...new Set(c.parents)].map((p) => at.get(p)).filter((k): k is number => k !== undefined && k < i) : i > 0 ? [i - 1] : [],
      refs: c.refs ?? [],
    };
  });
}

// -- the graph ---------------------------------------------------------------------------------------

export interface Edge { lo: number; hi: number }

export interface Layout {
  /** Each note's lane: 0 is the main line, others are branches (reused once a branch has ended). */
  lane: number[];
  /** Where each lane sits across the board, in lane widths from the centre. Lane 0 is 0, then 1, -1, 2, -2. */
  slot: number[];
  lanes: number;
  /** The most slots either side of the centre in use. */
  extent: number;
  edges: Edge[];
  /** The newest note on the main line. */
  tip: number;
  /** The hot path: note indices, oldest to newest. */
  hot: number[];
  onHot: boolean[];
}

export const MAX_LANES = 9;
const MAIN = /^(main|master|trunk)$/;

/** A lane's place across the board: 0, then right, left, right, left. */
export const slotOf = (lane: number) => (lane === 0 ? 0 : lane % 2 === 1 ? (lane + 1) / 2 : -lane / 2);

/**
 * The path with the most churn from the first commit to the main tip: at each fork it takes the branch
 * that changed more lines. With no merges the graph is one line and this is all of it.
 */
export function hotPath(notes: Note[], tip: number): number[] {
  const best: number[] = [], from: number[] = [];
  notes.forEach((n, i) => {
    let p = -1;
    for (const k of n.parents) if (p < 0 || best[k]! > best[p]!) p = k;
    best[i] = n.changed + 1 + (p < 0 ? 0 : best[p]!);
    from[i] = p;
  });
  const path: number[] = [];
  for (let i = tip; i >= 0; i = from[i]!) path.push(i);
  return path.reverse();
}

/**
 * Lays the notes out as a git graph, newest to oldest: the main line (first parents back from the tip
 * of `main`, or the newest commit) is lane 0; a branch takes the lowest free lane at its newest commit
 * and gives it back once the graph reaches the commit it forks from.
 */
export function layoutGraph(notes: Note[], maxLanes = MAX_LANES): Layout {
  const n = notes.length;
  let tip = n - 1;
  for (let i = n - 1; i >= 0; i--) if (notes[i]!.refs.some((r) => MAIN.test(r))) { tip = i; break; }
  const lane = new Array<number>(n).fill(-1);
  for (let i = tip; i >= 0; i = notes[i]!.parents[0] ?? -1) lane[i] = 0;
  const expect: (number | null)[] = new Array(maxLanes).fill(null);
  const taken = (p: number) => expect.some((e, k) => k > 0 && e === p);
  const alloc = () => { for (let k = 1; k < maxLanes; k++) if (expect[k] === null) return k; return maxLanes - 1; };
  for (let i = n - 1; i >= 0; i--) {
    const ps = notes[i]!.parents;
    if (lane[i] === 0) {
      for (let k = 1; k < maxLanes; k++) if (expect[k] === i) expect[k] = null;
    } else {
      const here = expect.flatMap((e, k) => (k > 0 && e === i ? [k] : []));
      for (const k of here.slice(1)) expect[k] = null;
      lane[i] = here[0] ?? alloc();
      expect[lane[i]!] = null;
      // The lane stays this branch's all the way down to where it forks off, so nothing else is drawn through it.
      if (ps[0] !== undefined) expect[lane[i]!] = ps[0];
    }
    for (const p of ps.slice(1)) if (lane[p] !== 0 && !taken(p)) expect[alloc()] = p;
  }
  const slot = lane.map(slotOf);
  const edges: Edge[] = notes.flatMap((nt, hi) => nt.parents.map((lo) => ({ lo, hi })));
  const hot = n ? hotPath(notes, tip) : [];
  const onHot = new Array<boolean>(n).fill(false);
  for (const i of hot) onHot[i] = true;
  const lanes = n ? Math.max(...lane) + 1 : 1;
  return { lane, slot, lanes, extent: Math.max(0, ...slot.map(Math.abs)), edges, tip, hot, onHot };
}

const smooth = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };

/**
 * Where an edge sits across the board at time `t` (a note index, so fractions are between commits): flat in
 * its branch's lane, bending to the other lane over at most a commit and a half at the end where the lines
 * meet: at the older end when the branch forks off, at the newer end when it joins an older lane.
 */
export function edgeSlotAt(lay: Layout, e: Edge, t: number): number {
  const a = lay.slot[e.lo]!, b = lay.slot[e.hi]!;
  if (a === b) return a;
  const bend = Math.min(1.5, (e.hi - e.lo) / 2);
  return lay.lane[e.hi]! < lay.lane[e.lo]!
    ? a + (b - a) * smooth((t - (e.hi - bend)) / bend)
    : b + (a - b) * smooth(1 - (t - e.lo) / bend);
}

/** Where the hot path runs across the board at time `t`. */
export function pathSlotAt(lay: Layout, t: number): number {
  const h = lay.hot;
  if (!h.length) return 0;
  if (t <= h[0]! || h.length === 1) return lay.slot[h[0]!]!;
  if (t >= h[h.length - 1]!) return lay.slot[h[h.length - 1]!]!;
  let k = 0;
  while (h[k + 1]! < t) k++;
  return edgeSlotAt(lay, { lo: h[k]!, hi: h[k + 1]! }, t);
}

// -- the board ---------------------------------------------------------------------------------------

export interface Geometry {
  w: number; h: number;
  /** Screen y of the horizon and of the strum line, and the x of the vanishing point. */
  horizon: number; strum: number; cx: number;
  /** Half the board's width at the strum line. */
  half: number;
}

/** How many commits are on the board at once, strum line to horizon. */
export const AHEAD = 16;
/** How sharply the board narrows toward the horizon (the strum line is 1, the horizon is 1 / (1 + FALLOFF)). */
export const FALLOFF = 6;
/** How far past the strum line the board is drawn, in commits. */
export const BEHIND = 1.5;

export function geometry(w: number, h: number): Geometry {
  return { w, h, horizon: h * 0.1, strum: h * 0.8, cx: w / 2, half: Math.min(w * 0.4, h * 0.62) };
}

/** Scale at depth d (commits past the strum line; negative once crossed): 1 at the strum line, shrinking with distance. */
export function scaleAt(d: number): number {
  const z = d / AHEAD;
  // Past the strum line it carries on straight, not into 1 / 0, so a note leaves smoothly.
  return z >= 0 ? 1 / (1 + FALLOFF * z) : 1 - FALLOFF * z;
}

/** A slot's place across the board, -1 (left edge) .. 1 (right edge), with `extent` slots either side of the centre one. */
export const slotX = (slot: number, extent: number) => slot / (extent + 0.5);

/** A point on the board: position `lx` (-1..1) at depth `d` commits past the strum line, as a screen x, y and scale. */
export function project(g: Geometry, lx: number, d: number): { x: number; y: number; s: number } {
  const s = scaleAt(d);
  return { x: g.cx + lx * g.half * s, y: g.horizon + (g.strum - g.horizon) * s, s };
}

/** Inverse of scaleAt's y: the depth whose line sits at screen y. */
export function depthAtY(g: Geometry, y: number): number {
  const s = (y - g.horizon) / (g.strum - g.horizon);
  return s <= 1 ? ((1 / s - 1) / FALLOFF) * AHEAD : ((1 - s) / FALLOFF) * AHEAD;
}

// -- the playhead -------------------------------------------------------------------------------------
// q is how many commits have gone by: 0 before the first reaches the strum line, n after the last. It
// is a float; note i crosses at q = i + 1, and sits (i + 1 - q) commits in front of the strum line.

export const clampQ = (q: number, n: number) => Math.min(n, Math.max(0, q));

/** The note under the strum line now: the last one q has passed, or -1 before the first. */
export const currentIndex = (q: number, n: number) => Math.min(n, Math.floor(clampQ(q, n) + 1e-9)) - 1;

/** A scrub bar's fraction (0..1 along it) as q. */
export const scrubToQ = (frac: number, n: number) => clampQ(frac * n, n);
export const qToScrub = (q: number, n: number) => (n === 0 ? 0 : clampQ(q, n) / n);

/** Which commit a click at `frac` along the scrub bar lands on (the one that has just gone by), or -1 at the very start. */
export const scrubToIndex = (frac: number, n: number) => currentIndex(Math.round(scrubToQ(frac, n)), n);

/** Whole commits forward or back from q, snapping to a crossing (stepping from 2.4 forward lands on 3). */
export function stepQ(q: number, by: number, n: number) {
  const base = by > 0 ? Math.floor(q + 1e-9) : Math.ceil(q - 1e-9);
  return clampQ(base + by, n);
}

/** The clock at q: the date of the commit at the strum line, sliding toward the next one's as the next approaches. */
export function clockAt(notes: Note[], q: number): number {
  if (!notes.length) return 0;
  const c = clampQ(q, notes.length);
  const k = Math.floor(c + 1e-9);
  if (k <= 0) return notes[0]!.t;
  if (k >= notes.length) return notes[notes.length - 1]!.t;
  const a = notes[k - 1]!.t, b = notes[k]!.t;
  return a + (b - a) * (c - k);
}

export interface Score { passed: number; combo: number; mult: number; score: number; added: number; removed: number }

/** x1 to x4: every four commits in a row on the hot path is another x. */
export const multiplier = (combo: number) => Math.min(4, 1 + Math.floor(combo / 4));

/** How the run stands with note `idx` under the strum line: commits gone by, the streak of hot-path commits the runner kept, and points. A commit on a side branch breaks the streak. */
export function scoreAt(notes: Note[], onHot: boolean[], idx: number): Score {
  let score = 0, combo = 0, added = 0, removed = 0;
  for (let i = 0; i <= idx && i < notes.length; i++) {
    combo = onHot[i] ? combo + 1 : 0;
    if (combo) score += 100 * multiplier(combo);
    added += notes[i]!.added; removed += notes[i]!.removed;
  }
  const passed = Math.max(0, Math.min(idx + 1, notes.length));
  return { passed, combo, mult: multiplier(combo), score, added, removed };
}

// -- words -------------------------------------------------------------------------------------------

const p2 = (n: number) => String(n).padStart(2, "0");
/** `2026-10-12 22:23`, in UTC so it reads the same everywhere. */
export function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}
/** Days since the first commit, as a fixed 4-digit count: `0042d`. */
export const formatAge = (ms: number, since: number) => `${String(Math.max(0, Math.floor((ms - since) / 86_400_000))).padStart(4, "0")}d`;

// -- the time slider ---------------------------------------------------------------------------------

/** Where the clock at q sits between the first commit and the last, 0..1: the slider's thumb. */
export function timeFracAt(notes: Note[], q: number): number {
  if (notes.length < 2) return 0;
  const first = notes[0]!.t, span = notes[notes.length - 1]!.t - first;
  return span <= 0 ? qToScrub(q, notes.length) : Math.min(1, Math.max(0, (clockAt(notes, q) - first) / span));
}

/** The q whose clock reads `ms`: the inverse of clockAt, so dragging the slider goes by date and not by commit. */
export function qAtTime(notes: Note[], ms: number): number {
  const n = notes.length;
  if (!n || ms <= notes[0]!.t) return 0;
  if (ms >= notes[n - 1]!.t) return n;
  let k = 1;
  while (notes[k]!.t < ms) k++;
  const a = notes[k - 1]!.t, b = notes[k]!.t;
  return b === a ? k : k + (ms - a) / (b - a);
}

export const qAtFrac = (notes: Note[], frac: number) =>
  notes.length < 2 ? 0 : qAtTime(notes, notes[0]!.t + Math.min(1, Math.max(0, frac)) * (notes[notes.length - 1]!.t - notes[0]!.t));

/** Month-start ticks along the slider, spaced so there are at most `max`: `{frac, label}` with the label a month, or a year once the steps are a year or more. */
export function timeTicks(first: number, last: number, max = 5): { frac: number; label: string }[] {
  const span = last - first;
  if (!(span > 0)) return [];
  const a = new Date(first), months = (last - first) / 2_629_800_000;
  const step = [1, 3, 6, 12, 24, 60, 120].find((m) => months / m <= max) ?? 120;
  const out: { frac: number; label: string }[] = [];
  let y = a.getUTCFullYear(), m = Math.ceil(a.getUTCMonth() / step) * step;
  for (;; m += step) {
    const t = Date.UTC(y + Math.floor(m / 12), m % 12, 1);
    if (t > last) break;
    if (t >= first) out.push({ frac: (t - first) / span, label: step >= 12 ? String(new Date(t).getUTCFullYear()) : formatClock(t).slice(0, 7) });
  }
  return out;
}

/** The commits dated between two `YYYY-MM-DD` days, both included, in UTC like the clock. Either end can be empty. */
export function filterRange(commits: Commit[], from?: string, to?: string): Commit[] {
  const lo = from ? Date.parse(from) : -Infinity, hi = to ? Date.parse(to) + 86_399_999 : Infinity;
  if (Number.isNaN(lo) || Number.isNaN(hi)) return commits;
  return commits.filter((c) => { const t = Date.parse(c.date); return t >= lo && t <= hi; });
}

// -- the ride ----------------------------------------------------------------------------------------
// The game: a unicyclist rides the hot path, facing away. Left and right taps are the pedals. The sim is
// an upside-down pendulum (lean falls over on its own), plus wind, plus a kick from each tap. A tap on a
// side kicks the lean away from that side's power stroke, so leaning right is caught with right taps. But
// speed only comes from alternating taps near the beat, so catching a gust costs speed.

export type Side = -1 | 1;

export const RIDE = {
  /** Seconds between power strokes at a steady pace. */
  period: 0.5,
  /** How hard the lean falls over by itself, and how much of its swing is lost. */
  gravity: 1.2, damping: 1.6,
  /** A full tap kicks the swing by this much, a poor one by half. */
  kick: 0.5,
  /** Speed (commits a second) a perfect alternating tap adds, how fast it bleeds off, and the top. */
  boost: 0.55, drag: 0.6, maxSpeed: 4,
  /** Past this lean the rider is off. */
  fall: 1,
  /** How fast a gust dies down. */
  gustDecay: 2.5,
};

export interface Ride {
  /** -1..1, negative left, positive right. Reaching `fall` is a spill. */
  lean: number; omega: number;
  speed: number;
  /** The last side tapped (0 before the first), when, and how well it hit the beat. */
  last: Side | 0; lastAt: number; grade: number;
  /** A gust that is dying down, as an acceleration on the lean. */
  gust: number;
  t: number;
  /** Turns of the crank, a half turn a stroke, for the picture. */
  crank: number;
}

export const newRide = (): Ride => ({ lean: 0, omega: 0, speed: 0, last: 0, lastAt: -Infinity, grade: 0, gust: 0, t: 0, crank: 0 });

/** A steady breeze that never quite stops: two slow waves, each rider-time. Sizes are accelerations on the lean. */
export const breeze = (t: number) => 0.28 * Math.sin(0.7 * t + 1.3) + 0.18 * Math.sin(1.9 * t);

/** How well a tap at gap seconds after the last, on `side`, hits the beat: 0 (same side twice, or mashing) to 1. The first tap counts as 0.6. */
export function tapGrade(r: Ride, side: Side): number {
  if (r.last === 0) return 0.6;
  if (r.last === side) return 0;
  const gap = r.t - r.lastAt;
  return Math.max(0, 1 - Math.abs(gap - RIDE.period) / (RIDE.period * 0.8));
}

/** A pedal tap: kicks the lean, and if it alternates on the beat, adds speed. Returns its grade. */
export function tapRide(r: Ride, side: Side): number {
  const g = tapGrade(r, side);
  r.omega -= side * RIDE.kick * (0.5 + 0.5 * g);
  r.speed = Math.min(RIDE.maxSpeed, r.speed + RIDE.boost * g);
  r.crank += 0.5;
  r.last = side; r.lastAt = r.t; r.grade = g;
  return g;
}

/** Blows a gust: an acceleration on the lean that dies down. */
export const gustRide = (r: Ride, push: number) => { r.gust += push; };

/** Moves the ride on by dt seconds. True if the rider went over. */
export function stepRide(r: Ride, dt: number, wind = breeze(r.t)): boolean {
  r.omega += (RIDE.gravity * r.lean + wind + r.gust - RIDE.damping * r.omega) * dt;
  r.lean += r.omega * dt;
  r.gust *= Math.exp(-RIDE.gustDecay * dt);
  r.speed *= Math.exp(-RIDE.drag * dt);
  r.t += dt;
  return Math.abs(r.lean) >= RIDE.fall;
}

/** Back on the unicycle: upright and still, keeping the clock and the crank. */
export function remount(r: Ride) { r.lean = 0; r.omega = 0; r.speed = 0; r.gust = 0; r.last = 0; r.grade = 0; }

export type EventKind = "merge" | "fork" | "branch" | "squash";

/** A commit that blows a gust. `side` is where it comes from, -1 left and 1 right; it pushes the rider the other way. */
export interface RideEvent { i: number; kind: EventKind; side: Side; power: number }

/** Strength of each, as a push on the lean: a car is the biggest. */
const POWER: Record<EventKind, number> = { merge: 3, fork: 2.2, branch: 1.5, squash: 2.4 };
const SQUASH = /\(#\d+\)\s*$|\bsquash/i;

/**
 * What each commit is on the road, where the graph says so: a merge (two parents) is a car coming in from
 * its side lane, a fork (a commit two lines start from) is a fork in the road, the first commit on a side
 * branch is a fallen branch, and a big commit that landed as a squash merge is a rolling boulder.
 * Commits that are none of those are a quiet stretch.
 */
export function rideEvents(notes: Note[], lay: Layout): RideEvent[] {
  const kids = new Array<number>(notes.length).fill(0);
  for (const n of notes) for (const p of new Set(n.parents)) kids[p]!++;
  const sign = (x: number, i: number): Side => (x > 0 ? 1 : x < 0 ? -1 : parseInt(notes[i]!.hash.slice(-1) || "0", 16) % 2 ? 1 : -1);
  const out: RideEvent[] = [];
  for (const n of notes) {
    const i = n.i, here = lay.slot[i]!;
    let kind: EventKind | null = null, side: Side = 1;
    if (n.parents.length > 1) {
      kind = "merge";
      const far = n.parents.slice(1).map((p) => lay.slot[p]!).sort((a, b) => Math.abs(b) - Math.abs(a))[0]!;
      side = sign(far - here, i);
    } else if (kids[i]! > 1) {
      kind = "fork";
      const kid = notes.filter((k) => k.parents.includes(i)).map((k) => lay.slot[k.i]!).sort((a, b) => Math.abs(b) - Math.abs(a))[0]!;
      side = sign(kid - here, i);
    } else if (lay.lane[i]! > 0 && n.parents.length === 1 && lay.lane[n.parents[0]!]! !== lay.lane[i]) {
      kind = "branch"; side = sign(here, i);
    } else if (n.size > 0.5 && SQUASH.test(n.subject)) {
      kind = "squash"; side = sign(0, i);
    }
    if (kind) out.push({ i, kind, side, power: POWER[kind] });
  }
  return out;
}

/** The push on the lean an event gives: away from the side it came from. */
export const eventPush = (e: RideEvent) => -e.side * e.power;

// -- the video's speed curves ---------------------------------------------------------------------------
// An export plays the whole (cropped) history in a fixed time. A curve maps the video's progress u (0..1)
// to how far through the commits it has got, w (0..1); q is then w * n. Every curve is monotonic and runs 0 to 1.

export type Curve = { id: string; label: string; icon: string; warp: (u: number) => number };

const smooth = (u: number) => u * u * (3 - 2 * u);

export const CURVES: Curve[] = [
  { id: "steady", label: "Steady", icon: "minus", warp: (u) => u },
  { id: "ease-in", label: "Slow start", icon: "trending-up", warp: (u) => u * u },
  { id: "ease-out", label: "Slow finish", icon: "trending-down", warp: (u) => 1 - (1 - u) * (1 - u) },
  { id: "ease-in-out", label: "Slow at both ends", icon: "spline", warp: smooth },
  // The meme: it crawls, then it won't stop. Exponential, so each second goes about twice as far as the last.
  { id: "faster", label: "Faster and faster", icon: "rocket", warp: (u) => (Math.pow(2, 8 * u) - 1) / 255 },
  { id: "rush", label: "Rush, then crawl", icon: "gauge", warp: (u) => 1 - Math.pow(1 - u, 4) },
  // Three bursts with a pause between each: a smooth staircase.
  { id: "bursts", label: "Bursts", icon: "chart-no-axes-column-increasing", warp: (u) => { const k = Math.min(2, Math.floor(u * 3)); return (k + smooth(u * 3 - k)) / 3; } },
];

/** The curve called `id`, or steady. */
export const curveById = (id: string) => CURVES.find((c) => c.id === id) ?? CURVES[0]!;

/** q at video progress `u` (0..1): the curve's warp, scaled to the commits and clamped. */
export const warpQ = (curve: Curve, u: number, n: number) => clampQ(curve.warp(Math.min(1, Math.max(0, u))) * n, n);
