// The swarm week (notes/FAKE_SWARM_REPLAY.md): every PR opened on this repo in one week, read only (`gh`, `git`), as a
// short row each for the swarm replay (src/swarm-replay.ts, swarm-watch.html). Real PR numbers and titles; the agents
// on the page are made up from the number.
//
//   bun scripts/swarm-week.ts [--from 2026-10-07] [--to 2026-10-15] [--repo owner/name] [--cache dir] [--out src/swarm-week.json]
//
// Run it from a checkout with `origin/main` fetched. Heuristics, like jam-report.ts, so they undercount:
// - git-blocked: a "merge main" / conflict / rebase commit or a force push at t says the PR was conflicted before t,
//   since main last moved under one of its files (or 30 minutes, when its files aren't known).
// - test-blocked: a failed workflow run on its branch, until that workflow next passes there.
import { $ } from "bun";
import { mkdirSync } from "node:fs";
import { conflictCommits } from "./jam-report.ts";
import type { Week, WeekRow } from "../src/swarm-replay.ts";

const MIN = 6e4;

async function gql(repo: string, nums: number[]) {
  const [owner, name] = repo.split("/");
  const one = (n: number) => `p${n}:pullRequest(number:${n}){number title createdAt mergedAt closedAt headRefName mergeable commits(last:100){nodes{commit{committedDate messageHeadline}}} timelineItems(last:50,itemTypes:[HEAD_REF_FORCE_PUSHED_EVENT]){nodes{... on HeadRefForcePushedEvent{createdAt}}}}`;
  const q = `{repository(owner:"${owner}",name:"${name}"){${nums.map(one).join(" ")}}}`;
  for (let tries = 0; tries < 6; tries++) {
    const r = await $`gh api graphql -f query=${q}`.quiet().nothrow();
    if (!r.exitCode) return Object.values(JSON.parse(r.stdout.toString()).data.repository) as any[];
    await Bun.sleep(2000 * (tries + 1));
  }
  throw new Error(`GitHub kept failing for PRs ${nums[0]}..${nums.at(-1)}`);
}

/** Red spans per branch: from a failed run's end until the same workflow next passes on that branch. */
export function redSpans(runs: { branch: string; name: string; ok: boolean; at: number }[]) {
  const out = new Map<string, [number, number | null][]>();
  const by = new Map<string, typeof runs>();
  for (const r of runs) { const k = `${r.branch}\0${r.name}`; by.set(k, [...(by.get(k) ?? []), r]); }
  for (const [k, list] of by) {
    const branch = k.split("\0")[0]!, spans = out.get(branch) ?? [];
    let from: number | null = null;
    for (const r of list.sort((a, b) => a.at - b.at)) {
      if (!r.ok && from === null) from = r.at;
      else if (r.ok && from !== null) { spans.push([from, r.at]); from = null; }
    }
    if (from !== null) spans.push([from, null]);
    out.set(branch, spans);
  }
  return out;
}

/** Git-blocked spans: each fix at t closes a span opened by the last main merge under one of the PR's files before t. */
export function gitSpans(fixes: number[], since: number, mainMoves: number[]): [number, number][] {
  const out: [number, number][] = [];
  let after = since;
  for (const t of [...fixes].sort((a, b) => a - b)) {
    const moved = mainMoves.filter((m) => m > after && m < t);
    out.push([moved.length ? Math.min(...moved) : Math.max(after, t - 30 * MIN), t]);
    after = t;
  }
  return out;
}

