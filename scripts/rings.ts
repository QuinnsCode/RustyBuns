// Release rings (notes/RELEASE_RINGS.md, #4486): each ring is a `ring/<name>` commit status on the SHAs it tested
// and a ref `refs/ring/<name>` that moves forward to the newest green one. desktop-hourly.yml and daily-ring.yml call it.
//
//   bun scripts/rings.ts gate <ring> <sha>                   prints run=true|false: false when <sha> already has a
//                                                            ring/<ring> status (main hasn't moved since the last run)
//   bun scripts/rings.ts status <ring> <sha> <state> <url>   writes the ring/<ring> status (success or failure) on <sha>
//   bun scripts/rings.ts move <ring> <sha>                   points refs/ring/<ring> at <sha>; without the permission
//                                                            (MANUAL RUN #4495) it says so and exits 0
//   bun scripts/rings.ts range <ring> <sha>                  a markdown line: the commits since the last green, for
//                                                            the failure issue
//   bun scripts/rings.ts rollback <ring> <app> <target> [--from <sha>]
//                                                            downloads the saved build of the green before the ring's
//                                                            current one (or before --from) into apps/<app>/dist/ring-<sha7>/
//   bun scripts/rings.ts pick daily <sha>                    prints sha=<pick> and run=true|false: the newest commit at
//                                                            or under <sha> with 3 green hourlies in a row (its own and
//                                                            the next two); run=false when none has soaked yet or the
//                                                            pick already has a ring/daily status
//   bun scripts/rings.ts previews <base> <sha>               prints previews=<json list>: the web apps phone smoke opens
//                                                            whose vite build changed between the two (every one when <base> is empty or
//                                                            packages/ or the lockfile moved)
//
// Saved builds (#4497): each desktop-hourly smoke row uploads the binary it built and ran as the Actions artifact
// ring-<sha>-<app>-<target>, kept 7 days (the daily soak and then some). Only a SHA whose ring status is green counts,
// so rolling back is a download, never a rebuild.
//
// Needs GH_TOKEN and GITHUB_REPOSITORY (owner/name), as in a workflow; rollback falls back to gh's own login and repo.
import { arr, bool, nul, num, obj, opt, str } from "../packages/util/src/guard.ts";
import { help } from "./help.ts";
import { WEB_APPS } from "./phone-smoke-lib.ts";

/** A commit on main, newest first, with its ring status (undefined when the ring never ran it). */
export type Tested = { sha: string; state?: string };

/** The commits since the last green one, newest first, and that green SHA; `green` is undefined when none was in view. */
export function sinceLastGreen(history: Tested[]): { green?: string; shas: string[] } {
  const at = history.findIndex((c) => c.state === "SUCCESS" || c.state === "success");
  return at < 0 ? { shas: history.map((c) => c.sha) } : { green: history[at]!.sha, shas: history.slice(0, at).map((c) => c.sha) };
}

/** The saved build's artifact name for one app on one target at <sha>; desktop-hourly.yml writes the same. */
export const savedName = (sha: string, app: string, target: string) => `ring-${sha}-${app}-${target}`;

/**
 * Where a rollback can go, best first: the green SHAs older than `from` (the ring's current commit). Without `from`
 * (the ref hasn't moved yet, MANUAL RUN #4495) the newest green is taken as current.
 */
export function rollbackCandidates(history: Tested[], from?: string): string[] {
  const greens = history.filter((c) => c.state === "SUCCESS" || c.state === "success").map((c) => c.sha);
  if (!from) return greens.slice(1);
  const at = history.findIndex((c) => c.sha === from);
  return at < 0 ? [] : history.slice(at + 1).filter((c) => greens.includes(c.sha)).map((c) => c.sha);
}

