// Where merged PRs got stuck, from real data: every PR on this repo, read only (`gh`, `git`). Mervin's job is the
// "stuck on main" half (conflicts, rebases, migration stamps), Ester's the "stuck on a red check" half.
//
//   bun scripts/jam-report.ts [--repo owner/name] [--cache dir] [--svg docs/jams-curve.svg] [--json]
//
// Run it from a checkout with `origin/main` fetched: the files a PR touched come from its squash commit, `(#123)`.
// Signals (heuristics, so they undercount): a PR is "jammed" when it has a "merge main" or conflict/rebase commit or a
// force push; "red" when GitHub has a failed workflow run on its branch.
import { $ } from "bun";
import { mkdirSync } from "node:fs";

export interface Row { n: number; created: number; merged: number; commits: number; conflicts: number; pushes: number; red: number; files: string[] }

const CONFLICT = /merge (remote-tracking )?(branch )?'?(origin\/)?main|merge main|conflict|rebase|rebuild/i;
const DAY = 864e5;
const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);
const jammed = (r: Row) => r.conflicts > 0 || r.pushes > 0;
export const isJam = jammed;
export const conflictCommits = (heads: string[]) => heads.filter((h) => CONFLICT.test(h)).length;

/** PRs open when each PR was created, bucketed; the share of each bucket that jammed. */
export function jamByCrowd(rows: Row[]) {
  const buckets = [["0-2", 0, 2], ["3-5", 3, 5], ["6-9", 6, 9], ["10+", 10, Infinity]] as const;
  return buckets.map(([label, lo, hi]) => {
    const inB = rows.filter((r) => { const open = rows.filter((x) => x !== r && x.created <= r.created && x.merged > r.created).length; return open >= lo && open <= hi; });
    return { label, prs: inB.length, jammed: inB.filter(jammed).length, rate: pct(inB.filter(jammed).length, inB.length) };
  });
}

/** Per file: how many PRs touched it and how many pairs of those were open at the same time (toe steps). */
export function hotFiles(rows: Row[], top = 8) {
  const by = new Map<string, Row[]>();
  for (const r of rows) for (const f of r.files) by.set(f, [...(by.get(f) ?? []), r]);
  return [...by].map(([file, l]) => {
    let pairs = 0;
    for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) if (l[i]!.created < l[j]!.merged && l[j]!.created < l[i]!.merged) pairs++;
    return { file, prs: l.length, pairs };
  }).sort((a, b) => b.pairs - a.pairs).slice(0, top);
}

export function perDay(rows: Row[]) {
  const days = new Map<string, { merged: number; jammed: number; red: number }>();
  for (const r of rows) {
    const d = new Date(r.merged).toISOString().slice(0, 10), v = days.get(d) ?? { merged: 0, jammed: 0, red: 0 };
    v.merged++; if (jammed(r)) v.jammed++; if (r.red) v.red++;
    days.set(d, v);
  }
  return [...days].sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => ({ day, ...v }));
}