if (import.meta.main) {
  const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const repo = arg("--repo") ?? "QuinnsCode/RustyBuns", cache = arg("--cache") ?? `${process.env.TMPDIR ?? "/tmp"}/swarm-week`;
  const fromDay = arg("--from") ?? "2026-10-07", toDay = arg("--to") ?? "2026-10-15";
  // Midnight Pacific, as the team reads its days.
  const start = +new Date(`${fromDay}T07:00:00Z`), end = Math.min(+new Date(`${toDay}T07:00:00Z`), Date.now());
  mkdirSync(cache, { recursive: true });

  const nums = (await $`gh pr list --repo ${repo} --state all --search ${`created:${fromDay}..${toDay}`} --limit 3000 --json number --jq ${".[].number"}`.text()).trim().split("\n").map(Number);
  const detail = new Map<number, any>(), file = Bun.file(`${cache}/detail.json`);
  if (await file.exists()) for (const d of await file.json()) detail.set(d.number, d);
  const todo = nums.filter((n) => !detail.has(n));
  for (let i = 0; i < todo.length; i += 10) {
    for (const d of await gql(repo, todo.slice(i, i + 10))) if (d) detail.set(d.number, d);
    await Bun.write(file, JSON.stringify([...detail.values()]));
    console.error(`${detail.size}/${nums.length}`);
  }

  const runFile = Bun.file(`${cache}/runs.json`);
  let runs: { branch: string; name: string; ok: boolean; at: number }[];
  if (await runFile.exists()) runs = await runFile.json();
  else {
    // The runs API stops at 1,000 per query, so ask a day at a time.
    runs = [];
    for (let d = start - 864e5; d < end; d += 864e5) {
      const day = new Date(d).toISOString().slice(0, 10);
      const txt = (await $`gh api ${`repos/${repo}/actions/runs?created=${day}&status=completed&per_page=100`} --paginate --jq ${".workflow_runs[]|[.head_branch,.name,.conclusion,.updated_at]|@tsv"}`.text()).trim();
      for (const l of txt ? txt.split("\n") : []) {
        const [branch, name, conclusion, at] = l.split("\t");
        if (conclusion === "success" || conclusion === "failure") runs.push({ branch: branch!, name: name!, ok: conclusion === "success", at: +new Date(at!) });
      }
      console.error(`runs ${day}: ${runs.length}`);
    }
    await Bun.write(runFile, JSON.stringify(runs));
  }
  const red = redSpans(runs);

  // Squash merges: a PR's files are its one commit on main, and that commit's time is when main moved under them.
  // The app was renamed once; fold the old name in, as jam-report.ts does.
  const files = new Map<number, string[]>(), moves: { at: number; files: string[] }[] = [];
  const log = (await $`git log origin/main --first-parent --since=${new Date(start - 7 * 864e5).toISOString()} --format=@@%ct%x09%s --name-only`.text()).split("@@").slice(1);
  for (const b of log) {
    const [head, ...f] = b.split("\n"), [ct, subject] = head!.split("\t"), m = subject!.match(/\(#(\d+)\)$/), list = f.filter(Boolean).map((x) => x.replace("apps/codesplitters/", "apps/codesplitter/"));
    if (m) files.set(+m[1]!, list);
    moves.push({ at: +ct! * 1000, files: list });
  }

  const at = (iso: string | null) => (iso ? Math.round((+new Date(iso) - start) / MIN) : null);
  const clip = (s: [number, number | null][], z: number | null): [number, number][] =>
    s.map(([a, b]): [number, number] => [Math.round((a - start) / MIN), Math.round(((b ?? (z !== null ? z * MIN + start : end)) - start) / MIN)])
      .map(([a, b]): [number, number] => [a, z !== null ? Math.min(b, z) : b]).filter(([a, b]) => b > a);
  const rows: WeekRow[] = [...detail.values()].filter((d) => nums.includes(d.number)).map((d) => {
    const opened = +new Date(d.createdAt), z = at(d.mergedAt ?? d.closedAt), f = files.get(d.number) ?? [];
    const commits = d.commits.nodes.map((c: any) => c.commit);
    const fixes = [
      ...commits.filter((c: any) => conflictCommits([c.messageHeadline])).map((c: any) => +new Date(c.committedDate)),
      ...d.timelineItems.nodes.map((n: any) => +new Date(n.createdAt)),
    ].filter((t) => t >= opened);
    const under = moves.filter((m) => m.files.some((x) => f.includes(x))).map((m) => m.at);
    let g = gitSpans(fixes, opened, under);
    if (z === null && d.mergeable === "CONFLICTING") g = [...g, [Math.max(opened, ...g.map(([, b]) => b)), end]];
    const last = Math.max(opened, ...commits.map((c: any) => +new Date(c.committedDate)));
    const row: WeekRow & { f?: string[] } = {
      n: d.number, t: d.title, a: at(d.createdAt)!, z, m: !!d.mergedAt, w: Math.round((last - start) / MIN),
      g: clip(g, z), r: clip(red.get(d.headRefName) ?? [], z).filter(([a]) => a >= Math.round((opened - start) / MIN)),
    };
    if (f.length) row.f = f;
    return row;
  }).sort((a, b) => a.n - b.n);
  // Only the shared files many PRs touched (the ones a crowd piles into) keep their names, as indexes into `hot`.
  const touched = new Map<string, number>();
  for (const r of rows) for (const f of (r as any).f ?? []) touched.set(f, (touched.get(f) ?? 0) + 1);
  const hot = [...touched].filter(([, n]) => n >= 12).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([f]) => f);
  for (const r of rows as any[]) { const h = (r.f ?? []).map((f: string) => hot.indexOf(f)).filter((i: number) => i >= 0); delete r.f; if (h.length) r.h = h; }

  // The ship times: Mervin's first merge board and Ester's first failing-test sort, from main's history.
  const ship = async (re: string) => +(await $`git log origin/main --first-parent --reverse --format=%ct -E --grep=${re}`.text()).trim().split("\n")[0]! * 1000;
  const week: Week = {
    repo, start, minutes: Math.round((end - start) / MIN),
    marks: [
      { who: "Mervin", at: Math.round(((await ship("^Mervin board")) - start) / MIN) },
      { who: "Ester", at: Math.round(((await ship("^Ester( the tester)?:")) - start) / MIN) },
    ],
    hot,
    rows,
  };
  const out = arg("--out") ?? `${import.meta.dir}/../src/swarm-week.json`;
  await Bun.write(out, JSON.stringify(week));
  console.log(`${rows.length} PRs, ${rows.filter((r) => r.g.length).length} git-blocked, ${rows.filter((r) => r.r.length).length} test-blocked -> ${out}`);
}
