// Pushes: a status page for the repos you care about. Each row is a light (green: CI on the default
// branch passed; yellow: a run is going; red: it failed, the repo is archived, or its homepage is
// down; grey: nothing to go on), the repo, when it was last pushed to, its commits on the default
// branch today and this week, and a bar for each of the last seven days. You pick the repos on the
// page (from your own and your orgs' repos, or any owner/name); the list lives in
// ~/.rustybuns/pushes.json, so every checkout shares it. Everything else is read from gh on each scan.
//
//   bun run pushes                  open http://localhost:4797 (a free port if that one is taken)
//   bun run pushes --json           print the scan
//   bun run pushes --html out.html  write the page with this scan baked in (a snapshot to share)
//   --file pushes.json, --port N, --no-open
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { help } from "./help.ts";
import { arr, bool, nul, obj, opt, str, type Of } from "../packages/util/src/guard.ts";
import { portArg } from "../packages/util/src/ports.ts";

/** Runs `gh` with these arguments: its stdout, or null when it failed. Swapped out in the test. */
export type Gh = (args: string[]) => Promise<string | null>;
/** Whether a homepage answers. */
export type Ping = (url: string) => Promise<boolean>;

const Name = str(140, { re: /^[\w.-]+\/[\w.-]+$/ });
const Picks = obj({ repos: arr(Name, 200, { drop: true }) });
export const Change = obj({ add: opt(Name), remove: opt(Name) });

const GhRepo = obj({
  full_name: str(140), default_branch: str(200), pushed_at: nul(str(40)), html_url: str(500),
  homepage: opt(nul(str(500))), archived: bool(false), disabled: bool(false),
});
const Commit = obj({ sha: str(64), commit: obj({ message: str(5000, { min: 0 }), committer: obj({ date: str(40) }) }) });
// Every page of the week's commits (gh --paginate --slurp: a list of pages), up to 50 pages.
const GhCommitPages = arr(arr(Commit, 100, { drop: true }), 50, { drop: true });
const Run = obj({ status: str(40), conclusion: nul(str(40)), html_url: str(500), name: opt(nul(str(300))) });
const GhRuns = obj({ workflow_runs: arr(Run, 100, { drop: true }) });
const GhList = arr(obj({ nameWithOwner: Name, pushedAt: opt(nul(str(40))) }), 1000, { drop: true });
const GhOrgs = arr(obj({ login: str(100) }), 100, { drop: true });

export type Light = "green" | "yellow" | "red" | "grey";
export type Row = {
  repo: string; url: string; branch: string; light: Light; why: string;
  pushed: string | null; today: number; week: number; days: number[];
  last: { sha: string; at: string; subject: string } | null;
  run: string | null; homepage: string | null; error: string | null;
};
export type Scan = { at: string; rows: Row[] };

const parse = <T>(text: string | null, g: (v: unknown) => T): T | null => {
  if (!text) return null;
  try { return g(JSON.parse(text)); } catch { return null; }
};

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