/** The markdown line for the failure issue. */
export function rangeLine(repo: string, history: Tested[]): string {
  const { green, shas } = sinceLastGreen(history);
  const head = shas[0] ?? history[0]?.sha ?? "";
  if (!green) return `No green ring run in the last ${history.length} commits; newest is ${head.slice(0, 7)}.`;
  if (!shas.length) return `${head.slice(0, 7)} was green last time.`;
  return `Since the last green (${green.slice(0, 7)}): ${shas.length} commit${shas.length === 1 ? "" : "s"}, `
    + `https://github.com/${repo}/compare/${green}...${head}`;
}

/** What each ring soaks on before it picks a commit: the ring under it and how many green runs in a row. */
export const SOAK: Record<string, { on: string; runs: number }> = { daily: { on: "hourly", runs: 3 } };

/** The newest commit with `runs` green runs in a row: its own and the next newer tested ones. Untested commits are skipped
 *  (the hourly only runs when main moved, so a squash commit can share a run with the ones above it); a red or pending
 *  run breaks the streak. Undefined when nothing in view has soaked that long. */
export function soaked(history: Tested[], runs: number): string | undefined {
  let streak = 0;
  for (const c of history) {
    if (!c.state) continue;
    streak = /^success$/i.test(c.state) ? streak + 1 : 0;
    if (streak === runs) return c.sha;
  }
  return undefined;
}

/** The apps to preview-build: the web apps phone smoke opens (`apps`) whose folder changed and whose `build` is a vite
 *  build. Every one of them when there is no base yet or shared code moved. */
