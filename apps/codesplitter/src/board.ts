// The live board (#1524): one row per open PR that Mervin's sandbox merge (scripts/mervin-board.ts) staged, kept in
// D1 by `scripts/mervin-live.ts` and read by the UI and the MCP tool (GET /api/repos/:o/:r/board). This file is the
// pure part: the row's shape, and the answers read off the rows. Imports nothing.

export type Ci = "pass" | "fail" | "pending" | "none";

export interface BoardRow {
  pr: number; title?: string; head: string;
  ci: Ci; failing?: string[];
  /** The open PR this one is built on. */
  stackedOn?: number;
  /** Files per tier (certain, agree, mervin, differ, card), and how many files the PR has. */
  tiers: Record<string, number>; files: number;
  /** Clashes that merge clean as text and break later: other PRs (or main) in the same migration stamp, export or route. */
  clashes: { kind: string; key: string; with: number[]; main?: boolean }[];
  /** The Agent Office worker that owns the PR (list_workers' `pr`), to ping. */
  owner?: string;
  /** For a PR touching package.json, bun.lock or packages/: the apps and PRs it reaches. */
  blast?: { apps: string[]; prs: number[] };
}

/** How often each tier's files landed exactly as the sandbox wrote them, after real merges (`--score`). */
export type Hits = Record<string, { exact: number; of: number }>;

/** One scored merge round: the PRs that landed, each tier's verdicts, and the files the sandbox got wrong (each is a fixture owed to test/conflicts.test.ts). */
export interface Round {
  landed: number[];
  verdicts: Record<string, Record<string, number>>;
  wrongs: { path: string; tiers: string[] }[];
}

const VERDICTS = ["exact", "close", "wrong", "asked"];

/** A round off `score()`'s rows: counts per tier of the file's last tier, `moved` and `waiting` left out. */
export function roundOf(landed: number[], rows: { path: string; score: string; tiers: string[] }[]): Round {
  const verdicts: Round["verdicts"] = {};
  for (const r of rows) {
    if (!VERDICTS.includes(r.score)) continue;
    const t = (verdicts[r.tiers.at(-1) ?? "none"] ??= {});
    t[r.score] = (t[r.score] ?? 0) + 1;
  }
  return { landed, verdicts, wrongs: rows.filter((r) => r.score === "wrong").map((r) => ({ path: r.path, tiers: r.tiers })) };
}

/** Is `x` a round the board keeps? A round that is, or what's wrong with it. */
export function parseRound(x: unknown): Round | string {
  const r = x as Partial<Round> | null;
  if (!r || typeof r !== "object") return "round: {landed, verdicts, wrongs}";
  if (!Array.isArray(r.landed) || !r.landed.every((n) => Number.isInteger(n))) return "landed: [PR numbers]";
  const v = r.verdicts;
  if (!v || typeof v !== "object" || Array.isArray(v)) return "verdicts: {tier: {exact, close, wrong, asked}}";
  const verdicts: Round["verdicts"] = {};
  for (const [tier, counts] of Object.entries(v)) {
    if (!counts || typeof counts !== "object") return "verdicts: {tier: {exact, close, wrong, asked}}";
    const c: Record<string, number> = {};
    for (const [k, n] of Object.entries(counts)) {
      if (!VERDICTS.includes(k) || !Number.isInteger(n) || (n as number) < 0) return `verdicts.${tier}: counts of ${VERDICTS.join(", ")}`;
      c[k] = n as number;
    }
    verdicts[tier] = c;
  }
  if (!Array.isArray(r.wrongs)) return "wrongs: [{path, tiers}]";
  const wrongs = r.wrongs.slice(0, 200).flatMap((w) => (w && typeof w.path === "string" ? [{ path: w.path.slice(0, 300), tiers: Array.isArray(w.tiers) ? w.tiers.map(String).slice(0, 8) : [] }] : []));
  return { landed: r.landed.slice(0, 200), verdicts, wrongs };
}

/** Every recorded round's verdicts added up: files that landed exactly as written, over those that landed (exact, close or wrong). */
export function roundsHit(rounds: Round[]): { exact: number; of: number; wrong: number; rounds: number } {
  let exact = 0, of = 0, wrong = 0;
  for (const r of rounds) for (const t of Object.values(r.verdicts)) {
    exact += t.exact ?? 0; wrong += t.wrong ?? 0;
    of += (t.exact ?? 0) + (t.close ?? 0) + (t.wrong ?? 0);
  }
  return { exact, of, wrong, rounds: rounds.length };
}

export interface Blocker { pr: number; why: string }

/** What holds `row` up: the PR it's stacked on, an earlier PR it clashes with, its own CI, and cards Mervin asked. */
export function blockers(row: BoardRow, rows: BoardRow[]): Blocker[] {
  const open = new Set(rows.map((r) => r.pr));
  const out: Blocker[] = [];
  if (row.stackedOn && open.has(row.stackedOn)) out.push({ pr: row.stackedOn, why: "it's stacked on this one" });
  for (const c of row.clashes) for (const n of c.with) if (n < row.pr && open.has(n) && n !== row.stackedOn) out.push({ pr: n, why: `clashes on ${c.kind} ${c.key}` });
  return out;
}

/** The reasons `row` can't merge now, in words (blocking PRs first). */
export function whyNot(row: BoardRow, rows: BoardRow[]): string[] {
  const why = blockers(row, rows).map((b) => `waits for #${b.pr}: ${b.why}`);
  for (const c of row.clashes) if (c.main) why.push(`clashes with main on ${c.kind} ${c.key}`);
  if (row.ci === "fail") why.push(`its own CI is red${row.failing?.length ? ` (${row.failing.join(", ")})` : ""}`);
  if (row.ci === "pending") why.push("its CI is still running");
  if (row.tiers.card) why.push(`${row.tiers.card} file${row.tiers.card === 1 ? "" : "s"} Mervin asks about (cards)`);
  return why;
}

