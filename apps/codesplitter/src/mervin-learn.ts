// Layout: Mervin learning (#1511): R2 SQL result rows in, plan weights, demoted levels and rule suggestions out
// Design: docs/mervin.md "Learning your merge patterns". Pure functions over rows the event table's queries
// return; the store (#1508), the event emitter (#1509) and the opt-in (#1510) feed them. Nothing here changes how a
// merge is computed: it only orders a plan's tie-breaks, demotes a resolver level to a card, and proposes rules.

/** A table of one repo's merge events, as the R2 SQL queries below see it. */
export const EVENTS = "mervin_events";

/** The three questions asked of the event table. `repo` is quoted by the caller's binding, not interpolated here. */
export const queries = {
  fights: `SELECT ext, path_hash, count(*) AS fights FROM ${EVENTS} WHERE repo = ? AND outcome = 'card' GROUP BY ext, path_hash`,
  levels: `SELECT level, count(*) AS settled, sum(CASE WHEN wrong THEN 1 ELSE 0 END) AS wrong FROM ${EVENTS} WHERE repo = ? AND outcome != 'card' GROUP BY level`,
  answers: `SELECT path_hash, path, answer, count(*) AS n FROM ${EVENTS} WHERE repo = ? AND outcome = 'card' AND answer != 'written' GROUP BY path_hash, path, answer`,
} as const;

export interface FightRow { ext: string; path?: string; fights: number }
export interface LevelRow { level: string; settled: number; wrong: number }
export interface AnswerRow { path: string; answer: "main" | "branch" | "both" | "agent" | "written"; n: number }

/** A level with at least this many settled merges and this share of them wrong goes back to a card. */
export const MIN_SETTLED = 5;
export const MAX_WRONG = 0.2;
/** A path's card answer repeats when this many answers agree and make up this share of its answers. */
export const MIN_REPEATS = 3;
export const MIN_SHARE = 0.8;

/** Fights per extension and per path: how often it ended in a card on this repo. */
export function fightWeights(rows: FightRow[]): { ext: Map<string, number>; path: Map<string, number> } {
  const ext = new Map<string, number>(), path = new Map<string, number>();
  for (const r of rows) {
    ext.set(r.ext, (ext.get(r.ext) ?? 0) + r.fights);
    if (r.path) path.set(r.path, (path.get(r.path) ?? 0) + r.fights);
  }
  return { ext, path };
}

const extOf = (p: string) => { const m = /\.([^./]+)$/.exec(p); return m ? m[1]!.toLowerCase() : ""; };

/** How much a branch's files have fought here: the path's own count, else its extension's. */
export function branchWeight(files: string[], w: ReturnType<typeof fightWeights>): number {
  return files.reduce((sum, f) => sum + (w.path.get(f) ?? w.ext.get(extOf(f)) ?? 0), 0);
}

/**
 * The merge order with the fight-prone branches last among equals. `order` stays the order (ready first); only
 * a branch whose files fight more moves after a calmer one that was behind it by at most `slack` places, so a
 * plan never jumps far from the deterministic one. With no history the order comes back unchanged.
 */
export function weightOrder(order: string[], files: Map<string, string[]>, w: ReturnType<typeof fightWeights>, slack = 1): string[] {
  const score = (b: string) => branchWeight(files.get(b) ?? [], w);
  const out = [...order];
  for (let i = 0; i < out.length - 1; i++) {
    const b = out[i]!;
    if (score(b) > score(out[i + 1]!) && i - order.indexOf(b) < slack) [out[i], out[i + 1]] = [out[i + 1]!, b];
  }
  return out;
}

/** The resolver levels this repo's people have undone too often: the plan shows their merges as cards instead. */
export function demotedLevels(rows: LevelRow[]): string[] {
  return rows.filter((r) => r.settled >= MIN_SETTLED && r.wrong / r.settled > MAX_WRONG).map((r) => r.level).sort();
}

export interface Suggestion { path: string; answer: "main" | "branch" | "both"; n: number; rule: string }

const ATTR = { main: "merge=ours", branch: "merge=theirs", both: "merge=union" } as const;

/** Card answers that repeat, per path: offered first on the card, and as a `.gitattributes` line for a person to approve. */
export function suggestions(rows: AnswerRow[]): Suggestion[] {
  const by = new Map<string, AnswerRow[]>();
  for (const r of rows) if (r.answer in ATTR) by.set(r.path, [...by.get(r.path) ?? [], r]);
  const total = new Map<string, number>();
  for (const r of rows) total.set(r.path, (total.get(r.path) ?? 0) + r.n);
  const out: Suggestion[] = [];
  for (const [path, rs] of by) {
    const top = rs.reduce((a, b) => (b.n > a.n ? b : a));
    if (top.n >= MIN_REPEATS && top.n / total.get(path)! >= MIN_SHARE) {
      const answer = top.answer as Suggestion["answer"];
      out.push({ path, answer, n: top.n, rule: `${path} ${ATTR[answer]}` });
    }
  }
  return out.sort((a, b) => b.n - a.n || a.path.localeCompare(b.path));
}
