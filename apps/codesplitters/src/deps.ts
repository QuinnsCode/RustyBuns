// The dependency doctor. On a schedule each repo's owner tunes, it reads the
// repo's package.json (and each workspace's), asks the registry what's newer,
// and puts the updates worth taking on a branch as `agent-deps`, ready to
// review and merge like any other branch. The registry is npm's unless the
// repo's .npmrc names another, per scope or for everything; on the desktop the
// owner's own ~/.npmrc lends its tokens, each only to its own host. To keep updates from piling up it only proposes a version the
// current range doesn't already allow (the lockfile covers the rest), never
// one younger than the minimum age (a bad or hijacked release usually gets
// pulled within days), never past the level the owner allows, and never
// anything on the ignore list.
//
// The repo's lockfile says which package manager it uses (bun, npm, pnpm or
// yarn), and the lockfile goes on the branch too, regenerated in a throwaway
// clone on the desktop with install scripts off, so nothing of the repo's runs.
//
// With tests on (desktop only, and the owner's choice, since it runs the
// repo's own code), each update is tried in a throwaway clone first: install,
// then the test script, then the clone is deleted. If the updates together
// break the tests, each is tried alone and only the ones that pass go on the
// branch. A run that installs takes minutes, so the desktop answers "running"
// and the page polls.
//
//   GET  /api/repos/:o/:r/deps        settings and the last report (owner only)
//   PUT  /api/repos/:o/:r/deps        {on, every_hours, max_level, min_age_days, ignore, run_tests}
//   POST /api/repos/:o/:r/deps/run    check now

import type { Doc, Op } from "./lines.ts";
import { access as artifactAccess, handleFor } from "./archive.ts";
import { actingAs } from "./identity.ts";
import { workspaceDirs, workspaceGlobs } from "./fit.ts";
import { diffToOps } from "./sync.ts";
import { json, type Env } from "./env.ts";

export type Level = "patch" | "minor" | "major";
const LEVELS: Level[] = ["patch", "minor", "major"];

export interface Settings { on: boolean; every_hours: number; max_level: Level; min_age_days: number; ignore: string[]; run_tests: boolean }
export const DEFAULTS: Settings = { on: false, every_hours: 24, max_level: "minor", min_age_days: 3, ignore: [], run_tests: false };

/** One dependency to move, in the package.json at `path` (the top one, or a workspace's). */
export interface Update { name: string; from: string; to: string; level: Level; status: "kept" | "broke" | "untested"; out?: string; path?: string }
export interface Report { at: number; checked: number; updates: Update[]; branch?: string; lock?: string; note?: string }

/** What npm says about a package: its versions and when each was published. */
export type Registry = (name: string) => Promise<{ versions: string[]; time: Record<string, string> } | null>;

/** What an .npmrc says about registries: the default, one per scope, and a token per host. */
export interface Npmrc { registry?: string; scopes: Record<string, string>; tokens: Record<string, string> }