/** The PRs that can merge now: nothing holds them up. */
export const canMerge = (rows: BoardRow[]) => rows.filter((r) => !whyNot(r, rows).length).map((r) => r.pr);

/** The merge waves, straight off the board: a PR goes one wave past the latest PR that blocks it. */
export function waves(rows: BoardRow[]): number[][] {
  const at = new Map<number, number>(), out: number[][] = [];
  const level = (r: BoardRow, seen: Set<number>): number => {
    if (at.has(r.pr)) return at.get(r.pr)!;
    if (seen.has(r.pr)) return 0; // a cycle: don't loop
    seen.add(r.pr);
    const w = Math.max(0, ...blockers(r, rows).map((b) => level(rows.find((x) => x.pr === b.pr)!, seen) + 1));
    at.set(r.pr, w);
    return w;
  };
  for (const r of [...rows].sort((a, b) => a.pr - b.pr)) (out[level(r, new Set())] ??= []).push(r.pr);
  return out.map((w) => w ?? []);
}

/**
 * Who should take PR `n`'s next move: the worker that owns it; else the owner of the PR it's stacked on or the
 * earliest PR it waits for (they'll know the clash).
 */
export function whoShouldTake(n: number, rows: BoardRow[]): { owner: string | null; why: string } {
  const row = rows.find((r) => r.pr === n);
  if (!row) return { owner: null, why: "not on the board" };
  if (row.owner) return { owner: row.owner, why: "it owns the PR" };
  for (const b of blockers(row, rows)) {
    const o = rows.find((r) => r.pr === b.pr)?.owner;
    if (o) return { owner: o, why: `it owns #${b.pr}, which ${b.why}` };
  }
  return { owner: null, why: "no worker owns it or what it waits for" };
}

/** The hit rate of each tier: exact over those that landed, as a percentage (null before any have landed). */
export const hitRate = (h: Hits) => Object.fromEntries(Object.entries(h).map(([t, v]) => [t, v.of ? Math.round((100 * v.exact) / v.of) : null]));

/** A PR's row, read off the board: what holds it, who owns it, what to do. */
export function ask(n: number, rows: BoardRow[]) {
  const row = rows.find((r) => r.pr === n);
  if (!row) return null;
  const why = whyNot(row, rows);
  return { pr: n, mergeable: !why.length, blocking: why, blockedBy: blockers(row, rows).map((b) => b.pr), take: whoShouldTake(n, rows),
    blocks: rows.filter((r) => blockers(r, rows).some((b) => b.pr === n)).map((r) => r.pr) };
}

/** The board in about four lines, ids first (#1593): what can merge, what is red, what waits and on what. Detail is one `?pr=` away. */
export function brief(rows: BoardRow[]): string[] {
  const list = (ns: number[]) => (ns.length ? ns.map((n) => `#${n}`).join(" ") : "none");
  const mergeable = canMerge(rows);
  const red = rows.filter((r) => r.ci === "fail").map((r) => r.pr);
  const waiting = rows.filter((r) => !mergeable.includes(r.pr) && !red.includes(r.pr));
  return [
    `${rows.length} open. mergeable: ${list(mergeable)}`,
    `red: ${list(red)}`,
    `waiting: ${waiting.length ? waiting.map((r) => `#${r.pr}<-${blockers(r, rows).map((b) => `#${b.pr}`).join(",") || "cards"}`).join(" ") : "none"}`,
    `waves: ${waves(rows).map((w) => w.join(",")).join(" | ") || "none"}`,
  ];
}

/** Each row cut down to the named fields (`pr` always kept). */
export const pick = (rows: BoardRow[], fields: string[]) =>
  rows.map((r) => Object.fromEntries([["pr", r.pr], ...fields.filter((f) => f in r && f !== "pr").map((f) => [f, (r as unknown as Record<string, unknown>)[f]])]));

/** Is `x` a row the board takes? A row that is, or what's wrong with it. */
export function parseRow(x: unknown): BoardRow | string {
  const r = x as Partial<BoardRow> | null;
  if (!r || typeof r !== "object") return "row: {pr, head, ci, tiers, files, clashes}";
  if (!Number.isInteger(r.pr) || r.pr! < 1) return "pr: a positive integer";
  if (typeof r.head !== "string" || !r.head) return "head: a commit";
  if (!["pass", "fail", "pending", "none"].includes(r.ci as string)) return "ci: pass, fail, pending or none";
  if (!r.tiers || typeof r.tiers !== "object" || Array.isArray(r.tiers) || !Object.values(r.tiers).every((v) => Number.isInteger(v))) return "tiers: {tier: count}";
  if (!Number.isInteger(r.files)) return "files: the PR's file count";
  if (!Array.isArray(r.clashes)) return "clashes: []";
  return {
    pr: r.pr!, head: r.head, ci: r.ci!, tiers: r.tiers, files: r.files!, clashes: r.clashes,
    ...(typeof r.title === "string" && { title: r.title.slice(0, 300) }),
    ...(Array.isArray(r.failing) && { failing: r.failing.map(String).slice(0, 20) }),
    ...(Number.isInteger(r.stackedOn) && { stackedOn: r.stackedOn }),
    ...(typeof r.owner === "string" && { owner: r.owner.slice(0, 100) }),
    ...(r.blast && { blast: r.blast }),
  };
}
