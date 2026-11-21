// The bridge: one screen for every app in the repo. Its issues (open and closed), its last commit
// against its last good release, what it runs on (Mac, Windows, Linux, Android, iOS, a server,
// Cloudflare), what it holds (D1, R2, Durable Objects...), its hourly CI and whether its live page
// answers, its last deploy (from ~/.rustybuns/deploys.jsonl, which `rustybuns deploy` writes) against its last
// merged PR and its newest PR of any kind, and a tier from S to F that you drag it into. Everything but the tiers is read from the
// repo and gh on each scan; the tiers live in ~/.rustybuns/tiers.json, so every checkout shares them.
//
//   bun run bridge                  open http://localhost:4796 (a free port if that one is taken)
//   bun run bridge --html out.html  write the page with this scan baked in (a snapshot to share)
//   bun run bridge --json           print the scan
//   --offline (no gh, no pings), --tiers file.json, --port N, --no-open
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { readGroups, plays } from "./readme-apps.ts";
import { help } from "./help.ts";
import { arr, bool, int, obj, opt, str, type Of } from "../packages/util/src/guard.ts";
import { portArg } from "../packages/util/src/ports.ts";
import { Move, Tiers, emptyTiers, healthOf, issueMatcher, lastDeploys, move, prOf, readConfig, type ConfigFacts, type Deploy, type Light } from "./bridge-lib.ts";
import { DEPLOY_LOG } from "../packages/cli/src/report-deploy.ts";
import { MANUAL_REPO } from "./manual-runs-lib.ts";

const root = join(import.meta.dir, "..");

export type Release = { tag: string; at: string; ok: boolean | null; url: string | null };
export type Row = ConfigFacts & {
  id: string; name: string; group: string; line: string; play: string | null;
  issues: { open: number; closed: number; manual: number; latest: { number: number; title: string } | null };
  /** Open PRs touching it, and its newest PR of any state among the last 300. */
  prs: number;
  pr: { number: number; title: string; state: string; at: string } | null;
  /** The last commit to it on main; `pr` is the PR it was squash-merged from. */
  commit: { sha: string; at: string; subject: string; pr: number | null } | null;
  /** Its newest deploy from this Mac. */
  deploy: Deploy | null;
  commits30: number;
  /** The newest release tag, and the newest one whose run went green (often the same). */
  release: Release | null; good: Release | null;
  /** Commits to the app since its last good release. */
  since: number | null;
  ci: { test: string | null; smoke: string | null; at: string | null };
  live: { ok: boolean; status: number; ms: number } | null;
  files: number; tests: number;
  light: Light;
};
export type Scan = { at: string; offline: boolean; apps: Row[]; groups: string[]; unfiled: number; issues: { open: number; closed: number }; hourly: string | null };

// ---- small runners ------------------------------------------------------------------------------

async function sh(cmd: string[]): Promise<string | null> {
  const p = Bun.spawn(cmd, { cwd: root, stdout: "pipe", stderr: "ignore" });
  const out = await new Response(p.stdout).text();
  return (await p.exited) === 0 ? out : null;
}
const parse = <T>(text: string | null, g: (v: unknown) => T, fallback: T): T => {
  if (!text) return fallback;
  try { return g(JSON.parse(text)); } catch { return fallback; }
};

const GhIssues = arr(obj({ number: int(0, 1e12), title: str(500), state: str(20), labels: arr(obj({ name: str(100) }), 50) }), 20000);
const GhPrs = arr(obj({ number: int(0, 1e12), title: str(500), state: str(20), createdAt: str(40), files: arr(obj({ path: str(500) }), 5000, { drop: true }) }), 500);
const GhRuns = arr(obj({ headBranch: str(200), conclusion: str(40, { min: 0, dflt: "" }), status: str(40), url: str(500), createdAt: str(40) }), 1000);
const GhJobs = obj({ jobs: arr(obj({ name: str(300), conclusion: str(40, { min: 0, dflt: "" }) }), 2000) });
const GhReleases = arr(obj({ tagName: str(200), isDraft: bool() }), 500);
const GhRun = arr(obj({ databaseId: int(0, 1e12), createdAt: str(40) }), 5);
const Plays = arr(obj({ app: opt(str(80)), play: opt(str(300)) }), 300);

