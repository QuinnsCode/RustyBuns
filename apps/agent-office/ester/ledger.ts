// The week by day: tokens (units at API ratios), what Mervin, Ester and Dexter hand back, and PRs merged, as JSON.
// Dexter's week only sums these; a saving nobody sees per day is invisible. Same transcripts, same `tally`, split at local midnight.
// Run: bun apps/agent-office/ester/ledger.ts [days=8] > ledger.json   (PRs come from `gh`, so it needs a signed-in gh)
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { arr, num, obj, str } from "@rustybuns/util/guard";
import { noModes, recent, SAVES, SETTLES, tally, units, type Report } from "./dexter.ts";

const blank = (): Report => ({ sessions: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, tools: new Map(), turns: 0, days: new Map(), helpers: { mervin: 0, ester: 0, dexter: 0 }, fights: 0, episodes: 0, modes: noModes(), chores: new Map() });
const day = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }; // local YYYY-MM-DD

const days = Number(process.argv[2]) || 8;
const per = new Map<string, Report>();
const files = recent(path.join(homedir(), ".claude/projects"), days * 24);
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
const prs = Merged(JSON.parse(Bun.spawnSync(["gh", "pr", "list", "--state", "merged", "--limit", "1000", "--json", "number,mergedAt,additions,deletions"]).stdout.toString()));
const merged = new Map<string, { prs: number; added: number; removed: number }>();
for (const p of prs) {
  const e = merged.get(day(Date.parse(p.mergedAt))) ?? { prs: 0, added: 0, removed: 0 };
  e.prs++; e.added += p.additions; e.removed += p.deletions;
  merged.set(day(Date.parse(p.mergedAt)), e);
}

const cutoff = day(Date.now() - (days - 1) * 864e5);
const rows = [...per.entries()].filter(([k]) => k >= cutoff).sort().map(([date, r]) => ({
  date, sessions: r.sessions, turns: r.turns, units: units(r.usage), output: r.usage.output,
  fights: r.fights, episodes: r.episodes, mervin: r.helpers.mervin * SAVES + r.fights * SETTLES, ester: r.helpers.ester * SAVES, dexter: r.helpers.dexter * SAVES,
  ...(merged.get(date) ?? { prs: 0, added: 0, removed: 0 }),
}));
console.log(JSON.stringify({ generated: new Date().toISOString(), saves: SAVES, settles: SETTLES, rows }, null, 1));
