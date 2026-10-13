// Layout (gitwiz/gitwiz.ts): gitwiz's pure parts: git log in, notes and the highway's perspective out
// gitwiz replays one file's history down a guitar-neck highway (page.ts draws it). Everything that can be
// wrong without a screen is here, with no DOM and no imports, so test/gitwiz.test.ts covers it:
//   - reading `git log -p -U0 --follow` (parsePatchLog) and the JSON that scripts/gitwiz-log.ts writes (readInput)
//   - turning commits into notes: a kind (add, remove, rewrite), a size, a lane
//   - the board's perspective (project) and the playhead's math (scrub, clock, score)

/** One commit that touched the file. `regions` is the lines it changed in the file's top, middle and bottom third. */
export interface Commit {
  hash: string; author: string; date: string; subject: string;
  added: number; removed: number;
  regions?: [number, number, number];
}

export type Kind = "add" | "remove" | "rewrite";
export type LaneMode = "region" | "author";

export interface Note {
  i: number; hash: string; short: string; author: string; date: string; t: number; subject: string;
  added: number; removed: number; changed: number;
  kind: Kind;
  /** 0..1, how loud the note is: lines changed on a log scale, against the biggest in this file. */
  size: number;
  /** Share of the changed lines that were additions, for a rewrite's two-tone chip. */
  addShare: number;
  regions: [number, number, number];
}

/** What a pasted or uploaded file can hold: one history, or a few of a repo's most-edited files. */
export interface Input {
  repo: string;
  files: { path: string; commits: number }[];
  histories: Record<string, Commit[]>;
}

export const REGION_NAMES = ["top", "middle", "bottom"] as const;

// -- reading git ------------------------------------------------------------------------------------

export const LOG_FORMAT = "%x1e%H%x1f%an%x1f%aI%x1f%s";
const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * `git log --follow -p -U0 --no-merges --format=LOG_FORMAT -- <path>` as commits, newest first like git. Each
 * hunk's added and removed lines are counted, and each is placed in the file's top, middle or bottom
 * third. The file's length before a commit is the running sum of every earlier commit's added minus removed.
 */
export function parsePatchLog(raw: string): Commit[] {
  const out: Commit[] = [];
  for (const chunk of raw.split("\x1e").slice(1).reverse()) {
    const [head = "", ...body] = chunk.split("\n");
    const [hash = "", author = "", date = "", ...subject] = head.split("\x1f");
    if (!hash) continue;
    const before = out.reduce((n, c) => n + c.added - c.removed, 0);
    const regions: [number, number, number] = [0, 0, 0];
    let added = 0, removed = 0;
    const hunks: { os: number; oc: number; ns: number; nc: number }[] = [];
    for (const line of body) {
      const m = HUNK.exec(line);
      if (!m) continue;
      const oc = m[2] === undefined ? 1 : Number(m[2]), nc = m[4] === undefined ? 1 : Number(m[4]);
      removed += oc; added += nc;
      hunks.push({ os: Number(m[1]), oc, ns: Number(m[3]), nc });
    }
    // Each changed line goes in the third it sits in: a removed line by its place in the file as it
    // was, an added one by its place in the file as it became.
    const after = Math.max(before + added - removed, 1);
    for (const h of hunks) {
      for (let k = 0; k < h.oc; k++) regions[regionOf((h.os - 1 + k + 0.5) / Math.max(before, 1))]++;
      for (let k = 0; k < h.nc; k++) regions[regionOf((h.ns - 1 + k + 0.5) / after)]++;
    }
    out.push({ hash, author, date, subject: subject.join("\x1f"), added, removed, regions });
  }
  return out.reverse();
}

/** 0, 1 or 2: which third of the file a position (0 top .. 1 bottom) is in. */
export const regionOf = (frac: number) => Math.min(2, Math.max(0, Math.floor(frac * 3)));

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

function readCommit(c: unknown, at: number): Commit {
  const o = c as Record<string, unknown> | null;
  if (!o || typeof o !== "object") throw new Error(`commit ${at} isn't an object`);
  const date = String(o.date ?? "");
  if (!Number.isFinite(Date.parse(date))) throw new Error(`commit ${at} has no usable date`);
  const r = o.regions;
  const regions = Array.isArray(r) && r.length === 3 ? ([num(r[0]), num(r[1]), num(r[2])] as [number, number, number]) : undefined;
  return {
    hash: String(o.hash ?? ""), author: String(o.author ?? "unknown"), date, subject: String(o.subject ?? ""),
    added: num(o.added), removed: num(o.removed), ...(regions ? { regions } : {}),
  };
}

