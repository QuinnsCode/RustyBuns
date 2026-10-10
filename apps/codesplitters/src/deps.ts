// The dependency doctor. On a schedule each repo's owner tunes, it reads the
// repo's package.json, asks npm what's newer, and puts the updates worth
// taking on a branch as `agent-deps`, ready to review and merge like any
// other branch. To keep updates from piling up it only proposes a version the
// current range doesn't already allow (the lockfile covers the rest), never
// one younger than the minimum age (a bad or hijacked release usually gets
// pulled within days), never past the level the owner allows, and never
// anything on the ignore list.
//
// With tests on (desktop only, and the owner's choice, since it runs the
// repo's own code), each update is tried in a throwaway clone first: install,
// then the test script, then the clone is deleted. If the updates together
// break the tests, each is tried alone and only the ones that pass go on the
// branch.
//
//   GET  /api/repos/:o/:r/deps        settings and the last report (owner only)
//   PUT  /api/repos/:o/:r/deps        {on, every_hours, max_level, min_age_days, ignore, run_tests}
//   POST /api/repos/:o/:r/deps/run    check now

import type { Doc, Op } from "./lines.ts";
import { access as artifactAccess, handleFor } from "./archive.ts";
import { actingAs } from "./identity.ts";
import { json, type Env } from "./env.ts";

export type Level = "patch" | "minor" | "major";
const LEVELS: Level[] = ["patch", "minor", "major"];

export interface Settings { on: boolean; every_hours: number; max_level: Level; min_age_days: number; ignore: string[]; run_tests: boolean }
export const DEFAULTS: Settings = { on: false, every_hours: 24, max_level: "minor", min_age_days: 3, ignore: [], run_tests: false };

export interface Update { name: string; from: string; to: string; level: Level; status: "kept" | "broke" | "untested"; out?: string }
export interface Report { at: number; checked: number; updates: Update[]; branch?: string; note?: string }

/** What npm says about a package: its versions and when each was published. */
export type Registry = (name: string) => Promise<{ versions: string[]; time: Record<string, string> } | null>;

export const npmRegistry: Registry = async (name) => {
  const res = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2f")}`);
  if (!res.ok) return null;
  const doc = (await res.json()) as { versions?: Record<string, unknown>; time?: Record<string, string> };
  return { versions: Object.keys(doc.versions ?? {}), time: doc.time ?? {} };
};

/**
 * Install and test the repo with these files swapped in. `remote` clones it.
 * ok: install and tests passed (or there is no test script).
 */
export type Tester = (remote: string, files: Record<string, string>) => Promise<{ ok: boolean; out: string }>;

// ---- versions ---------------------------------------------------------------

type V = [number, number, number];
const parse = (s: string): V | null => { const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(s); return m ? [+m[1]!, +m[2]!, +m[3]!] : null; };
const cmp = (a: V, b: V) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** A range we know how to move: ^x.y.z, ~x.y.z or an exact x.y.z. Anything fancier is left alone. */
function range(spec: string): { prefix: "^" | "~" | ""; v: V } | null {
  const m = /^([\^~]?)(\d+\.\d+\.\d+)$/.exec(spec.trim());
  const v = m && parse(m[2]!);
  return v ? { prefix: m![1] as "^" | "~" | "", v } : null;
}

/** Does the range already allow v? Then the lockfile takes it, and there's nothing to propose. */
function allows(r: { prefix: string; v: V }, v: V): boolean {
  if (cmp(v, r.v) < 0) return false;
  if (r.prefix === "") return cmp(v, r.v) === 0;
  if (r.prefix === "~") return v[0] === r.v[0] && v[1] === r.v[1];
  // ^: the leftmost non-zero part is fixed.
  if (r.v[0] > 0) return v[0] === r.v[0];
  if (r.v[1] > 0) return v[0] === 0 && v[1] === r.v[1];
  return cmp(v, r.v) === 0;
}

const levelOf = (from: V, to: V): Level => to[0] !== from[0] ? "major" : to[1] !== from[1] ? "minor" : "patch";