/** Two small charts: merges and jammed PRs per day, and the jam rate as the crowd grows. */
export function svg(rows: Row[]) {
  const days = perDay(rows), crowd = jamByCrowd(rows), W = 760, H = 560, max = Math.max(...days.map((d) => d.merged), 1);
  const bw = (W - 80) / days.length, y = (v: number) => 230 - (v / max) * 190;
  const bars = days.map((d, i) => {
    const x = 50 + i * bw;
    return `<rect x="${x + 3}" y="${y(d.merged)}" width="${bw - 6}" height="${230 - y(d.merged)}" fill="#d0d7de"/>`
      + `<rect x="${x + 3}" y="${y(d.jammed)}" width="${bw - 6}" height="${230 - y(d.jammed)}" fill="#fb8500"/>`
      + `<text x="${x + bw / 2}" y="${y(d.merged) - 4}" font-size="10" text-anchor="middle" fill="#57606a">${d.merged}</text>`
      + `<text x="${x + bw / 2}" y="246" font-size="10" text-anchor="middle" fill="#57606a">${d.day.slice(5)}</text>`;
  }).join("");
  const cw = 90, cb = crowd.map((c, i) => {
    const x = 50 + i * cw, h = (c.rate / 60) * 150;
    return `<rect x="${x}" y="${540 - h - 30}" width="${cw - 20}" height="${h}" fill="#fb8500"/>`
      + `<text x="${x + (cw - 20) / 2}" y="${540 - h - 34}" font-size="11" text-anchor="middle" fill="#24292f">${c.rate}%</text>`
      + `<text x="${x + (cw - 20) / 2}" y="538" font-size="10" text-anchor="middle" fill="#57606a">${c.label}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="-apple-system,Segoe UI,sans-serif">`
    + `<rect width="${W}" height="${H}" fill="#fff"/>`
    + `<text x="50" y="24" font-size="13" font-weight="600" fill="#24292f">PRs merged per day (grey) and the ones that jammed (orange)</text>${bars}`
    + `<text x="50" y="316" font-size="13" font-weight="600" fill="#24292f">Jam rate by PRs already open</text>${cb}</svg>`;
}

// ---- collecting (not unit tested: it is gh and git) --------------------------------------------------------------

async function gql(repo: string, nums: number[]) {
  const [owner, name] = repo.split("/");
  const one = (n: number) => `p${n}:pullRequest(number:${n}){number commits(first:60){totalCount nodes{commit{messageHeadline}}} timelineItems(first:60,itemTypes:[HEAD_REF_FORCE_PUSHED_EVENT]){nodes{__typename}}}`;
  const q = `{repository(owner:"${owner}",name:"${name}"){${nums.map(one).join(" ")}}}`;
  for (let tries = 0; tries < 6; tries++) {
    const r = await $`gh api graphql -f query=${q}`.quiet().nothrow();
    if (!r.exitCode) return Object.values(JSON.parse(r.stdout.toString()).data.repository) as any[];
    await Bun.sleep(2000 * (tries + 1));
  }
  throw new Error(`GitHub kept failing for PRs ${nums[0]}..${nums.at(-1)}`);
}

export async function collect(repo: string, cache: string): Promise<Row[]> {
  mkdirSync(cache, { recursive: true });
  const list = (await $`gh api ${`repos/${repo}/pulls?state=all&per_page=100`} --paginate --jq ${".[]|{n:.number,c:.created_at,m:.merged_at,h:.head.ref}"}`.text()).trim().split("\n").map((l) => JSON.parse(l));
  const runs = (await $`gh api ${`repos/${repo}/actions/runs?status=failure&per_page=100`} --paginate --jq ${".workflow_runs[]|.head_branch"}`.text()).trim().split("\n");
  const redBy = new Map<string, number>();
  for (const b of runs) redBy.set(b, (redBy.get(b) ?? 0) + 1);

  const merged = list.filter((p) => p.m), detail = new Map<number, any>();
  const file = Bun.file(`${cache}/detail.json`);
  if (await file.exists()) for (const d of await file.json()) detail.set(d.number, d);
  const todo = merged.map((p) => p.n).filter((n) => !detail.has(n));
  for (let i = 0; i < todo.length; i += 8) {
    for (const d of await gql(repo, todo.slice(i, i + 8))) if (d) detail.set(d.number, d);
    await Bun.write(file, JSON.stringify([...detail.values()]));
    console.error(`${detail.size}/${merged.length}`);
  }

  // This repo squash-merges, so a PR's files are its one commit on main; the app was renamed once, fold the old name in.
  const files = new Map<number, string[]>();
  const log = (await $`git log origin/main --first-parent --format=@@%s --name-only`.text()).split("@@").slice(1);
  for (const b of log) {
    const [head, ...f] = b.split("\n"), m = head!.match(/\(#(\d+)\)$/);
    if (m) files.set(+m[1]!, f.filter(Boolean).map((x) => x.replace("apps/codesplitters/", "apps/codesplitter/")));
  }
  return merged.map((p) => {
    const d = detail.get(p.n);
    return { n: p.n, created: +new Date(p.c), merged: +new Date(p.m), commits: d.commits.totalCount, conflicts: conflictCommits(d.commits.nodes.map((c: any) => c.commit.messageHeadline)), pushes: d.timelineItems.nodes.length, red: redBy.get(p.h) ?? 0, files: files.get(p.n) ?? [] };
  });
}

export function summary(rows: Row[]) {
  const jam = rows.filter(jammed), clean = rows.filter((r) => !jammed(r) && !r.red), red = rows.filter((r) => r.red);
  const avg = (a: Row[], f: (r: Row) => number) => (a.length ? a.reduce((s, r) => s + f(r), 0) / a.length : 0);
  const hrs = (r: Row) => (r.merged - r.created) / (DAY / 24);
  return {
    merged: rows.length, jammed: jam.length, jamPct: pct(jam.length, rows.length), red: red.length, redPct: pct(red.length, rows.length),
    hoursOpenJammed: +avg(jam, hrs).toFixed(2), hoursOpenClean: +avg(clean, hrs).toFixed(2),
    commitsJammed: +avg(jam, (r) => r.commits).toFixed(1), commitsClean: +avg(clean, (r) => r.commits).toFixed(1),
    perDay: perDay(rows), byCrowd: jamByCrowd(rows), hotFiles: hotFiles(rows),
  };
}

if (import.meta.main) {
  const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const rows = await collect(arg("--repo") ?? "QuinnsCode/RustyBuns", arg("--cache") ?? `${process.env.TMPDIR ?? "/tmp"}/jam-report`);
  const out = arg("--svg");
  if (out) await Bun.write(out, svg(rows));
  console.log(JSON.stringify(summary(rows), null, 2));
}