export function previewApps(changed: string[] | "all", builds: Record<string, string>, apps: readonly string[] = WEB_APPS): string[] {
  const vite = apps.filter((a) => /\bvite build\b/.test(builds[a] ?? "")).sort();
  if (changed === "all" || changed.some((f) => f.startsWith("packages/") || f === "bun.lock" || f === "package.json")) return vite;
  const touched = new Set(changed.map((f) => /^apps\/([^/]+)\//.exec(f)?.[1]).filter(Boolean));
  return vite.filter((a) => touched.has(a));
}

const Reply = obj({
  data: obj({
    repository: obj({
      object: nul(obj({
        history: opt(obj({
          pageInfo: obj({ hasNextPage: bool(), endCursor: nul(str(200)) }),
          nodes: arr(obj({
            oid: str(64),
            status: nul(obj({ contexts: arr(obj({ context: str(200), state: str(20) }), 200) })),
          }), 100),
        })),
      })),
    }),
  }),
});

/** The last `n` commits on <sha>'s first-parent line, newest first, with their ring/<ring> state, 100 per GraphQL call. */
export async function history(repo: string, ring: string, sha: string, n = 100): Promise<Tested[]> {
  const [owner, name] = repo.split("/");
  const q = `query($o:String!,$n:String!,$s:GitObjectID!,$k:Int!,$c:String){repository(owner:$o,name:$n){object(oid:$s){... on Commit{history(first:$k,after:$c){pageInfo{hasNextPage endCursor} nodes{oid status{contexts{context state}}}}}}}}`;
  const out: Tested[] = [];
  let cursor: string | null = null;
  while (out.length < n) {
    const k = Math.min(100, n - out.length);
    const after: string[] = cursor ? ["-f", `c=${cursor}`] : [];
    const text: string = await Bun.$`gh api graphql -f query=${q} -f o=${owner!} -f n=${name!} -f s=${sha} -F k=${k} ${after}`.quiet().text();
    const page = Reply(JSON.parse(text)).data.repository.object?.history;
    for (const c of page?.nodes ?? []) out.push({ sha: c.oid, state: c.status?.contexts.find((x) => x.context === `ring/${ring}`)?.state });
    if (!page?.pageInfo.hasNextPage || !page.pageInfo.endCursor) break;
    cursor = page.pageInfo.endCursor;
  }
  return out;
}

const Artifacts = obj({
  artifacts: arr(obj({ name: str(300), expired: bool(), workflow_run: nul(obj({ id: num(1, Number.MAX_SAFE_INTEGER) })) }), 100),
});

/** The ring's ref, or undefined while it doesn't exist (the workflow can't write it until MANUAL RUN #4495). */
async function ringRef(repo: string, ring: string): Promise<string | undefined> {
  const r = await Bun.$`gh api repos/${repo}/git/ref/ring/${ring} -q .object.sha`.quiet().nothrow();
  const sha = r.stdout.toString().trim();
  return r.exitCode === 0 && /^[0-9a-f]{40}$/.test(sha) ? sha : undefined;
}

/** The run that saved <name>, if it was saved and hasn't expired. */
async function savedRun(repo: string, name: string): Promise<number | undefined> {
  const out = await Bun.$`gh api ${`repos/${repo}/actions/artifacts?name=${name}&per_page=5`}`.quiet().text();
  return Artifacts(JSON.parse(out)).artifacts.find((a) => a.name === name && !a.expired)?.workflow_run?.id;
}

async function rollback(repo: string, ring: string, app: string, target: string, from?: string) {
  from ??= await ringRef(repo, ring);
  const head = (await Bun.$`gh api repos/${repo}/commits/main -q .sha`.quiet().text()).trim();
  const candidates = rollbackCandidates(await history(repo, ring, head), from);
  if (from && !candidates.length) console.error(`${from.slice(0, 7)} isn't in main's last 100 commits, or no green is older`);
  for (const sha of candidates) {
    const name = savedName(sha, app, target);
    const run = await savedRun(repo, name);
    if (!run) { console.error(`${sha.slice(0, 7)} was green but has no saved ${app} ${target} build (expired, or before #4497)`); continue; }
    const dir = `apps/${app}/dist/ring-${sha.slice(0, 7)}`;
    await Bun.$`gh run download ${run} -R ${repo} -n ${name} -D ${dir}`.quiet();
    // An artifact zip drops the executable bit.
    for (const file of new Bun.Glob("*").scanSync(dir)) await Bun.$`chmod +x ${`${dir}/${file}`}`.quiet();
    console.log(`${app} ${target} rolled back to ${sha.slice(0, 7)} (the green before ${from ? from.slice(0, 7) : "the newest"}): ${dir}`);
    return;
  }
  console.error(`no saved ${app} ${target} build to roll back to on ring/${ring}`);
  process.exit(1);
}

if (import.meta.main) {
  help(import.meta.path);
  if (process.argv[2] === "rollback") {
    const [ring = "", app = "", target = ""] = process.argv.slice(3);
    const at = process.argv.indexOf("--from");
    const from = at > 0 ? process.argv[at + 1] : undefined;
    const repo = process.env.GITHUB_REPOSITORY ?? (await Bun.$`gh repo view --json nameWithOwner -q .nameWithOwner`.quiet().text()).trim();
    if (!/^[a-z]+$/.test(ring) || !/^[\w-]+$/.test(app) || !/^[\w-]+$/.test(target) || (from !== undefined && !/^[0-9a-f]{40}$/.test(from))) {
      console.error("usage: bun scripts/rings.ts rollback <ring> <app> <target> [--from <40-char sha>]; --help");
      process.exit(2);
    }
    await rollback(repo, ring, app, target, from);
    process.exit(0);
  }
  const [cmd, ring = "", sha = "", ...rest] = process.argv.slice(2);
  const repo = process.env.GITHUB_REPOSITORY ?? "";
  if (cmd === "previews") {
    // previews <base> <sha>: base may be empty (no refs/ring/daily yet). Local git only, no GitHub calls.
    const isSha = (x: string) => /^[0-9a-f]{40}$/.test(x);
    if ((ring && !isSha(ring)) || !isSha(sha)) { console.error("usage: bun scripts/rings.ts previews <base sha or \"\"> <sha>"); process.exit(2); }
    const changed = ring ? (await Bun.$`git diff --name-only ${ring} ${sha}`.text()).split("\n").filter(Boolean) : "all" as const;
    const builds: Record<string, string> = {};
    for (const dir of await Array.fromAsync(new Bun.Glob("apps/*/package.json").scan())) {
      const pkg: unknown = await Bun.file(dir).json();
      const scripts = typeof pkg === "object" && pkg !== null && "scripts" in pkg ? pkg.scripts : undefined;
      const build = typeof scripts === "object" && scripts !== null && "build" in scripts ? scripts.build : undefined;
      if (typeof build === "string") builds[dir.split("/")[1]!] = build;
    }
    console.log(`previews=${JSON.stringify(previewApps(changed, builds))}`);
    process.exit(0);
  }
  if (!cmd || !/^[a-z]+$/.test(ring) || !/^[0-9a-f]{40}$/.test(sha) || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    console.error("usage: bun scripts/rings.ts gate|status|move|range|pick <ring> <40-char sha> [...] (with GITHUB_REPOSITORY set); --help");
    process.exit(2);
  }
  if (cmd === "gate") {
    const [head] = await history(repo, ring, sha, 1);
    console.log(`run=${!head?.state}`);
    if (head?.state) console.error(`${sha.slice(0, 7)} already has ring/${ring} ${head.state.toLowerCase()}: main hasn't moved, skipping`);
  } else if (cmd === "status") {
    const [state = "", url = ""] = rest;
    if (state !== "success" && state !== "failure") throw new Error("state is success or failure");
    await Bun.$`gh api repos/${repo}/statuses/${sha} -f state=${state} -f context=${`ring/${ring}`} -f target_url=${url} -f description=${`${ring} ring ${state === "success" ? "green" : "red"}`}`.quiet();
    console.log(`ring/${ring} ${state} on ${sha.slice(0, 7)}`);
  } else if (cmd === "move") {
    const ref = `ring/${ring}`;
    // Update it if it exists, create it if it doesn't. A ring only moves forward, so no force.
    let r = await Bun.$`gh api -X PATCH repos/${repo}/git/refs/${ref} -f sha=${sha} -F force=false`.quiet().nothrow();
    if (r.exitCode && /Reference does not exist|Not Found/.test(r.stdout.toString() + r.stderr.toString()))
      r = await Bun.$`gh api repos/${repo}/git/refs -f ref=${`refs/${ref}`} -f sha=${sha}`.quiet().nothrow();
    if (r.exitCode) {
      const why = (r.stdout.toString() + r.stderr.toString()).trim().split("\n").slice(-1)[0];
      console.log(`::warning::refs/${ref} not moved to ${sha.slice(0, 7)} (${why}). The workflow can't write refs yet: MANUAL RUN #4495.`);
    } else console.log(`refs/${ref} -> ${sha.slice(0, 7)}`);
  } else if (cmd === "pick") {
    const soak = SOAK[ring];
    if (!soak) throw new Error(`ring ${ring} doesn't pick: it has no soak (${Object.keys(SOAK).join(", ")} do)`);
    const pick = soaked(await history(repo, soak.on, sha), soak.runs);
    const [done] = pick ? await history(repo, ring, pick, 1) : [];
    console.log(`sha=${pick ?? ""}`);
    console.log(`run=${!!pick && !done?.state}`);
    if (!pick) console.error(`no commit under ${sha.slice(0, 7)} has ${soak.runs} green ${soak.on} runs in a row yet`);
    else if (done?.state) console.error(`${pick.slice(0, 7)} already has ring/${ring} ${done.state.toLowerCase()}: nothing new has soaked`);
    else console.error(`picked ${pick.slice(0, 7)}: ${soak.runs} green ${soak.on} runs in a row`);
  } else if (cmd === "range") {
    console.log(rangeLine(repo, await history(repo, ring, sha)));
  } else {
    console.error(`unknown command ${cmd}; --help`);
    process.exit(2);
  }
}