async function scanRepo(repo: string, gh: Gh, ping: Ping, now: Date): Promise<Row> {
  const blank: Row = { repo, url: `https://github.com/${repo}`, branch: "", light: "grey", why: "", pushed: null, today: 0, week: 0, days: [0, 0, 0, 0, 0, 0, 0], last: null, run: null, homepage: null, error: null };
  const info = parse(await gh(["api", `repos/${repo}`]), GhRepo);
  if (!info) return { ...blank, light: "red", why: "gh can't read this repo (gone, private to someone else, or gh is signed out)", error: "not found" };

  const today = startOfDay(now);
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  const week0 = addDays(today, -6);
  const since = monday < week0 ? monday : week0;
  const branch = encodeURIComponent(info.default_branch);
  const homepage = info.homepage?.startsWith("http") ? info.homepage : null;
  const [pagesText, headText, live] = await Promise.all([
    gh(["api", "--paginate", "--slurp", `repos/${repo}/commits?sha=${branch}&since=${since.toISOString()}&per_page=100`]),
    gh(["api", `repos/${repo}/commits/${branch}`]),
    homepage ? ping(homepage) : Promise.resolve(null),
  ]);
  const commits = (parse(pagesText, GhCommitPages) ?? []).flat();
  const head = parse(headText, Commit);
  // Every workflow that ran on the head commit, not just the newest one.
  const runs = head ? parse(await gh(["api", `repos/${repo}/actions/runs?head_sha=${head.sha}&per_page=100`]), GhRuns)?.workflow_runs ?? [] : [];

  const days = [0, 0, 0, 0, 0, 0, 0];
  let todayN = 0, weekN = 0;
  for (const c of commits) {
    const at = new Date(c.commit.committer.date);
    if (at >= today) todayN++;
    if (at >= monday) weekN++;
    const i = 6 - Math.floor((today.getTime() - startOfDay(at).getTime()) / 864e5);
    if (i >= 0 && i < 7) days[i]++;
  }
  const last = head ? { sha: head.sha.slice(0, 7), at: head.commit.committer.date, subject: head.commit.message.split("\n")[0] ?? "" } : null;
  const [light, why, run] = lightOf({ archived: info.archived || info.disabled, runs, live });
  return { ...blank, url: info.html_url, branch: info.default_branch, light, why, pushed: info.pushed_at, today: todayN, week: weekN, days, last, run, homepage };
}

const FAILED = ["failure", "timed_out", "startup_failure", "action_required"];
/**
 * The light, its reason and the run to open: taken down or a failing workflow is red, one still going
 * is yellow, all passing (or a homepage that answers) is green.
 */
export function lightOf(o: { archived: boolean; runs: Of<typeof Run>[]; live: boolean | null }): [Light, string, string | null] {
  const names = (rs: Of<typeof Run>[]) => [...new Set(rs.map((r) => r.name || "CI"))].join(", ");
  const up = o.live ? ", homepage up" : "";
  if (o.archived) return ["red", "archived: taken down", null];
  if (o.live === false) return ["red", "homepage doesn't answer", null];
  const failed = o.runs.filter((r) => r.status === "completed" && FAILED.includes(r.conclusion ?? ""));
  if (failed.length) return ["red", `${names(failed)} failed`, failed[0]?.html_url ?? null];
  const going = o.runs.filter((r) => r.status !== "completed");
  if (going.length) return ["yellow", `${names(going)} running`, going[0]?.html_url ?? null];
  const passed = o.runs.filter((r) => r.conclusion === "success");
  if (passed.length) return ["green", `${names(passed)} passed${up}`, passed[0]?.html_url ?? null];
  if (o.live) return ["green", "homepage up", null];
  return ["grey", "no CI runs on the last commit", null];
}

export async function scan(repos: string[], gh: Gh, ping: Ping, now = new Date()): Promise<Scan> {
  return { at: now.toISOString(), rows: await Promise.all(repos.map((r) => scanRepo(r, gh, ping, now))) };
}

/** Your repos and your orgs', newest push first: what the page offers to pick from. */
export async function catalog(gh: Gh): Promise<string[]> {
  const orgs = parse(await gh(["api", "user/orgs"]), GhOrgs) ?? [];
  const lists = await Promise.all([[], ...orgs.map((o) => [o.login])].map((owner) =>
    gh(["repo", "list", ...owner, "--limit", "200", "--no-archived", "--json", "nameWithOwner,pushedAt"])));
  const all = lists.flatMap((t) => parse(t, GhList) ?? []);
  all.sort((a, b) => (b.pushedAt ?? "").localeCompare(a.pushedAt ?? ""));
  return [...new Set(all.map((r) => r.nameWithOwner))];
}

// ---- picks ---------------------------------------------------------------------------------------