/** Commits sorted oldest first. The files hold git's order, newest first, so of two commits with the same date the later one in the list is the older. */
export const oldestFirst = (commits: Commit[]) =>
  commits.map((c, i) => ({ c, i, t: Date.parse(c.date) })).sort((a, b) => a.t - b.t || b.i - a.i).map((x) => x.c);

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
  if (!o || typeof o !== "object") throw new Error("expected a list of commits or a gitwiz bundle");
  const repo = typeof o.repo === "string" ? o.repo : "";
  const histories: Record<string, Commit[]> = {};
  if (o.histories && typeof o.histories === "object") {
    for (const [p, list] of Object.entries(o.histories as Record<string, unknown>)) {
      if (!Array.isArray(list)) throw new Error(`${p}: expected a list of commits`);
      histories[p] = oldestFirst(list.map(readCommit));
    }
  } else if (Array.isArray(o.commits)) {
    histories[typeof o.path === "string" && o.path ? o.path : "this file"] = oldestFirst(o.commits.map(readCommit));
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

export function buildNotes(commits: Commit[]): Note[] {
  const sorted = oldestFirst(commits);
  const top = Math.max(1, ...sorted.map((c) => c.added + c.removed));
  return sorted.map((c, i) => {
    const changed = c.added + c.removed;
    const regions = c.regions ?? [0, 0, 0];
    return {
      i, hash: c.hash, short: c.hash.slice(0, 7), author: c.author, date: c.date, t: Date.parse(c.date), subject: c.subject,
      added: c.added, removed: c.removed, changed,
      kind: kindOf(c.added, c.removed),
      size: changed === 0 ? 0 : Math.log1p(changed) / Math.log1p(top),
      addShare: changed === 0 ? 0.5 : c.added / changed,
      regions,
    };
  });
}

export interface Lanes {
  mode: LaneMode;
  /** One name per lane, left to right. */
  names: string[];
  /** The lane of each note, by note index. */
  of: number[];
}

/** Whether the data says where in the file each commit landed. */
export const hasRegions = (notes: Note[]) => notes.some((n) => n.regions[0] + n.regions[1] + n.regions[2] > 0);

/**
 * Region lanes: top, middle, bottom, a note in the third most of its lines landed in (a tie goes to the
 * middle, a commit with no regions too). Author lanes: the `max - 1` busiest authors by commit count,
 * left to right, and everyone else in the last lane as "others".
 */
export function assignLanes(notes: Note[], mode: LaneMode, max = 5): Lanes {
  if (mode === "region") {
    return {
      mode, names: [...REGION_NAMES],
      of: notes.map((n) => {
        const [t, m, b] = n.regions;
        return b > t && b > m ? 2 : t > m && t >= b ? 0 : 1;
      }),
    };
  }
  const counts = new Map<string, number>();
  for (const n of notes) counts.set(n.author, (counts.get(n.author) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([a]) => a);
  const named = ranked.length > max ? ranked.slice(0, max - 1) : ranked;
  const names = ranked.length > max ? [...named, "others"] : named;
  return { mode, names, of: notes.map((n) => { const k = named.indexOf(n.author); return k < 0 ? names.length - 1 : k; }) };
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
/** Notes that have crossed keep sliding toward the viewer for this many commits, then they're gone. */
export const BEHIND = 1;

export function geometry(w: number, h: number): Geometry {
  return { w, h, horizon: h * 0.1, strum: h * 0.8, cx: w / 2, half: Math.min(w * 0.4, h * 0.62) };
}

/** Scale at depth d (commits past the strum line; negative once crossed): 1 at the strum line, shrinking with distance. */
export function scaleAt(d: number): number {
  const z = d / AHEAD;
  // Past the strum line it carries on straight, not into 1 / 0, so a note leaves smoothly.
  return z >= 0 ? 1 / (1 + FALLOFF * z) : 1 - FALLOFF * z;
}

/** The lane's centre across the board, -1 (left edge) .. 1 (right edge). */
export const laneCentre = (lane: number, lanes: number) => ((lane + 0.5) / Math.max(lanes, 1)) * 2 - 1;

/** A point on the board: lane position `lx` (-1..1) at depth `d` commits past the strum line, as a screen x, y and scale. */
export function project(g: Geometry, lx: number, d: number): { x: number; y: number; s: number } {
  const s = scaleAt(d);
  return { x: g.cx + lx * g.half * s, y: g.horizon + (g.strum - g.horizon) * s, s };
}

/** Inverse of scaleAt's y: the depth whose line sits at screen y (a fret hit-test, and the tests' round trip). */
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

/** How the run stands with note `idx` under the strum line: commits gone by, the streak of one lane's notes in a row, and points. */
export function scoreAt(notes: Note[], lanes: number[], idx: number): Score {
  let score = 0, combo = 0, added = 0, removed = 0;
  for (let i = 0; i <= idx && i < notes.length; i++) {
    combo = i > 0 && lanes[i] === lanes[i - 1] ? combo + 1 : 1;
    score += 100 * multiplier(combo);
    added += notes[i]!.added; removed += notes[i]!.removed;
  }
  const passed = Math.max(0, Math.min(idx + 1, notes.length));
  return { passed, combo: idx < 0 ? 0 : combo, mult: multiplier(combo), score, added, removed };
}
/** x1 to x4: every four notes in a row in one lane is another x. */
export const multiplier = (combo: number) => Math.min(4, 1 + Math.floor(combo / 4));

// -- words -------------------------------------------------------------------------------------------

const p2 = (n: number) => String(n).padStart(2, "0");
/** `2026-10-12 22:23`, in UTC so it reads the same everywhere. */
export function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}
/** Days since the first commit, as a fixed 4-digit count: `0042d`. */
export const formatAge = (ms: number, since: number) => `${String(Math.max(0, Math.floor((ms - since) / 86_400_000))).padStart(4, "0")}d`;
export const initials = (name: string) => {
  const parts = name.split(/[\s._-]+/).filter(Boolean);
  return ((parts.length > 1 ? parts[0]![0]! + parts[1]![0]! : name.slice(0, 2)) || "?").toUpperCase();
};
