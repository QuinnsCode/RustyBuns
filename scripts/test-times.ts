// How long each app's test files take, read from CI's own logs, so scripts/ci-apps.ts can spread them over lanes of
// about equal time (#5229). Nothing records times on purpose: any green `test <app>` job (every lane of one run) has them.
//
//   bun scripts/test-times.ts                  every app with tests, from the newest green run of each in the last 100 apps.yml runs
//   bun scripts/test-times.ts mythic-masters   just these apps
//   bun scripts/test-times.ts --runs 300       look further back (an app nobody touched lately)
//
// Writes <app dir>/test-times.json (scripts/app-dirs.ts): { "test/foo.test.ts": ms }. A file's time is its tests' own times added up, or the
// wall time from its header to the next one when that is longer (a slow beforeAll, a browser launch), since bun runs
// files one after another. Files that no longer exist are dropped; one missing from the record is weighed by its size.
// A group job ("test borg+qcrm", #5564) gives each of its apps its own part of the log (scripts/ci-group.ts).
import { appDir } from "./app-dirs.ts";
import { APPS } from "./ci-apps.ts";
import { section } from "./ci-group.ts";
import { testFiles } from "./ci-test-count.ts";
import { help } from "./help.ts";
import { arr, check, int, obj, str } from "../packages/util/src/guard.ts";

help(import.meta.path);

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

/** Total ms per test file in one `bun test` job's log, as GitHub Actions keeps it (a timestamp on every line). */
export function timesFromLog(log: string): Record<string, number> {
  const out: Record<string, number> = {};
  let file = "", since = 0;
  const close = (at: number) => { if (file && at > since) out[file] = Math.max(out[file]!, Math.round(at - since)); };
  for (const raw of strip(log).split("\n")) {
    const m = raw.match(/^(\d{4}-\d\d-\d\dT[\d:.]+Z) ?(.*)$/);
    const at = m ? Date.parse(m[1]!) : NaN, line = (m ? m[2]! : raw).trimEnd();
    const head = line.match(/^(?:##\[group\])?(\S+[._](?:test|spec)\.[cm]?[jt]sx?):$/);
    if (head) {
      close(at);
      file = head[1]!.replace(/^\.\//, "");
      out[file] ??= 0;
      since = at;
      continue;
    }
    const t = line.match(/^\((?:pass|fail)\) .*\[([\d.]+)(ms|s)\]$/);
    if (t && file) { out[file] = Math.round(out[file]! + Number(t[1]) * (t[2] === "s" ? 1000 : 1)); continue; }
    if (/^\s*\d+ (pass|fail)$/.test(line) || /^Ran \d+ tests? across/.test(line)) { close(at); file = ""; }
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

const Runs = arr(obj({ databaseId: int(1, Number.MAX_SAFE_INTEGER) }), 1000);
const Jobs = obj({ jobs: arr(obj({ id: int(1, Number.MAX_SAFE_INTEGER), name: str(300), conclusion: str(40, { dflt: "" }) }), 1000) });

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const ri = argv.indexOf("--runs"), runs = ri < 0 ? 100 : Number(argv.splice(ri, 2)[1]);
  const want = new Set(argv.length ? argv : Object.keys(APPS).filter((a) => APPS[a]!.test));
  for (const a of want) if (!APPS[a]?.test) throw new Error(`no tests for app "${a}"`);
  const repo = (await Bun.$`gh repo view --json nameWithOwner -q .nameWithOwner`.text()).trim();
  const list = check(Runs, await Bun.$`gh run list --workflow apps.yml --limit ${runs} --json databaseId`.json()) ?? [];
  const found = new Map<string, { id: number; group: boolean }[]>();
  for (const { databaseId } of list) {
    if (found.size === want.size) break;
    const jobs = check(Jobs, await Bun.$`gh api ${`repos/${repo}/actions/runs/${databaseId}/jobs?per_page=100`}`.quiet().nothrow().json().catch(() => null))?.jobs ?? [];
    const byApp = new Map<string, { ids: { id: number; group: boolean }[]; green: boolean; of: number }>();
    for (const j of jobs) {
      const m = j.name.match(/^test (\S+)(?: (\d+)\/(\d+))?$/);
      const apps = m?.[1]!.split("+") ?? [];
      for (const app of apps) {
        if (!want.has(app) || found.has(app)) continue;
        const g = byApp.get(app) ?? { ids: [], green: true, of: Number(m![3] ?? 1) };
        g.ids.push({ id: j.id, group: apps.length > 1 });
        g.green &&= j.conclusion === "success";
        byApp.set(app, g);
      }
    }
    for (const [app, g] of byApp) if (g.green && g.ids.length === g.of) found.set(app, g.ids);
  }
  for (const [app, ids] of found) {
    const times: Record<string, number> = {};
    for (const { id, group } of ids) {
      const log = await Bun.$`gh api --allow-escape-sequences ${`repos/${repo}/actions/jobs/${id}/logs`}`.quiet().text();
      Object.assign(times, timesFromLog(group ? section(log, appDir(app)) : log));
    }
    const live = new Set(testFiles(APPS[app]!.test!, appDir(app)));
    const kept = Object.fromEntries(Object.entries(times).filter(([f]) => live.has(f)).sort(([a], [b]) => a.localeCompare(b)));
    if (!Object.keys(kept).length) continue;
    await Bun.write(`${appDir(app)}/test-times.json`, JSON.stringify(kept, null, 2) + "\n");
    console.log(`${app}: ${Object.keys(kept).length} files, ${Math.round(Object.values(kept).reduce((a, b) => a + b, 0) / 1000)} s, from ${ids.length} job(s)`);
  }
  const missing = [...want].filter((a) => !found.has(a));
  if (missing.length) console.log(`no green run in the last ${runs} for: ${missing.join(", ")} (try --runs 300)`);
}