export function loadPicks(file: string): string[] {
  try { return Picks(JSON.parse(readFileSync(file, "utf8"))).repos; } catch { return ["QuinnsCode/RustyBuns"]; }
}
function savePicks(file: string, repos: string[]) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ repos }, null, 2) + "\n");
}

// ---- the page ------------------------------------------------------------------------------------

const PAGE = join(import.meta.dir, "pushes.html");
export const snapshot = (s: Scan, repos: string[]) =>
  readFileSync(PAGE, "utf8").replace("<!--DATA-->", `<script>window.PUSHES=${JSON.stringify({ scan: s, repos, scanning: false }).replace(/</g, "\\u003c")}</script>`);

const realGh: Gh = async (args) => {
  const p = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "ignore" });
  const out = await new Response(p.stdout).text();
  return (await p.exited) === 0 ? out : null;
};
const realPing: Ping = async (url) => {
  try { return (await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(8000) })).status < 400; } catch { return false; }
};

/** The page and its API. A scan runs in the background; GET /api/data says `scanning` until it lands. */
export function serve(o: { port: number; file: string; gh?: Gh; ping?: Ping }) {
  const gh = o.gh ?? realGh, ping = o.ping ?? realPing;
  let repos = loadPicks(o.file);
  let last: Scan | null = null;
  let running: Promise<void> | null = null;
  let again = false;
  const rescan = () => {
    if (running) { again = true; return; }
    running = scan(repos, gh, ping).then((s) => { last = s; }).finally(() => {
      running = null;
      if (again) { again = false; rescan(); }
    });
  };
  rescan();
  let picks: Promise<string[]> | null = null;
  const data = () => ({ scan: last, repos, scanning: running !== null });
  return Bun.serve({
    port: o.port,
    async fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === "/") return new Response(Bun.file(PAGE));
      if (pathname === "/api/data" && req.method === "GET") return Response.json(data());
      if (pathname === "/api/refresh" && req.method === "POST") { rescan(); return Response.json(data()); }
      if (pathname === "/api/catalog" && req.method === "GET") {
        picks ??= catalog(gh).catch(() => { picks = null; return []; });
        return Response.json({ repos: await picks });
      }
      if (pathname === "/api/repos" && req.method === "POST") {
        let c: Of<typeof Change>;
        try { c = Change(await req.json().catch(() => null)); } catch (e) { return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
        const lower = (s: string) => s.toLowerCase();
        if (c.remove) { const r = lower(c.remove); repos = repos.filter((x) => lower(x) !== r); }
        if (c.add && !repos.some((x) => lower(x) === lower(c.add ?? ""))) repos = [...repos, c.add];
        savePicks(o.file, repos);
        rescan();
        return Response.json(data());
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });
}

if (import.meta.main) {
  help(import.meta.path);
  const args = process.argv.slice(2);
  const value = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
  const file = value("--file") ?? join(homedir(), ".rustybuns", "pushes.json");
  if (args.includes("--json")) {
    console.log(JSON.stringify(await scan(loadPicks(file), realGh, realPing), null, 2));
  } else if (value("--html")) {
    const out = value("--html") ?? "pushes.html";
    const repos = loadPicks(file);
    writeFileSync(out, snapshot(await scan(repos, realGh, realPing), repos));
    console.log(`Wrote ${out}`);
  } else {
    const asked = value("--port");
    const port = portArg(asked, "pushes");
    const start = (p: number) => serve({ port: p, file });
    let server;
    try { server = start(port); } catch (e) {
      if (asked || !(e instanceof Error) || !("code" in e) || e.code !== "EADDRINUSE") throw e;
      console.log(`Port ${port} is taken; using a free one.`);
      server = start(0);
    }
    console.log(`Pushes: http://localhost:${server.port}  (your repos in ${file})`);
    if (!args.includes("--no-open")) Bun.spawn(["open", `http://localhost:${server.port}`]);
  }
}