// ---- the scan -------------------------------------------------------------------------------------

/** Every app folder, plus `rustybuns` for the framework itself (packages/). */
function appIds(): string[] {
  const dirs = readdirSync(join(root, "apps"), { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(root, "apps", d.name, "package.json"))).map((d) => d.name);
  return [...dirs.sort(), "rustybuns"];
}
const dirOf = (id: string) => (id === "rustybuns" ? "packages" : `apps/${id}`);
// ci-apps.ts runs its CLI when imported, so its table is read as text: an app CI knows and doesn't mark `drop: false` ships desktop binaries.
function drops(): Set<string> {
  const text = readFileSync(join(root, "scripts/ci-apps.ts"), "utf8");
  return new Set([...text.matchAll(/^\s*"([\w-]+)":\s*\{(.*)\},/gm)].filter((m) => !(m[2] ?? "").includes("drop: false")).map((m) => m[1] ?? ""));
}
const read = (p: string) => { try { return readFileSync(join(root, p), "utf8"); } catch { return null; } };

const worst = (cs: string[]): string | null => (cs.length === 0 ? null : cs.includes("failure") ? "failure" : cs.includes("cancelled") ? "cancelled" : cs.every((c) => c === "skipped") ? "skipped" : "success");

export async function ping(url: string): Promise<{ ok: boolean; status: number; ms: number }> {
  const t = performance.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: "follow" });
    await r.body?.cancel();
    return { ok: r.status < 400, status: r.status, ms: Math.round(performance.now() - t) };
  } catch {
    return { ok: false, status: 0, ms: Math.round(performance.now() - t) };
  }
}

