// The week by day: tokens (raw kinds and units at API ratios), what Mervin, Ester and Dexter hand back, PRs merged, and the
// code that landed on main, as JSON. Dexter's week only sums these; a saving nobody sees per day is invisible. Same transcripts
// (subagents' too), same `tally`, split at local midnight. `size` is the repo's code lines at the end of every day since the first commit.
// Run: bun apps/agent-office/ester/ledger.ts [days=8] > ledger.json   (PRs come from `gh`, so it needs a signed-in gh)
// Claude Code keeps 30 days of transcripts, so tokens stop there; git goes back to the start.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { arr, num, obj, str } from "@rustybuns/util/guard";
import { noModes, recent, SAVES, SETTLES, tally, units, type Report } from "./dexter.ts";

const blank = (): Report => ({ sessions: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, tools: new Map(), turns: 0, days: new Map(), helpers: { mervin: 0, ester: 0, dexter: 0 }, fights: 0, episodes: 0, modes: noModes(), chores: new Map() });
const day = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }; // local YYYY-MM-DD

/** What counts as code: source, styles, markup, SQL and shell. Not docs, JSON, lockfiles or data. */
export const CODE = /\.(ts|tsx|js|cjs|mjs|rs|py|swift|css|html|sql|sh)$/;

/** Code lines added and removed per day on main, from `git log --first-parent --numstat --format=@%ct` output. */
export function codeByDay(log: string): Map<string, { added: number; removed: number }> {
  const out = new Map<string, { added: number; removed: number }>();
  let at = "";
  for (const line of log.split("\n")) {
    if (line.startsWith("@")) { at = day(Number(line.slice(1)) * 1000); continue; }
    const [a, r, file] = line.split("\t");
    if (!at || !file || a === "-" || !CODE.test(file.replace(/[{}]/g, "").split(" => ").pop() ?? "")) continue;
    const e = out.get(at) ?? out.set(at, { added: 0, removed: 0 }).get(at)!;
    e.added += Number(a); e.removed += Number(r);
  }
  return out;
}

if (import.meta.main) {
  const days = Number(process.argv[2]) || 8;
  const per = new Map<string, Report>();
  const files = recent(path.join(homedir(), ".claude/projects"), days * 24, Date.now(), true);
  const stamp = /"timestamp":"([^"]+)"/;
  for (const f of files) {
    const buckets = new Map<string, string[]>();
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const t = stamp.exec(line)?.[1];
      if (!t) continue;
      const k = day(Date.parse(t));
      (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(line);
    }
    for (const [k, lines] of buckets) {
      const r = per.get(k) ?? per.set(k, blank()).get(k)!;
      r.sessions++;
      tally(lines, r);
    }
  }

  const Merged = arr(obj({ mergedAt: str(40), additions: num(0, 1e9), deletions: num(0, 1e9) }), 5000);
  const prs = Merged(JSON.parse(Bun.spawnSync(["gh", "pr", "list", "--state", "merged", "--limit", "5000", "--json", "number,mergedAt,additions,deletions"]).stdout.toString()));
  const merged = new Map<string, { prs: number; added: number; removed: number }>();
  for (const p of prs) {
    const e = merged.get(day(Date.parse(p.mergedAt))) ?? { prs: 0, added: 0, removed: 0 };
    e.prs++; e.added += p.additions; e.removed += p.deletions;
    merged.set(day(Date.parse(p.mergedAt)), e);
  }

  const code = codeByDay(Bun.spawnSync(["git", "log", "--first-parent", "--reverse", "--numstat", "--format=@%ct", "HEAD"], { stdout: "pipe" }).stdout.toString());
  const size: { date: string; code: number }[] = [];
  let lines = 0;
  for (const [date, c] of [...code].sort()) { lines += c.added - c.removed; size.push({ date, code: lines }); }

  const cutoff = day(Date.now() - (days - 1) * 864e5);
  const rows = [...per.entries()].filter(([k]) => k >= cutoff).sort().map(([date, r]) => ({
    date, sessions: r.sessions, turns: r.turns, units: units(r.usage), ...r.usage,
    fights: r.fights, episodes: r.episodes, ciReads: r.helpers.mervin, testOutput: r.helpers.ester, oversize: r.helpers.dexter, // what those jobs cost done by hand
    mervin: r.helpers.mervin * SAVES + r.fights * SETTLES, ester: r.helpers.ester * SAVES, dexter: r.helpers.dexter * SAVES,
    ...(merged.get(date) ?? { prs: 0, added: 0, removed: 0 }),
    codeAdded: code.get(date)?.added ?? 0, codeRemoved: code.get(date)?.removed ?? 0,
  }));
  console.log(JSON.stringify({ generated: new Date().toISOString(), saves: SAVES, settles: SETTLES, rows, size }, null, 1));
}