/** The updates worth proposing for one package.json, newest allowed version each. */
export async function outdated(pkg: Record<string, any>, s: Settings, registry: Registry, now = Date.now()) {
  const deps: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies };
  const found: Omit<Update, "status">[] = [];
  const checks = Object.entries(deps).filter(([name]) => !s.ignore.includes(name)).map(async ([name, spec]) => {
    const r = range(spec);
    if (!r) return 0;   // workspace:, file:, git, tags, wider ranges
    const meta = await registry(name).catch(() => null);
    if (!meta) return 0;
    const ripe = now - s.min_age_days * 86_400_000;
    let best: V | null = null;
    for (const raw of meta.versions) {
      const v = parse(raw);
      if (!v || cmp(v, r.v) <= 0 || allows(r, v)) continue;
      if (LEVELS.indexOf(levelOf(r.v, v)) > LEVELS.indexOf(s.max_level)) continue;
      const published = Date.parse(meta.time[raw] ?? "");
      if (!(published <= ripe)) continue;
      if (!best || cmp(v, best) > 0) best = v;
    }
    if (best) found.push({ name, from: spec, to: r.prefix + best.join("."), level: levelOf(r.v, best) });
    return 1;
  });
  const checked = (await Promise.all(checks)).reduce((a: number, b) => a + b, 0);
  return { checked, updates: found.sort((a, b) => a.name.localeCompare(b.name)) };
}

/** package.json with these updates applied, line by line, so everything else stays as written. */
export function bump(lines: string[], updates: { name: string; from: string; to: string }[]): string[] {
  return lines.map((line) => {
    for (const u of updates) {
      const key = JSON.stringify(u.name), at = line.indexOf(key);
      if (at < 0) continue;
      const rest = line.slice(at + key.length);
      const m = /^(\s*:\s*)"([^"]*)"/.exec(rest);
      if (m && m[2] === u.from) return line.slice(0, at + key.length) + m[1] + JSON.stringify(u.to) + rest.slice(m[0].length);
    }
    return line;
  });
}

// ---- testing in a throwaway clone --------------------------------------------