export async function scan(offline = false): Promise<Scan> {
  const ids = appIds();
  const shipped = drops();
  const main = (await sh(["git", "rev-parse", "--verify", "-q", "origin/main"])) ? "origin/main" : "HEAD";
  const groups = readGroups();
  const entry = new Map(groups.flatMap((g) => g.apps.map((a) => [a.app, { ...a, group: g.title.replace(/:.*$/, "") }] as const)));
  const play = (() => { try { return plays(); } catch { return new Map<string, string | null>(); } })();
  const playAny = new Map(parse(read("apps/playground/public/apps.json"), Plays, []).flatMap((p) => (p.app && p.play ? [[p.app, p.play] as const] : [])));

  // gh, all at once while git runs.
  const gh = offline ? null : Promise.all([
    sh(["gh", "issue", "list", "--state", "all", "--limit", "10000", "--json", "number,title,state,labels"]),
    sh(["gh", "pr", "list", "--state", "all", "--limit", "300", "--json", "number,title,state,createdAt,files"]),
    sh(["gh", "run", "list", "--workflow", "desktop-hourly.yml", "--status", "completed", "--limit", "1", "--json", "databaseId,createdAt"]),
    // A release tag's run: desktop-drop for an app, npm-publish for the framework.
    sh(["gh", "run", "list", "--workflow", "desktop-drop.yml", "--event", "push", "--limit", "100", "--json", "headBranch,conclusion,status,url,createdAt"]),
    sh(["gh", "run", "list", "--workflow", "npm-publish.yml", "--event", "push", "--limit", "50", "--json", "headBranch,conclusion,status,url,createdAt"]),
    sh(["gh", "release", "list", "--limit", "200", "--json", "tagName,isDraft"]),
    // MANUAL RUNs live in their own private repo, off the public board.
    sh(["gh", "issue", "list", "--repo", MANUAL_REPO, "--state", "open", "--limit", "1000", "--json", "number,title,state,labels"]),
  ]);

  const tracked = (await sh(["git", "ls-files", "apps", "packages"])) ?? "";
  const files = new Map<string, { files: number; tests: number }>();
  for (const f of tracked.split("\n")) {
    const id = f.startsWith("packages/") ? "rustybuns" : f.split("/")[1];
    if (!id) continue;
    const c = files.get(id) ?? { files: 0, tests: 0 };
    c.files++;
    if (/\.test\.[cm]?[jt]sx?$/.test(f)) c.tests++;
    files.set(id, c);
  }

  // Release tags are <app>-v<version> (desktop-drop, or the app's own workflow, runs on the push), and v<version> for the framework on npm.
  const tags = ((await sh(["git", "tag", "--list", "--sort=-creatordate", "--format=%(refname:short)%09%(creatordate:iso-strict)"])) ?? "")
    .split("\n").filter((l) => /^(v\d|[\w-]+-v\d)/.test(l)).map((l) => { const [tag = "", at = ""] = l.split("\t"); return { tag, at, app: tag.startsWith("v") ? "rustybuns" : tag.replace(/-v\d.*$/, "") }; });

  const [issuesRaw, prsRaw, hourlyRaw, dropRaw, npmRaw, releasesRaw, manualRaw] = gh ? await gh : [null, null, null, null, null, null, null];
  const runs = [...parse(dropRaw, GhRuns, []), ...parse(npmRaw, GhRuns, [])];
  const published = new Set(parse(releasesRaw, GhReleases, []).filter((r) => !r.isDraft).map((r) => r.tagName));
  const runFor = (tag: string) => runs.find((r) => r.headBranch === tag);
  const hourly = parse(hourlyRaw, GhRun, [])[0] ?? null;
  const jobs = hourly ? parse(await sh(["gh", "run", "view", String(hourly.databaseId), "--json", "jobs"]), GhJobs, { jobs: [] }).jobs : [];

  const names = ids.map((id) => {
    const pkg = parse(read(`${dirOf(id)}/package.json`), obj({ name: opt(str(200)) }), {});
    return { id, names: [entry.get(id)?.name ?? "", (pkg.name ?? "").replace(/^@[^/]+\//, "")].filter(Boolean) };
  });
  const about = issueMatcher(names);
  const issues = parse(issuesRaw, GhIssues, []);
  const tally = new Map<string, Row["issues"]>();
  let unfiled = 0;
  for (const i of issues) {
    const id = about(i.title, i.labels.map((l) => l.name));
    if (!id) { unfiled++; continue; }
    const t = tally.get(id) ?? { open: 0, closed: 0, manual: 0, latest: null };
    if (i.state === "OPEN") {
      t.open++;
      if (i.labels.some((l) => l.name === "manual run")) t.manual++;
      if (!t.latest || i.number > t.latest.number) t.latest = { number: i.number, title: i.title };
    } else t.closed++;
    tally.set(id, t);
  }
  for (const i of parse(manualRaw, GhIssues, [])) {
    const id = about(i.title, i.labels.map((l) => l.name));
    if (!id) continue;
    const t = tally.get(id) ?? { open: 0, closed: 0, manual: 0, latest: null };
    t.manual++;
    tally.set(id, t);
  }
  const prs = new Map<string, number>(), newest = new Map<string, Row["pr"]>();
  for (const p of parse(prsRaw, GhPrs, [])) {
    const touched = new Set(p.files.map((f) => (f.path.startsWith("packages/") ? "rustybuns" : f.path.startsWith("apps/") ? f.path.split("/")[1] : null)).filter((x): x is string => !!x));
    for (const id of touched) {
      if (p.state === "OPEN") prs.set(id, (prs.get(id) ?? 0) + 1);
      if ((newest.get(id)?.number ?? -1) < p.number) newest.set(id, { number: p.number, title: p.title, state: p.state, at: p.createdAt });
    }
  }
  const deploys = lastDeploys((() => { try { return readFileSync(DEPLOY_LOG, "utf8"); } catch { return null; } })(), ids);

  const rows = await Promise.all(ids.map(async (id): Promise<Row> => {
    const dir = dirOf(id);
    const [logLine, count] = await Promise.all([
      sh(["git", "log", "-1", "--format=%h%x1f%cI%x1f%s", main, "--", dir]),
      sh(["git", "rev-list", "--count", "--since=30.days.ago", main, "--", dir]),
    ]);
    const [sha = "", at = "", subject = ""] = (logLine ?? "").trim().split("\x1f");
    // Good: its run went green, or it has a published GitHub Release. Bad: its run failed or was cancelled with no release. Unknown otherwise.
    const mine = tags.filter((t) => t.app === id).map((t): Release => {
      const r = runFor(t.tag);
      const ran = r && r.status === "completed" ? r.conclusion === "success" : null;
      return { tag: t.tag, at: t.at, ok: ran === true || published.has(t.tag) ? true : ran, url: r?.url ?? null };
    });
    const release = mine[0] ?? null;
    const good = mine.find((r) => r.ok === true) ?? null;
    const since = good ? Number((await sh(["git", "rev-list", "--count", `${good.tag}..${main}`, "--", dir]))?.trim() ?? NaN) : null;
    const config = read(`${dir}/rustybuns.config.ts`);
    const pkgText = read(`${dir}/package.json`) ?? "";
    const vite = read(`${dir}/vite.config.ts`) ?? "";
    const facts = readConfig(config, {
      wrangler: id === "rustybuns" || existsSync(join(root, dir, "wrangler.jsonc")) || existsSync(join(root, dir, "wrangler.toml")) || existsSync(join(root, dir, "wrangler.json")),
      ios: existsSync(join(root, dir, "ios")) || id === "rustybuns",
      installable: vite.includes("installable") || existsSync(join(root, dir, "public", "manifest.webmanifest")),
      drops: shipped.has(id) || id === "rustybuns",
      bunServer: !config && /"(start|serve)"\s*:\s*"[^"]*\bbun\b/.test(pkgText),
    });
    const testJobs = jobs.filter((j) => j.name === `test ${id}` || j.name.startsWith(`test ${id} `)).map((j) => j.conclusion);
    const smokeJobs = jobs.filter((j) => j.name.startsWith(`smoke ${id} `)).map((j) => j.conclusion);
    const url = play.get(id) ?? playAny.get(id) ?? (facts.domain ? `https://${facts.domain}` : null);
    const live = offline || !url ? null : await ping(url);
    const ci = { test: worst(testJobs), smoke: worst(smokeJobs), at: hourly?.createdAt ?? null };
    return {
      id, name: entry.get(id)?.name ?? (id === "rustybuns" ? "RustyBuns framework" : id), group: id === "rustybuns" ? "Framework" : entry.get(id)?.group ?? "Unlisted",
      line: entry.get(id)?.line.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") ?? "", play: url,
      ...facts,
      issues: tally.get(id) ?? { open: 0, closed: 0, manual: 0, latest: null },
      prs: prs.get(id) ?? 0,
      pr: newest.get(id) ?? null,
      commit: sha ? { sha, at, subject, pr: prOf(subject) } : null,
      deploy: deploys.get(id) ?? null,
      commits30: Number(count?.trim() ?? 0),
      release, good, since: Number.isFinite(since) ? since : null,
      ci, live,
      ...(files.get(id) ?? { files: 0, tests: 0 }),
      light: healthOf({ test: ci.test, live, releaseOk: release ? release.ok : null }),
    };
  }));
  const open = issues.filter((i) => i.state === "OPEN").length;
  const groupNames = [...groups.map((g) => g.title.replace(/:.*$/, "")), "Framework", "Unlisted"];
  return { at: new Date().toISOString(), offline, apps: rows, groups: groupNames, unfiled, issues: { open, closed: issues.length - open }, hourly: hourly?.createdAt ?? null };
}

// ---- tiers ---------------------------------------------------------------------------------------

export function loadTiers(file: string): Of<typeof Tiers> {
  try { return Tiers(JSON.parse(readFileSync(file, "utf8"))); } catch { return emptyTiers(); }
}
function saveTiers(file: string, t: Of<typeof Tiers>) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(t, null, 2) + "\n");
}

