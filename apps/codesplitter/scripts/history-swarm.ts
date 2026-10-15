// A swarm that reads this repo's history (plan: notes/HISTORY_SWARM.md). This script is the two ends of it; the
// readers in the middle are agents, read-only (`gh`, `git log`, `git show`), one per slice.
//
//   bun scripts/history-swarm.ts split [--per 100] [--max 8] [--out notes/history-swarm] [--repo o/n] [--cache dir]
//   bun scripts/history-swarm.ts merge [--out notes/history-swarm]
//
// `split` writes `<out>/slice-NN.task.md` (one per slice, with the PR numbers and what to write) and refuses to
// make more than --max slices, so the fan-out is counted before it runs. A reader writes `<out>/slice-NN.json`: an
// array of `Reading` rows. `merge` checks those rows and prints where they disagree with jam-report's heuristic.
import { isJam, type Row } from "./jam-report.ts";

export interface Reading { pr: number; jammed: boolean; why: string; file: string; mervinWouldClear: boolean }

export const MAX_READERS = 8;
export const PER_SLICE = 100;

/** Cut merged PRs, oldest first, into slices of at most `per`; more than `max` slices is an error, not a bigger swarm. */
export function slices(rows: Row[], per = PER_SLICE, max = MAX_READERS) {
  const sorted = [...rows].sort((a, b) => a.merged - b.merged);
  const out: Row[][] = [];
  for (let i = 0; i < sorted.length; i += per) out.push(sorted.slice(i, i + per));
  if (out.length > max) throw new Error(`${sorted.length} PRs make ${out.length} slices of ${per}; the cap is ${max} readers`);
  return out;
}

export const sliceName = (i: number) => `slice-${String(i + 1).padStart(2, "0")}`;

export function taskFile(i: number, rows: Row[], repo: string) {
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  return `# ${sliceName(i)}: ${rows.length} merged PRs of ${repo}, ${day(rows[0]!.merged)} to ${day(rows.at(-1)!.merged)}

Read-only: \`gh pr view\`, \`gh pr diff\`, \`git log\`, \`git show\`. Never comment, push or change anything on GitHub.
For each PR below, read its diff and threads and write one row. Save the array to \`${sliceName(i)}.json\`:

    { "pr": 123, "jammed": true, "why": "one sentence", "file": "the file it clashed on, or ''", "mervinWouldClear": false }

jammed: a real clash, a renumbered migration or churn (not just a title that says "rebase").
mervinWouldClear: would Mervin's line-id merge or the wave plan have cleared it.

PRs: ${rows.map((r) => r.n).join(", ")}
`;
}

/** Rows a reader wrote, checked against the PRs it was given. */
export function check(given: number[], raw: unknown): { rows: Reading[]; problems: string[] } {
  const problems: string[] = [], rows: Reading[] = [], seen = new Set<number>();
  if (!Array.isArray(raw)) return { rows, problems: ["not an array"] };
  for (const r of raw as Record<string, unknown>[]) {
    const ok = r && typeof r.pr === "number" && typeof r.jammed === "boolean" && typeof r.why === "string" && typeof r.file === "string" && typeof r.mervinWouldClear === "boolean";
    if (!ok) { problems.push(`bad row ${JSON.stringify(r)}`); continue; }
    if (!given.includes(r.pr as number)) { problems.push(`#${r.pr} was not in this slice`); continue; }
    if (seen.has(r.pr as number)) { problems.push(`#${r.pr} twice`); continue; }
    seen.add(r.pr as number);
    rows.push(r as unknown as Reading);
  }
  for (const n of given) if (!seen.has(n)) problems.push(`#${n} has no row`);
  return { rows, problems };
}

/** Where the reader and the title heuristic disagree, and the totals. */
export function compare(readings: Reading[], rows: Row[]) {
  const by = new Map(rows.map((r) => [r.n, r]));
  const disagree = readings.filter((r) => by.has(r.pr) && isJam(by.get(r.pr)!) !== r.jammed).map((r) => ({ pr: r.pr, heuristic: isJam(by.get(r.pr)!), reader: r.jammed, why: r.why }));
  const jammed = readings.filter((r) => r.jammed);
  return { prs: readings.length, jammed: jammed.length, mervinWouldClear: jammed.filter((r) => r.mervinWouldClear).length, disagree };
}

if (import.meta.main) {
  const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const out = arg("--out") ?? "notes/history-swarm", repo = arg("--repo") ?? "QuinnsCode/RustyBuns";
  const { collect } = await import("./jam-report.ts");
  const rows = await collect(repo, arg("--cache") ?? `${process.env.TMPDIR ?? "/tmp"}/jam-report`);
  const cut = slices(rows, +(arg("--per") ?? PER_SLICE), +(arg("--max") ?? MAX_READERS));
  if (process.argv[2] === "split") {
    for (const [i, s] of cut.entries()) await Bun.write(`${out}/${sliceName(i)}.task.md`, taskFile(i, s, repo));
    console.log(`${cut.length} readers, ${rows.length} PRs; tasks in ${out}/. Approve the fan-out before starting them.`);
  } else if (process.argv[2] === "merge") {
    const all: Reading[] = [];
    for (const [i, s] of cut.entries()) {
      const f = Bun.file(`${out}/${sliceName(i)}.json`);
      if (!(await f.exists())) { console.error(`${sliceName(i)}: no rows yet`); continue; }
      const { rows: ok, problems } = check(s.map((r) => r.n), await f.json());
      for (const p of problems) console.error(`${sliceName(i)}: ${p}`);
      all.push(...ok);
    }
    console.log(JSON.stringify(compare(all, rows), null, 2));
  } else console.error("usage: history-swarm.ts split|merge");
}