/** A clone in a temp dir, `bun install`, the test script if there is one, then the clone is deleted. Desktop only. */
export const localTester = (timeoutMs = 10 * 60_000): Tester => async (remote, files) => {
  const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "codesplitters-deps-"));
  const run = async (cmd: string[], cwd = dir) => {
    const p = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe", timeout: timeoutMs, env: { ...process.env, CI: "1" } });
    const [o, e] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    return { code: await p.exited, out: `$ ${cmd.join(" ")}\n${o}${e}` };
  };
  try {
    const clone = await run(["git", "clone", "--depth", "1", "--quiet", remote, "repo"]);
    if (clone.code !== 0) return { ok: false, out: clone.out.replace(remote, "<remote>") };
    const repo = join(dir, "repo");
    for (const [path, text] of Object.entries(files)) writeFileSync(join(repo, path), text);
    const install = await run(["bun", "install"], repo);
    if (install.code !== 0) return { ok: false, out: install.out };
    const pkg = JSON.parse(files["package.json"] ?? "{}");
    if (!pkg.scripts?.test) return { ok: true, out: install.out + "\n(no test script)" };
    const t = await run(["bun", "run", "test"], repo);
    return { ok: t.code === 0, out: t.out };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** Where tests can run: the desktop, when the owner turned them on. */
const testerFor = (env: Env, s: Settings): Tester | null =>
  !s.run_tests ? null : (env.DEPS_TESTER as Tester | undefined) ?? (typeof Bun !== "undefined" && !env.BETTER_AUTH_SECRET ? localTester() : null);

// ---- a run ------------------------------------------------------------------

type Call = (who: string | null, path: string, init?: RequestInit) => Promise<Response>;

/** Check one repo now, put what's worth taking on a branch, and keep the report. */
export async function runDoctor(env: Env, call: Call, owner: string, repo: string, opts: { registry?: Registry; now?: number; deadline?: number } = {}): Promise<Report> {
  const now = opts.now ?? Date.now();
  const s = await settings(env, owner, repo);
  const report = await check(env, call, owner, repo, s, opts.registry ?? (env.DEPS_REGISTRY as Registry | undefined) ?? npmRegistry, now, opts.deadline)
    .catch((e: Error): Report => ({ at: now, checked: 0, updates: [], note: `failed: ${e.message}` }));
  await env.DB.prepare("UPDATE dep_watches SET last_run = ?, last_report = ?, running_since = NULL WHERE owner = ? AND repo = ?").bind(now, JSON.stringify(report), owner, repo).run();
  return report;
}

async function check(env: Env, call: Call, owner: string, repo: string, s: Settings, registry: Registry, now: number, deadline?: number): Promise<Report> {
  const base = `/api/repos/${owner}/${repo}`, q = "?path=package.json";
  const res = await call(owner, `${base}/do/file${q}`);
  if (!res.ok) return { at: now, checked: 0, updates: [], note: res.status === 404 ? "no package.json at the top of this repo" : `reading package.json: ${res.status}` };
  const doc = (await res.json()) as Doc;
  const lines = doc.lines.map((l) => l.text);
  let pkg: Record<string, any>;
  try { pkg = JSON.parse(lines.join("\n")); } catch { return { at: now, checked: 0, updates: [], note: "package.json isn't valid JSON" }; }
  const { checked, updates: found } = await outdated(pkg, s, registry, now);
  if (!found.length) return { at: now, checked, updates: [], note: "everything is up to date" };

  // Try them together, and only one by one when that breaks.
  const tester = testerFor(env, s);
  let updates: Update[] = found.map((u) => ({ ...u, status: "untested" }));
  let note = tester ? undefined : s.run_tests ? "tests only run on the desktop app" : undefined;
  let tested = false;
  if (tester) {
    const h = await handleFor(env, owner, repo);
    const art = h && await artifactAccess(h.handle, h.remote, "read", 3600);
    if (!art) note = "no git remote to test against";
    else {
      const remote = art.remote.replace("://", `://x:${art.token.split("?")[0]}@`);
      tested = true;
      // With a deadline (the cron's time limit), a try only starts if there's room for one as slow as the slowest so far.
      let slowest = 0, short = false;
      const tryWith = async (us: Update[]) => {
        if (deadline && Date.now() + slowest > deadline) { short = true; return null; }
        const t0 = Date.now();
        const r = await tester(remote, { "package.json": bump(lines, us).join("\n") + "\n" });
        slowest = Math.max(slowest, Date.now() - t0);
        return r;
      };
      const all = await tryWith(updates);
      if (all?.ok) updates = updates.map((u) => ({ ...u, status: "kept" }));
      else if (all && updates.length === 1) updates = [{ ...updates[0]!, status: "broke", out: tail(all.out) }];
      else if (all) {
        for (const u of updates) { const r = await tryWith([u]); if (r) Object.assign(u, r.ok ? { status: "kept" } : { status: "broke", out: tail(r.out) }); }
        const kept = updates.filter((u) => u.status === "kept");
        const again = kept.length > 1 ? await tryWith(kept) : { ok: true };
        if (!again?.ok) for (const u of kept) u.status = "untested";
        if (again && !again.ok) {
          note = "each of these passes alone but not together; nothing was put on a branch";
          return { at: now, checked, updates, note };
        }
      }
      if (short) note = "ran out of time before every test ran; only what passed went on a branch, and the next run tries the rest";
    }
  }
  // Once tests ran, only what passed them goes on the branch.
  const take = updates.filter((u) => tested ? u.status === "kept" : u.status !== "broke");
  if (!take.length) return { at: now, checked, updates, note: note ?? "every update broke the tests; nothing was put on a branch" };


  // The branch: agent-deps opens it and makes the edits, so blame says who.
  const agent = "agent-deps";
  const add = await call(owner, `${base}/collaborators`, { method: "POST", body: JSON.stringify({ name: agent }) });
  if (!add.ok) throw new Error(`adding ${agent}: ${add.status}`);
  const day = new Date(now).toISOString().slice(0, 10);
  let branch = "";
  for (let n = 1; n < 20 && !branch; n++) {
    const name = n === 1 ? `deps-${day}` : `deps-${day}-${n}`;
    const r = await call(agent, `${base}/branches`, { method: "POST", body: JSON.stringify({ name }) });
    if (r.ok) branch = name;
    else if (r.status !== 409) throw new Error(`opening a branch: ${r.status} ${await r.text()}`);
  }
  if (!branch) throw new Error("no free branch name today");
  const onBranch = `${base}/do/file${q}&branch=${branch}`;
  const copy = (await (await call(agent, onBranch)).json()) as Doc;
  const next = bump(copy.lines.map((l) => l.text), take);
  const ops: Op[] = copy.lines.flatMap((l, i) => next[i] !== l.text ? [{ kind: "set" as const, line: l.id, text: next[i]!, base: l.rev }] : []);
  const posted = await call(agent, `${base}/do/ops${q}&branch=${branch}`, { method: "POST", body: JSON.stringify({ ops }) });
  if (!posted.ok) throw new Error(`editing package.json on ${branch}: ${posted.status}`);
  return { at: now, checked, updates, branch, ...(note ? { note } : {}) };
}

const tail = (s: string) => s.trim().slice(-1500);

// ---- settings, routes and the schedule ----------------------------------------

export async function settings(env: Env, owner: string, repo: string): Promise<Settings> {
  const r = await env.DB.prepare("SELECT * FROM dep_watches WHERE owner = ? AND repo = ?").bind(owner, repo).first();
  if (!r) return { ...DEFAULTS };
  return { on: !!r.enabled, every_hours: r.every_hours, max_level: r.max_level, min_age_days: r.min_age_days, ignore: r.ignore ? String(r.ignore).split(",") : [], run_tests: !!r.run_tests };
}

/** A run that hasn't reported in an hour died with its process; the next one may go. */
const STALE = 3_600_000;

/** Mark a run as started, unless one already is. */
async function claim(env: Env, owner: string, repo: string, now = Date.now()) {
  const r = await env.DB.prepare("UPDATE dep_watches SET running_since = ? WHERE owner = ? AND repo = ? AND (running_since IS NULL OR running_since < ?)").bind(now, owner, repo, now - STALE).run();
  return !!r.meta?.changes;
}

/** Calls into the app as someone, the way agent-routes does. */
const caller = (self: (r: Request) => Promise<Response>, origin: string): Call => (who, path, init = {}) => {
  const r = new Request(origin + path, init);
  if (who) actingAs.set(r, who);
  return self(r);
};

export async function depRoutes(req: Request, env: Env, p: string[], url: URL, user: string | null, self: (r: Request) => Promise<Response>): Promise<Response | null> {
  if (!(p[1] === "repos" && p[2] && p[3] && p[4] === "deps")) return null;
  const [owner, repo] = [p[2], p[3]];
  // Settings and reports quote the repo's test output, so they're the owner's alone.
  if (user !== owner) return json({ error: "only the repo's owner can see its dependency doctor" }, 403);
  if (!(await env.DB.prepare("SELECT 1 FROM repos WHERE owner = ? AND name = ?").bind(owner, repo).first())) return json({ error: "not found" }, 404);
  await env.DB.prepare("INSERT OR IGNORE INTO dep_watches (owner, repo) VALUES (?, ?)").bind(owner, repo).run();

  if (!p[5] && req.method === "GET") {
    const r = await env.DB.prepare("SELECT last_run, last_report, running_since FROM dep_watches WHERE owner = ? AND repo = ?").bind(owner, repo).first();
    const canTest = !!env.DEPS_TESTER || (typeof Bun !== "undefined" && !env.BETTER_AUTH_SECRET);
    return json({ settings: await settings(env, owner, repo), last_run: r.last_run, report: r.last_report ? JSON.parse(r.last_report) : null, running: !!r.running_since && r.running_since > Date.now() - STALE, can_test: canTest });
  }
  if (!p[5] && req.method === "PUT") {
    const b = (await req.json()) as Partial<Settings>;
    const s = { ...(await settings(env, owner, repo)), ...b };
    if (!LEVELS.includes(s.max_level)) return json({ error: "max_level: patch, minor or major" }, 400);
    const every = Math.round(Number(s.every_hours)), age = Math.round(Number(s.min_age_days));
    if (!(every >= 1 && every <= 24 * 30)) return json({ error: "every_hours: 1 to 720" }, 400);
    if (!(age >= 0 && age <= 90)) return json({ error: "min_age_days: 0 to 90" }, 400);
    const ignore = (Array.isArray(s.ignore) ? s.ignore : String(s.ignore).split(",")).map((x) => x.trim()).filter(Boolean).join(",");
    await env.DB.prepare("UPDATE dep_watches SET enabled = ?, every_hours = ?, max_level = ?, min_age_days = ?, ignore = ?, run_tests = ? WHERE owner = ? AND repo = ?")
      .bind(s.on ? 1 : 0, every, s.max_level, age, ignore, s.run_tests ? 1 : 0, owner, repo).run();
    return json(await settings(env, owner, repo));
  }
  if (p[5] === "run" && req.method === "POST") {
    if (!(await claim(env, owner, repo))) return json({ error: "already checking" }, 409);
    const done = runDoctor(env, caller(self, url.origin), owner, repo);
    // A run that installs and tests takes minutes: answer now, and the page polls.
    if (testerFor(env, await settings(env, owner, repo))) { void done; return json({ running: true }, 202); }
    return json(await done);
  }
  return null;
}

/**
 * How long a scheduled run may test for. A cron's waitUntil gets 15 minutes of wall clock on
 * Cloudflare; this leaves room to write the branch. Repos not reached wait for the next cron.
 */
export const SCHEDULED_BUDGET = 12 * 60_000;

/** The Worker's scheduled(): every repo whose doctor is on and due gets a run, while there's time. */
export async function scheduledDoctor(env: Env, self: (r: Request) => Promise<Response>, now = Date.now(), budgetMs = SCHEDULED_BUDGET) {
  const deadline = Date.now() + budgetMs;
  const { results } = await env.DB.prepare(
    "SELECT owner, repo FROM dep_watches WHERE enabled = 1 AND (running_since IS NULL OR running_since < ?) AND (last_run IS NULL OR last_run + every_hours * 3600000 <= ?)").bind(now - STALE, now + 60_000).all();
  const call = caller(self, "http://codesplitters.local");
  for (const { owner, repo } of results as { owner: string; repo: string }[]) {
    if (Date.now() >= deadline) break;
    if (await claim(env, owner, repo, now)) await runDoctor(env, call, owner, repo, { now, deadline });
  }
}