// ---- the page ------------------------------------------------------------------------------------

const PAGE = join(import.meta.dir, "bridge.html");
/** The page with a scan and tiers baked in, for a snapshot that needs no server. */
export const snapshot = (s: Scan, tiers: Of<typeof Tiers>) =>
  readFileSync(PAGE, "utf8").replace("<!--DATA-->", `<script>window.BRIDGE=${JSON.stringify({ scan: s, tiers }).replace(/</g, "\\u003c")}</script>`);

/**
 * The page and its API. The last scan (kept next to the tiers) shows at once while a new one runs;
 * GET /api/data says `scanning` until it lands, and POST /api/refresh starts another.
 */
export function serve(o: { port: number; tiersFile: string; offline: boolean }) {
  const cacheFile = join(dirname(o.tiersFile), "bridge-scan.json");
  // The server only hands the cached scan to the page, so it stays `unknown` here.
  let last: unknown = (() => { try { return JSON.parse(readFileSync(cacheFile, "utf8")); } catch { return null; } })();
  let running: Promise<Scan> | null = null;
  const rescan = () => {
    running ??= scan(o.offline).then((s) => {
      last = s;
      try { mkdirSync(dirname(cacheFile), { recursive: true }); writeFileSync(cacheFile, JSON.stringify(s)); } catch {}
      return s;
    }).finally(() => { running = null; });
    return running;
  };
  void rescan();
  let tiers = loadTiers(o.tiersFile);
  // Never waits on a scan (Bun ends a request after 10 s): the page polls while `scanning`.
  const data = () => ({ scan: last, tiers, scanning: running !== null });
  return Bun.serve({
    port: o.port,
    async fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === "/") return new Response(Bun.file(PAGE));
      if (pathname === "/api/data" && req.method === "GET") return Response.json(data());
      if (pathname === "/api/refresh" && req.method === "POST") { void rescan(); return Response.json(data()); }
      if (pathname === "/api/tiers" && req.method === "POST") {
        const body: unknown = await req.json().catch(() => null);
        try { tiers = move(tiers, Move(body)); } catch (e) { return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
        saveTiers(o.tiersFile, tiers);
        return Response.json({ tiers });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });
}

if (import.meta.main) {
  help(import.meta.path);
  const args = process.argv.slice(2);
  const value = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
  const offline = args.includes("--offline");
  const tiersFile = value("--tiers") ?? join(homedir(), ".rustybuns", "tiers.json");
  if (args.includes("--json")) {
    console.log(JSON.stringify(await scan(offline), null, 2));
  } else if (value("--html")) {
    const out = value("--html") ?? "bridge.html";
    writeFileSync(out, snapshot(await scan(offline), loadTiers(tiersFile)));
    console.log(`Wrote ${out}`);
  } else {
    const asked = value("--port");
    const port = portArg(asked, "bridge");
    const start = (p: number) => serve({ port: p, tiersFile, offline });
    let server;
    try { server = start(port); } catch (e) {
      if (asked || !(e instanceof Error) || !("code" in e) || e.code !== "EADDRINUSE") throw e;
      console.log(`Port ${port} is taken; using a free one.`);
      server = start(0);
    }
    console.log(`Bridge: http://localhost:${server.port}  (tiers in ${tiersFile}; a scan takes about a minute)`);
    if (!args.includes("--no-open")) Bun.spawn(["open", `http://localhost:${server.port}`]);
  }
}