/** Read an .npmrc. `${VAR}`s come from `vars`, so only the owner's own file gets any. */
export function parseNpmrc(text: string, vars: Record<string, string | undefined> = {}): Npmrc {
  const rc: Npmrc = { scopes: {}, tokens: {} };
  for (const raw of text.split("\n")) {
    const line = raw.trim(), eq = line.indexOf("=");
    if (!line || line.startsWith("#") || line.startsWith(";") || eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^(["'])(.*)\1$/, "$2").replace(/\$\{(\w+)\}/g, (_, v) => vars[v] ?? "");
    if (key === "registry") rc.registry = value;
    else if (/^@[^:/]+:registry$/.test(key)) rc.scopes[key.split(":")[0]!] = value;
    else if (key.startsWith("//") && key.endsWith(":_authToken") && value) rc.tokens[key.slice(2, -":_authToken".length).replace(/\/?$/, "/")] = value;
  }
  return rc;
}

/** Where a package's metadata lives, and the token for that host if there is one. Later .npmrc files win. */
export function registryUrl(rcs: Npmrc[], name: string): { url: string; token?: string } {
  const scope = name.startsWith("@") ? name.split("/")[0]! : "";
  let base = "https://registry.npmjs.org/";
  const tokens: Record<string, string> = {};
  for (const rc of rcs) { base = (scope && rc.scopes[scope]) || rc.registry || base; Object.assign(tokens, rc.tokens); }
  base = base.replace(/\/?$/, "/");
  const bare = base.replace(/^https?:\/\//, "");
  const host = Object.keys(tokens).filter((k) => bare.startsWith(k)).sort((a, b) => b.length - a.length)[0];
  return { url: base + name.replace("/", "%2f"), ...(host ? { token: tokens[host] } : {}) };
}

export const npmrcRegistry = (rcs: Npmrc[]): Registry => async (name) => {
  const { url, token } = registryUrl(rcs, name);
  const res = await fetch(url, { headers: { accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  if (!res.ok) return null;
  const doc = (await res.json()) as { versions?: Record<string, unknown>; time?: Record<string, string> };
  return { versions: Object.keys(doc.versions ?? {}), time: doc.time ?? {} };
};

export const npmRegistry: Registry = npmrcRegistry([]);

/** The owner's ~/.npmrc, on the desktop only: its tokens are theirs, and only ever go to their own hosts. */
async function homeNpmrc(env: Env): Promise<Npmrc | null> {
  if (!onDesktop(env)) return null;
  const { readFile } = await import("node:fs/promises");
  const { homedir } = await import("node:os");
  const text = await readFile(`${homedir()}/.npmrc`, "utf8").catch(() => "");
  return text ? parseNpmrc(text, process.env) : null;
}

export type PM = "bun" | "npm" | "pnpm" | "yarn";
const LOCKS: Record<string, PM> = { "bun.lock": "bun", "bun.lockb": "bun", "pnpm-lock.yaml": "pnpm", "yarn.lock": "yarn", "package-lock.json": "npm" };

/** The repo's package manager, from package.json's packageManager or its lockfile; bun when there's neither. */
export function packageManager(top: string[], pkg: Record<string, any>): { pm: PM; lock: string | null } {
  const named = /^(bun|npm|pnpm|yarn)@/.exec(String(pkg.packageManager ?? ""))?.[1] as PM | undefined;
  const lock = Object.keys(LOCKS).find((f) => top.includes(f) && (!named || LOCKS[f] === named)) ?? null;
  return { pm: named ?? (lock ? LOCKS[lock]! : "bun"), lock };
}

/**
 * Install the repo with these files swapped in, in a clone of `remote`. With
 * `test`, a full install and then the test script; without, only the lockfile
 * is regenerated, install scripts off. ok: it all passed (or there is no test
 * script). `lock` is the lockfile afterwards, when it's text.
 */
export type Tester = (remote: string, files: Record<string, string>, opts: { pm: PM; lock: string | null; test: boolean }) => Promise<{ ok: boolean; out: string; lock?: string }>;

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

/** The updates worth proposing for one package.json, newest allowed version each. Paths are the caller's to add. */
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

/** A full install. In CI, pnpm and yarn freeze the lockfile unless told not to. */
const INSTALL: Record<PM, string[]> = { bun: ["bun", "install"], npm: ["npm", "install"], pnpm: ["pnpm", "install", "--no-frozen-lockfile"], yarn: ["yarn", "install"] };
/** Only the lockfile, with no install scripts, so none of the repo's code runs. Yarn 2+ (a .yarnrc.yml) has its own flag. */
const LOCK_ONLY: Record<PM, string[]> = {
  bun: ["bun", "install", "--lockfile-only", "--ignore-scripts"],
  npm: ["npm", "install", "--package-lock-only", "--ignore-scripts"],
  pnpm: ["pnpm", "install", "--lockfile-only", "--ignore-scripts", "--no-frozen-lockfile"],
  yarn: ["yarn", "install", "--ignore-scripts"],
};

/** A clone in a temp dir, an install, the test script if asked and there is one, then the clone is deleted. Desktop only. */
export const localTester = (timeoutMs = 10 * 60_000): Tester => async (remote, files, { pm, lock, test }) => {
  const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "codesplitters-deps-"));
  // A lockfile-only pass gets a bare environment: the repo's .npmrc can't spend the owner's $NPM_TOKEN on a host it picks.
  const env = test ? { ...process.env } : { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR };
  const run = async (cmd: string[], cwd = dir) => {
    const p = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe", timeout: timeoutMs, env: { ...env, CI: "1", YARN_ENABLE_IMMUTABLE_INSTALLS: "false" } });
    const [o, e] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    return { code: await p.exited, out: `$ ${cmd.join(" ")}\n${o}${e}` };
  };
  try {
    const clone = await run(["git", "clone", "--depth", "1", "--quiet", remote, "repo"]);
    if (clone.code !== 0) return { ok: false, out: clone.out.replace(remote, "<remote>") };
    const repo = join(dir, "repo");
    for (const [path, text] of Object.entries(files)) writeFileSync(join(repo, path), text);
    const cmd = test ? INSTALL[pm] : pm === "yarn" && existsSync(join(repo, ".yarnrc.yml")) ? ["yarn", "install", "--mode=update-lockfile"] : LOCK_ONLY[pm];
    const install = await run(cmd, repo);
    if (install.code !== 0) return { ok: false, out: install.out };
    const locked = lock && lock !== "bun.lockb" && existsSync(join(repo, lock)) ? { lock: readFileSync(join(repo, lock), "utf8") } : {};
    if (!test) return { ok: true, out: install.out, ...locked };
    const pkg = JSON.parse(files["package.json"] ?? readFileSync(join(repo, "package.json"), "utf8"));
    if (!pkg.scripts?.test) return { ok: true, out: install.out + "\n(no test script)", ...locked };
    const t = await run([pm, "run", "test"], repo);
    return { ok: t.code === 0, out: t.out, ...locked };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const onDesktop = (env: Env) => typeof Bun !== "undefined" && !env.BETTER_AUTH_SECRET;

/** Where installs can run: the desktop. Tests too, when the owner turned them on. */
const installerFor = (env: Env): Tester | null => (env.DEPS_TESTER as Tester | undefined) ?? (onDesktop(env) ? localTester() : null);

// ---- a run ------------------------------------------------------------------

type Call = (who: string | null, path: string, init?: RequestInit) => Promise<Response>;

/** Check one repo now, put what's worth taking on a branch, and keep the report. */
export async function runDoctor(env: Env, call: Call, owner: string, repo: string, opts: { registry?: Registry; now?: number } = {}): Promise<Report> {
  const now = opts.now ?? Date.now();
  const s = await settings(env, owner, repo);
  const report = await check(env, call, owner, repo, s, opts.registry ?? (env.DEPS_REGISTRY as Registry | undefined) ?? npmRegistry, now)
    .catch((e: Error): Report => ({ at: now, checked: 0, updates: [], note: `failed: ${e.message}` }));
  await env.DB.prepare("UPDATE dep_watches SET last_run = ?, last_report = ?, running_since = NULL WHERE owner = ? AND repo = ?").bind(now, JSON.stringify(report), owner, repo).run();
  return report;
}

async function check(env: Env, call: Call, owner: string, repo: string, s: Settings, registry: Registry, now: number): Promise<Report> {
  const base = `/api/repos/${owner}/${repo}`;
  const fileQ = (path: string, branch?: string) => `?path=${encodeURIComponent(path)}${branch ? `&branch=${branch}` : ""}`;
  const read = async (path: string) => { const r = await call(owner, `${base}/do/file${fileQ(path)}`); return r.ok ? (await r.json()) as Doc : null; };
  const list = async (dir: string) => {
    const r = await call(owner, `${base}/tree?path=${encodeURIComponent(dir)}`);
    return r.status === 200 ? ((await r.json()) as { entries: { path: string; type: string }[] }).entries : null;
  };

  const res = await call(owner, `${base}/do/file${fileQ("package.json")}`);
  if (!res.ok) return { at: now, checked: 0, updates: [], note: res.status === 404 ? "no package.json at the top of this repo" : `reading package.json: ${res.status}` };
  const top = ((await list("")) ?? []).map((e) => e.path);
  // Every package.json: the top one, and each workspace's.
  const manifests = new Map<string, { lines: string[]; pkg: Record<string, any> }>();
  const add = (path: string, doc: Doc) => {
    const lines = doc.lines.map((l) => l.text);
    try { manifests.set(path, { lines, pkg: JSON.parse(lines.join("\n")) }); return true; } catch { return false; }
  };
  if (!add("package.json", (await res.json()) as Doc)) return { at: now, checked: 0, updates: [], note: "package.json isn't valid JSON" };
  const root = manifests.get("package.json")!.pkg;
  const pnpmYaml = top.includes("pnpm-workspace.yaml") ? (await read("pnpm-workspace.yaml"))?.lines.map((l) => l.text).join("\n") ?? null : null;
  for (const dir of await workspaceDirs(workspaceGlobs(root, pnpmYaml), list)) {
    const doc = await read(`${dir}/package.json`);
    if (doc) add(`${dir}/package.json`, doc);
  }

  // The registry the repo's .npmrc names, with the owner's tokens on the desktop. A test's fake registry wins.
  if (registry === npmRegistry) {
    const rcs = [await homeNpmrc(env), top.includes(".npmrc") ? parseNpmrc((await read(".npmrc"))?.lines.map((l) => l.text).join("\n") ?? "") : null];
    registry = npmrcRegistry(rcs.filter((x): x is Npmrc => !!x));
  }
  const asked = new Map<string, ReturnType<Registry>>();
  const once: Registry = (name) => { if (!asked.has(name)) asked.set(name, registry(name)); return asked.get(name)!; };
  // A workspace's own packages are the repo's, not the registry's.
  const own = new Set([...manifests.values()].map((m) => m.pkg.name).filter(Boolean));
  let checked = 0;
  const found: (Omit<Update, "status"> & { path: string })[] = [];
  for (const [path, m] of manifests) {
    const r = await outdated(m.pkg, { ...s, ignore: [...s.ignore, ...own] }, once, now);
    checked += r.checked;
    found.push(...r.updates.map((u) => ({ ...u, path })));
  }
  if (!found.length) return { at: now, checked, updates: [], note: "everything is up to date" };

  const { pm, lock } = packageManager(top, root);
  const filesFor = (us: Update[]) => Object.fromEntries([...manifests].filter(([path]) => us.some((u) => (u.path ?? "package.json") === path))
    .map(([path, m]) => [path, bump(m.lines, us.filter((u) => (u.path ?? "package.json") === path)).join("\n") + "\n"]));
  let remote: string | null | undefined;
  const remoteFor = async () => {
    if (remote !== undefined) return remote;
    const h = await handleFor(env, owner, repo);
    const art = h && await artifactAccess(h.handle, h.remote, "read", 3600);
    return remote = art ? art.remote.replace("://", `://x:${art.token.split("?")[0]}@`) : null;
  };
  const installer = installerFor(env);
  const key = (us: Update[]) => us.map((u) => `${u.path}:${u.name}`).join(",");
  const tried = new Map<string, Awaited<ReturnType<Tester>>>();

  // Try them together, and only one by one when that breaks.
  const tester = s.run_tests ? installer : null;
  let updates: Update[] = found.map((u) => ({ ...u, status: "untested" }));
  let note = tester ? undefined : s.run_tests ? "tests only run on the desktop app" : undefined;
  if (tester) {
    const r = await remoteFor();
    if (!r) note = "no git remote to test against";
    else {
      const tryWith = async (us: Update[]) => { const t = await tester(r, filesFor(us), { pm, lock, test: true }); tried.set(key(us), t); return t; };
      const all = await tryWith(updates);
      if (all.ok) updates = updates.map((u) => ({ ...u, status: "kept" }));
      else if (updates.length === 1) updates = [{ ...updates[0]!, status: "broke", out: tail(all.out) }];
      else {
        for (const u of updates) { const t = await tryWith([u]); Object.assign(u, t.ok ? { status: "kept" } : { status: "broke", out: tail(t.out) }); }
        const kept = updates.filter((u) => u.status === "kept");
        if (kept.length > 1 && !(await tryWith(kept)).ok) {
          for (const u of kept) u.status = "untested";
          note = "each of these passes alone but not together; nothing was put on a branch";
          return { at: now, checked, updates, note };
        }
      }
    }
  }
  const take = updates.filter((u) => u.status !== "broke");
  if (!take.length) return { at: now, checked, updates, note: note ?? "every update broke the tests; nothing was put on a branch" };

  // The lockfile to match, from the install that passed, else one made for it.
  let locked: string | undefined;
  const lockNote = (why: string) => { note = [note, `${lock} ${why}`].filter(Boolean).join("; "); };
  if (lock === "bun.lockb") lockNote("is binary, so it isn't updated here: run `bun install --save-text-lockfile` to switch to bun.lock");
  else if (lock && !installer) lockNote(`isn't updated here: run \`${pm} install\` on the branch, or check from the desktop app`);
  else if (lock) {
    const r = await remoteFor();
    const t = tried.get(key(take)) ?? (r ? await installer!(r, filesFor(take), { pm, lock, test: false }) : null);
    if (t?.ok && t.lock !== undefined) locked = t.lock;
    else lockNote(`couldn't be regenerated${t ? `: ${tail(t.out).slice(-300)}` : ": no git remote"}`);
  }

  // The branch: agent-deps opens it and makes the edits, so blame says who.
  const agent = "agent-deps";
  const added = await call(owner, `${base}/collaborators`, { method: "POST", body: JSON.stringify({ name: agent }) });
  if (!added.ok) throw new Error(`adding ${agent}: ${added.status}`);
  const day = new Date(now).toISOString().slice(0, 10);
  let branch = "";
  for (let n = 1; n < 20 && !branch; n++) {
    const name = n === 1 ? `deps-${day}` : `deps-${day}-${n}`;
    const r = await call(agent, `${base}/branches`, { method: "POST", body: JSON.stringify({ name }) });
    if (r.ok) branch = name;
    else if (r.status !== 409) throw new Error(`opening a branch: ${r.status} ${await r.text()}`);
  }
  if (!branch) throw new Error("no free branch name today");
  /** Turn a file on the branch into `next`, line by line, so untouched lines keep their authors. */
  const write = async (path: string, next: (lines: string[]) => string[]) => {
    const copy = (await (await call(agent, `${base}/do/file${fileQ(path, branch)}`)).json()) as Doc;
    const ops = diffToOps(copy.lines, next(copy.lines.map((l) => l.text)));
    if (!ops.length) return;
    const posted = await call(agent, `${base}/do/ops${fileQ(path, branch)}`, { method: "POST", body: JSON.stringify({ ops }) });
    if (!posted.ok) throw new Error(`editing ${path} on ${branch}: ${posted.status}`);
  };
  for (const path of manifests.keys()) {
    const mine = take.filter((u) => (u.path ?? "package.json") === path);
    if (mine.length) await write(path, (lines) => bump(lines, mine));
  }
  if (locked !== undefined) await write(lock!, () => locked!.split("\n"));
  return { at: now, checked, updates, branch, ...(locked !== undefined ? { lock: lock! } : {}), ...(note ? { note } : {}) };
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
    return json({ settings: await settings(env, owner, repo), last_run: r.last_run, report: r.last_report ? JSON.parse(r.last_report) : null, running: !!r.running_since && r.running_since > Date.now() - STALE, can_test: !!installerFor(env) });
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
    if ((await settings(env, owner, repo)).run_tests && installerFor(env)) { void done; return json({ running: true }, 202); }
    // One that only reads the registry is quick, unless it regenerates a lockfile.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const report = await Promise.race([done, new Promise<null>((r) => { timer = setTimeout(() => r(null), 15_000); })]);
    clearTimeout(timer);
    return report ? json(report) : json({ running: true }, 202);
  }
  return null;
}

/** The Worker's scheduled(): every repo whose doctor is on and due gets a run. */
export async function scheduledDoctor(env: Env, self: (r: Request) => Promise<Response>, now = Date.now()) {
  const { results } = await env.DB.prepare(
    "SELECT owner, repo FROM dep_watches WHERE enabled = 1 AND (running_since IS NULL OR running_since < ?) AND (last_run IS NULL OR last_run + every_hours * 3600000 <= ?)").bind(now - STALE, now + 60_000).all();
  const call = caller(self, "http://codesplitters.local");
  for (const { owner, repo } of results as { owner: string; repo: string }[]) {
    if (await claim(env, owner, repo, now)) await runDoctor(env, call, owner, repo, { now });
  }
}
