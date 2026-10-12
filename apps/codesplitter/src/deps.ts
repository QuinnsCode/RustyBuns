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
// It also asks OSV (osv.dev, which carries GitHub's and npm's advisories) whether
// the version each range starts at has a known vulnerability. One that does is
// moved to the first release that fixes it, past the level and the minimum age
// (the advisory, not the release, says which version is safe), and raising the
// range makes every install take it, whatever the lockfile held. One with no
// fixed release yet is listed in the report as exposed, ignored or not. When a
// run finds a newly exposed dependency or puts new security fixes on a branch,
// the owner hears once: an email on the site, a system notification on the desktop.
// scripts/deps-doctor.ts runs the same check on RustyBuns itself, weekly in CI.
//
// The repo's lockfile says which package manager it uses (bun, npm, pnpm or
// yarn), and the lockfile goes on the branch too, regenerated in a throwaway
// clone with install scripts off, so nothing of the repo's runs.
//
// With tests on (the owner's choice, since it runs the repo's own code), each
// update is tried in a throwaway clone first: install, then the test script,
// then the clone is deleted. On the desktop that's a temp dir; on Cloudflare
// it's a fresh AGENT_SANDBOX container per try, for the site's admins only,
// like hosted agents, since it bills container time. If the updates together
// break the tests, each is tried alone and only the ones that pass go on the
// branch. A run that installs takes minutes, so the desktop answers "running"
// and the page polls.
//
// With a fixer on too, an update that broke the tests isn't simply dropped: a
// coding agent gets the failing output, the package's changelog and the
// repo's history of the affected API, patches the call sites across as many
// files as it needs in the same throwaway clone, and the tests run again,
// until they pass or it runs out of tries. On Cloudflare that's a container
// too, with only that agent's logins, and the repo's install and tests run there
// as another user, who can't read them (sandbox/server.mjs). A fix that passes lands on the same
// branch, blamed on agent-<harness>; the agent worked on the last commit, so a
// file with live edits since gets the fix merged into them line by line, and is
// left out only where the two touch the same lines. A run says it's alive every
// few minutes, so a long one is never taken for dead and run twice.
//
// That fixer is one step of the owner's on-fail chain (#861): what happens to an
// update that broke the tests, step by step in the owner's order, stopping at
// the first that works. 🔁 retry it, in case the break was a flake; 🤖 the fixer;
// 🔎 the fixer told to search the web for known breakage first (claude only, its
// search runs on Anthropic's side); 📌 hold that release back, so later runs skip
// it; ↩️ roll back to the newest release one level smaller; 🔔 tell the owner.
// The whole chain of one update gets a few tries, minutes and dollars of AI at
// most (claude says what each try cost; the others don't, so they aren't
// counted), and the report says which step settled each update.
//
// 🪏 A dig (#863) is a future release the owner asked to watch: the next major, a
// dist-tag (beta, next, rc) or an exact version, of one package. Each run looks for
// it, past the level and the ignore list since the owner named it, and once it's
// out tries it in the throwaway clone on top of what passes, down the on-fail
// chain if it breaks. The report says how it went. With "take it when it's green"
// on, one that passes goes on the branch, once it's as old as the minimum age.
//
// With previews on too (#864, opt-in, since it costs deploy time), what passed
// the tests is checked against a real deploy before it goes on the branch: the
// same preview deploy the owner starts by hand (preview.ts), with the branch's
// files laid over the clone, deployed to a preview-<id> stage, checked to
// answer, and destroyed. Never a real stage: only a person ships. If it fails,
// each update goes up alone to find the one that broke it, and that one goes
// down the on-fail chain, which then has to pass the tests and a preview; what's
// left goes up together once more. Each preview counts against the owner's
// preview-deploy limit (limits.ts) and is logged with their own previews, by
// agent-deps. A run that's out of time or over the limit puts nothing unchecked
// on the branch. Previews run on the desktop, with its logins.
//
//   GET  /api/repos/:o/:r/deps        settings and the last report (owner only)
//   PUT  /api/repos/:o/:r/deps        {on, every_hours, max_level, min_age_days, ignore, run_tests, fix_with, fix_tries, on_fail, chain_tries, chain_minutes, chain_usd, held, preview, digs}
//   POST /api/repos/:o/:r/deps/run    check now

import type { Doc, Op } from "./lines.ts";
import { access as artifactAccess, handleFor } from "./archive.ts";
import { actingAs, isAdmin, mail, mailOn } from "./identity.ts";
import { workspaceDirs, workspaceGlobs } from "./fit.ts";
import { diffToOps, merge3 } from "./sync.ts";
import { json, type Env } from "./env.ts";
import { execCommand, fromDisk, toDisk, type Exec } from "./agent-run.ts";
import { CLAUDE_TOOLS, FIX_HARNESSES, harnessCommand, type Command, type Harness } from "./harness.ts";
import { hitsFor } from "./watch.ts";
import { settings as deploySettings } from "./deploy.ts";
import { charge } from "./limits.ts";
import { logEnd, logStart, preview, runnerFor, runs as livePreviews, STEPS as PREVIEW_STEPS, type Run as PreviewDeploy } from "./preview.ts";

export type Level = "patch" | "minor" | "major";
const LEVELS: Level[] = ["patch", "minor", "major"];

/** The on-fail chain's steps: retry, AI fix, AI web search, hold back, roll back, alert. */
export type Step = "retry" | "fix" | "search" | "hold" | "rollback" | "alert";
export const STEPS: Step[] = ["retry", "fix", "search", "hold", "rollback", "alert"];

export interface Settings {
  on: boolean; every_hours: number; max_level: Level; min_age_days: number; ignore: string[]; run_tests: boolean; fix_with: Harness | null; fix_tries: number;
  /** What happens to an update that broke the tests, in order, until a step works. */
  on_fail: Step[];
  /** Limits over one update's whole chain: test runs and agent tries, minutes, and dollars of AI. */
  chain_tries: number; chain_minutes: number; chain_usd: number;
  /** Releases held back ("name@version"), which no run proposes again. */
  held: string[];
  /** Deploy what passed as a preview, check it answers, and tear it down, before it goes on the branch (#864). */
  preview: boolean;
  /** 🪏 Future releases to watch, try, and maybe take. */
  digs: Dig[];
}
export const DEFAULTS: Settings = { on: false, every_hours: 24, max_level: "minor", min_age_days: 3, ignore: [], run_tests: false, fix_with: null, fix_tries: 3, on_fail: ["fix"], chain_tries: 6, chain_minutes: 30, chain_usd: 2, held: [], preview: false, digs: [] };

/** 🪏 A future release of one package to watch for: "major" (the next major), a dist-tag like beta, or an exact version. `take`: onto the branch once it's green. */
export interface Dig { name: string; target: string; take: boolean }
/** What came of a dig this run: not out yet, already in the range, held back, or out and tried (`update`). */
export interface Dug extends Dig { path?: string; version?: string; status: "waiting" | "in" | "held" | "out"; update?: Update; taken?: boolean; note?: string }
/** The most digs one repo keeps. */
export const MAX_DIGS = 10;

/** One dependency to move, in the package.json at `path` (the top one, or a workspace's). */
export interface Update {
  name: string; from: string; to: string; level: Level;
  status: "kept" | "fixed" | "broke" | "untested" | "held";
  /** The last failing test output. */
  out?: string;
  /** A fixer's go at it: who, how many tries, and the files its passing fix changed (none if it gave up). */
  fix?: { by: string; tries: number; files: string[] };
  path?: string;
  /** The advisories this update fixes. */
  fixes?: string[];
  /** The on-fail chain's go at it, step by step: the last ok one settled it; none ok, it gave up. */
  chain?: { step: Step; ok: boolean; note?: string; usd?: number }[];
  /** Where it was headed before a roll back. */
  was?: string;
}
/** A dependency whose version has a known vulnerability that no release fixes yet (or that's on the ignore list). */
export interface Exposed { name: string; version: string; ids: string[]; path?: string }
/** A preview deploy the run made: which updates went up, and whether it deployed and answered (else which step failed). */
export interface PreviewRun { id: string; stage: string; ok: boolean; names: string[]; url?: string; failed?: string; note?: string }
export interface Report { at: number; checked: number; updates: Update[]; exposed?: Exposed[]; previews?: PreviewRun[]; digs?: Dug[]; branch?: string; lock?: string; note?: string }

/** A known vulnerability, and the versions that fix it (on each line it affects). */
export interface Vuln { id: string; summary: string; fixed: string[] }
/** Which of these exact versions have known vulnerabilities, keyed `name@version`. */
export type Advisories = (pkgs: { name: string; version: string }[]) => Promise<Map<string, Vuln[]>>;

const OSV = "https://api.osv.dev/v1";
/** OSV's batch query says which versions are hit; each hit's details say which versions fix it. */
export const osvAdvisories = (get: typeof fetch = fetch): Advisories => async (pkgs) => {
  const out = new Map<string, Vuln[]>();
  if (!pkgs.length) return out;
  const res = await get(`${OSV}/querybatch`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ queries: pkgs.map((p) => ({ package: { name: p.name, ecosystem: "npm" }, version: p.version })) }) });
  if (!res.ok) throw new Error(`osv.dev: ${res.status}`);
  const { results } = (await res.json()) as { results: { vulns?: { id: string }[] }[] };
  const details = new Map<string, Promise<any>>();
  const detail = (id: string) => {
    if (!details.has(id)) details.set(id, get(`${OSV}/vulns/${encodeURIComponent(id)}`).then((r) => r.ok ? r.json() : null).catch(() => null));
    return details.get(id)!;
  };
  await Promise.all(pkgs.map(async (p, i) => {
    const ids = (results[i]?.vulns ?? []).map((v) => v.id);
    if (!ids.length) return;
    out.set(`${p.name}@${p.version}`, await Promise.all(ids.map(async (id) => {
      const v = await detail(id);
      const fixed = (v?.affected ?? []).filter((a: any) => a.package?.ecosystem === "npm" && a.package?.name === p.name)
        .flatMap((a: any) => (a.ranges ?? []).flatMap((r: any) => (r.events ?? []).map((e: any) => e.fixed).filter(Boolean)));
      return { id, summary: v?.summary ?? "", fixed };
    })));
  }));
  return out;
};

/** What npm says about a package: its versions, when each was published, and its dist-tags. */
export interface Meta { versions: string[]; time: Record<string, string>; tags?: Record<string, string> }
export type Registry = (name: string) => Promise<Meta | null>;

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

/** The registry hosts .npmrc files name, which a container's install has to reach (#681). */
export const npmrcHosts = (rcs: Npmrc[]): string[] =>
  [...new Set(rcs.flatMap((rc) => [rc.registry, ...Object.values(rc.scopes)]).map((u) => u && URL.canParse(u) ? new URL(u).hostname : "").filter(Boolean))];

export const npmrcRegistry = (rcs: Npmrc[]): Registry => async (name) => {
  const { url, token } = registryUrl(rcs, name);
  const res = await fetch(url, { headers: { accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  if (!res.ok) return null;
  const doc = (await res.json()) as { versions?: Record<string, unknown>; time?: Record<string, string>; "dist-tags"?: Record<string, string> };
  return { versions: Object.keys(doc.versions ?? {}), time: doc.time ?? {}, tags: doc["dist-tags"] ?? {} };
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
export type Tester = (remote: string, files: Record<string, string>, opts: { pm: PM; lock: string | null; test: boolean; hosts?: string[] }) => Promise<{ ok: boolean; out: string; lock?: string }>;

/**
 * One update for a coding agent to make work: the clone has `files` swapped in
 * and fails its tests with `out`. With `until` (the cron's deadline), a try only
 * starts if there's room for one as slow as the slowest so far.
 */
export interface FixJob {
  remote: string; files: Record<string, string>; pm: PM; update: Update; out: string; harness: Harness; tries: number; until?: number; hosts?: string[];
  /** Search the web for known breakage first (the chain's 🔎 step). */
  search?: boolean;
  /** Dollars it may spend: no try starts once what's reported reaches it. */
  usd?: number;
}

/** A file the fix changed: its text at the commit cloned (null: new) and after. */
export interface Edit { path: string; before: string | null; after: string }

/** Patch the call sites until the tests pass. ok: they do, and `edits` is the fix. `usd`: what the harness says it cost. */
export type Fixer = (job: FixJob) => Promise<{ ok: boolean; tries: number; out: string; edits: Edit[]; usd?: number }>;

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

/** Could an install of `spec` take `version`? Ranges too fancy to read, and tags like latest, count as yes. */
export function mayTake(spec: string, version: string): boolean {
  const v = parse(version), r = range(spec);
  if (!r) return true;
  return v ? allows(r, v) : spec.trim() === version;
}

/**
 * How big a move is, the way semver reads it: below 1.0 the leftmost non-zero part is the
 * major, so every 0.0.x change breaks, and a 0.x minor does too (a 0.x patch counts as minor).
 */
function levelOf(from: V, to: V): Level {
  const raw = to[0] !== from[0] ? 2 : to[1] !== from[1] ? 1 : 0;
  const shift = from[0] > 0 ? 0 : from[1] > 0 ? 1 : 2;
  return LEVELS[Math.min(2, raw + shift)];
}

/** The version each movable range starts at, the one a vulnerability check asks about. */
export function floors(pkg: Record<string, any>): { name: string; version: string }[] {
  return Object.entries({ ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>)
    .flatMap(([name, spec]) => { const r = range(spec); return r ? [{ name, version: r.v.join(".") }] : []; });
}

/**
 * The updates worth proposing for one package.json, newest allowed version each,
 * and at least the first release that fixes each of `vulns` (keyed name@floor).
 * Paths are the caller's to add.
 */
export async function outdated(pkg: Record<string, any>, s: Settings, registry: Registry, now = Date.now(), vulns = new Map<string, Vuln[]>()) {
  const deps: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies };
  const found: Omit<Update, "status">[] = [];
  const exposed: Exposed[] = [];
  const checks = Object.entries(deps).map(async ([name, spec]) => {
    const r = range(spec);
    if (!r) return 0;   // workspace:, file:, git, tags, wider ranges
    const hits = vulns.get(`${name}@${r.v.join(".")}`) ?? [];
    if (s.ignore.includes(name)) {
      if (hits.length) exposed.push({ name, version: r.v.join("."), ids: hits.map((h) => h.id) });
      return 0;
    }
    // Each advisory's first fix past this version; the update has to reach the latest of them.
    let need: V | null = null;
    const unfixed: string[] = [];
    for (const h of hits) {
      const fix = h.fixed.map(parse).filter((v): v is V => !!v && cmp(v, r.v) > 0).sort(cmp)[0];
      if (!fix) unfixed.push(h.id);
      else if (!need || cmp(fix, need) > 0) need = fix;
    }
    if (unfixed.length) exposed.push({ name, version: r.v.join("."), ids: unfixed });
    const meta = await registry(name).catch(() => null);
    if (!meta) return 0;
    const ripe = now - s.min_age_days * 86_400_000;
    let best: V | null = null;
    for (const raw of meta.versions) {
      const v = parse(raw);
      if (!v || cmp(v, r.v) <= 0 || allows(r, v)) continue;
      if (LEVELS.indexOf(levelOf(r.v, v)) > LEVELS.indexOf(s.max_level)) continue;
      if (s.held?.includes(`${name}@${raw}`)) continue;
      const published = Date.parse(meta.time[raw] ?? "");
      if (!(published <= ripe)) continue;
      if (!best || cmp(v, best) > 0) best = v;
    }
    // Short of the fix, the first published release that has it, however new or far.
    if (need && (!best || cmp(best, need) < 0)) {
      best = meta.versions.map(parse).filter((v): v is V => !!v && cmp(v, need!) >= 0).sort(cmp)[0] ?? best;
      if (!best || cmp(best, need) < 0) exposed.push({ name, version: r.v.join("."), ids: hits.filter((h) => !unfixed.includes(h.id)).map((h) => h.id) });
    }
    const fixes = hits.filter((h) => !unfixed.includes(h.id)).map((h) => h.id);
    if (best) found.push({ name, from: spec, to: r.prefix + best.join("."), level: levelOf(r.v, best), ...(fixes.length && need && cmp(best, need) >= 0 ? { fixes } : {}) });
    return 1;
  });
  const checked = (await Promise.all(checks)).reduce((a: number, b) => a + b, 0);
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  return { checked, updates: found.sort(byName), exposed: exposed.sort(byName) };
}

/** An exact version, a prerelease too (5.0.0-beta.1). */
const VERSION = /^\d+\.\d+\.\d+(-[\w.-]+)?$/;

/** The release a dig points at, if it's out: the newest of the next major line, the dist-tag's, or the exact one. */
export function dugVersion(spec: string, target: string, meta: Meta): string | null {
  if (target === "major") {
    const r = range(spec);
    const next = r ? meta.versions.map(parse).filter((v): v is V => !!v && cmp(v, r.v) > 0 && levelOf(r.v, v) === "major").sort(cmp) : [];
    return next.length ? next.filter((v) => levelOf(next[0]!, v) !== "major").at(-1)!.join(".") : null;
  }
  if (VERSION.test(target)) return meta.versions.includes(target) ? target : null;
  const v = meta.tags?.[target];
  return v && meta.versions.includes(v) ? v : null;
}

/** Has the range already reached `version`: at or past it, or allowing it? A prerelease is never allowed by a range, only reached. */
export function reached(spec: string, version: string): boolean {
  const r = range(spec), dash = version.indexOf("-");
  const v = parse(dash < 0 ? version : version.slice(0, dash));
  if (!r || !v) return true;
  return cmp(v, r.v) <= 0 || (dash < 0 && allows(r, v));
}

/** The dig as an update of `spec`: a prerelease is pinned exactly, a release keeps the range's ^ or ~. */
export function digUpdate(name: string, spec: string, version: string): Omit<Update, "status"> {
  const r = range(spec)!, pre = version.includes("-");
  return { name, from: spec, to: (pre ? "" : r.prefix) + version, level: levelOf(r.v, parse(version.split("-")[0]!)!) };
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

type Run = (cmd: string[]) => Promise<{ code: number; out: string }>;

/**
 * A clone of `remote` in a temp dir with `files` swapped in, handed to `work`,
 * then deleted. `depth` 0 keeps the whole history. `bare` runs it with only
 * PATH, HOME and TMPDIR, so the repo's .npmrc can't spend the owner's
 * $NPM_TOKEN on a host it picks. Desktop only.
 */
async function inClone<T>(remote: string, files: Record<string, string>, depth: number, timeoutMs: number, bare: boolean,
  work: (repo: string, run: Run) => Promise<T>, failed: (out: string) => T): Promise<T> {
  const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { dirname, join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "codesplitter-deps-"));
  const env = bare ? { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR } : { ...process.env };
  const run = (cwd: string): Run => async (cmd) => {
    const p = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe", timeout: timeoutMs, env: { ...env, CI: "1", YARN_ENABLE_IMMUTABLE_INSTALLS: "false" } });
    const [o, e] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    return { code: await p.exited, out: `$ ${cmd.join(" ")}\n${o}${e}` };
  };
  try {
    const clone = await run(dir)(["git", "clone", ...(depth ? ["--depth", String(depth)] : []), "--quiet", remote, "repo"]);
    if (clone.code !== 0) return failed(clone.out.replace(remote, "<remote>"));
    const repo = join(dir, "repo");
    for (const [path, text] of Object.entries(files)) { mkdirSync(dirname(join(repo, path)), { recursive: true }); writeFileSync(join(repo, path), text); }
    return await work(repo, run(repo));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The test script, if there is one, after an install. */
async function runTests(run: Run, repo: string, files: Record<string, string>, pm: PM, installed: string) {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const pkg = JSON.parse(files["package.json"] ?? readFileSync(join(repo, "package.json"), "utf8"));
  if (!pkg.scripts?.test) return { ok: true, out: installed + "\n(no test script)" };
  const t = await run([pm, "run", "test"]);
  return { ok: t.code === 0, out: t.out };
}

/** A full install, then the test script if there is one. */
async function installAndTest(run: Run, repo: string, files: Record<string, string>, pm: PM) {
  const install = await run(INSTALL[pm]);
  if (install.code !== 0) return { ok: false, out: install.out };
  return runTests(run, repo, files, pm, install.out);
}

/** A clone in a temp dir, an install, the test script if asked and there is one, then the clone is deleted. Desktop only. */
export const localTester = (timeoutMs = 10 * 60_000): Tester => (remote, files, { pm, lock, test }) =>
  inClone(remote, files, 1, timeoutMs, !test, async (repo, run) => {
    const { existsSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const cmd = test ? INSTALL[pm] : pm === "yarn" && existsSync(join(repo, ".yarnrc.yml")) ? ["yarn", "install", "--mode=update-lockfile"] : LOCK_ONLY[pm];
    const install = await run(cmd);
    if (install.code !== 0) return { ok: false, out: install.out };
    const locked = lock && lock !== "bun.lockb" && existsSync(join(repo, lock)) ? { lock: readFileSync(join(repo, lock), "utf8") } : {};
    if (!test) return { ok: true, out: install.out, ...locked };
    return { ...(await runTests(run, repo, files, pm, install.out)), ...locked };
  }, (out) => ({ ok: false, out }));

const LOCKFILES = /(^|\/)(bun\.lockb?|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/;

/**
 * The coding agent runs in a full clone (it needs the history), with the
 * update installed. After each try the files the doctor owns are put back,
 * deleted files restored, and the tests run again.
 */
export const localFixer = (exec: Exec = execCommand, timeoutMs = 10 * 60_000): Fixer => (job) =>
  inClone(job.remote, job.files, 0, timeoutMs, false, async (repo, run) => {
    const { existsSync, readFileSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    // The agent needs the history, not the remote, whose URL carries a token.
    await run(["git", "remote", "remove", "origin"]);
    const install = await run(INSTALL[job.pm]);
    const name = job.update.name;
    const changelog = ["CHANGELOG.md", "HISTORY.md", "History.md", "CHANGES.md"].map((f) => join(repo, "node_modules", name, f)).find(existsSync);
    const context = {
      changelog: changelog ? readFileSync(changelog, "utf8").slice(0, 6000) : "",
      history: (await run(["git", "log", "-n", "15", "--format=%h %an, %ar: %s", "-S", name])).out,
      sites: (await run(["git", "grep", "-n", "-F", name, "--", ".", ":!package.json", ":!*.lock", ":!*.lockb"])).out.slice(0, 6000),
    };
    const prompt = fixPrompt(job.update, job.tries, job.search);
    let out = job.out, tries = 0, ok = false, slowest = 0, usd = 0;
    while (tries < job.tries && !ok && install.code === 0 && !(job.until && Date.now() + slowest > job.until) && !(job.usd !== undefined && usd >= job.usd)) {
      tries++;
      const t0 = Date.now();
      const ran = await exec(fixCommand(job.harness, fillPrompt(prompt, { ...context, out: tail(out), try: String(tries) }), job.search), repo);
      usd += costOf(ran.out);
      for (const [path, text] of Object.entries(job.files)) writeFileSync(join(repo, path), text);
      const gone = (await run(["git", "ls-files", "--deleted"])).out.split("\n").slice(1).filter(Boolean);
      if (gone.length) await run(["git", "checkout", "--", ...gone]);
      const t = ran.code !== 0 ? { ok: false, out: `${job.harness} exited ${ran.code}:\n${ran.out.slice(-2000)}` } : await installAndTest(run, repo, job.files, job.pm);
      ({ ok, out } = t);
      slowest = Math.max(slowest, Date.now() - t0);
    }
    if (install.code !== 0) out = install.out;
    if (!ok) return { ok, tries, out, edits: [], usd };
    const status = (await run(["git", "status", "--porcelain", "--untracked-files=all"])).out.split("\n").slice(1);
    const edits: Edit[] = [];
    for (const line of status) {
      const path = line.slice(3).trim();
      if (!path || line.startsWith(" D") || path in job.files || LOCKFILES.test(path) || path.startsWith("node_modules/")) continue;
      const before = line.startsWith("??") ? null : (await run(["git", "show", `HEAD:${path}`])).out.replace(/^.*\n/, "");
      edits.push({ path, before, after: readFileSync(join(repo, path), "utf8") });
    }
    return { ok, tries, out, edits, usd };
  }, (out) => ({ ok: false, tries: 0, out, edits: [], usd: 0 }));

/**
 * The fixer's command line. claude answers in JSON, which says what the try cost,
 * and the 🔎 step gets its web search too (it runs on Anthropic's side, so a
 * container needs no more hosts). The other harnesses report no cost.
 */
export function fixCommand(harness: Harness, prompt: string, search = false): Command {
  const cmd = harnessCommand(harness, prompt);
  if (harness !== "claude") return cmd;
  const args = [...cmd.args, "--output-format", "json"];
  if (search) args[args.indexOf("--tools") + 1] = `${CLAUDE_TOOLS},WebSearch`;
  return { ...cmd, args };
}

/** What a try cost, from claude's JSON answer; 0 when it doesn't say. */
export const costOf = (out: string) => Number(/"total_cost_usd"\s*:\s*([\d.eE+-]+)/.exec(out)?.[1]) || 0;

/**
 * What the fixer is told, with {{try}}, {{out}}, {{changelog}}, {{history}} and
 * {{sites}} filled in on each try (fillPrompt), here or in the container.
 */
export function fixPrompt(u: Update, of: number, search = false): string {
  return [
    `This repository's tests fail after updating the dependency ${u.name} from ${u.from} to ${u.to} (a ${u.level} update). The new version is installed.`,
    `Change the repository's code so it works with ${u.name} ${u.to} and the tests pass. Try {{try}} of ${of}.`,
    ...(search ? [
      ``, `Before you change anything, search the web for known breakage in this release: an issue, release note or migration guide about ${u.name}@${u.to.replace(/^[\^~]/, "")}, alone or together with the packages it is used with here (package.json has their versions).`,
      `Apply the fix or workaround the sources describe, and say which one you followed.`,
    ] : []),
    ``, `The failing test output (after your last try, if this isn't the first):`, `{{out}}`,
    ``, `The start of ${u.name}'s changelog (if it ships none, read its code and types in node_modules/${u.name}):`, `{{changelog}}`,
    ``, `Commits in this repo that added or removed mentions of ${u.name}:`, `{{history}}`,
    ``, `Where the repo mentions ${u.name}:`, `{{sites}}`,
    ``, `Edit as many files as the fix needs, and keep every other line as it is. Do not edit package.json or the lockfile, do not delete files, and do not run git commands.`,
    `The tests run again after you stop.`,
  ].join("\n");
}

/** The prompt for one try. In one pass, so a {{...}} in the test output stays as it is; an empty value reads "(none)". */
export const fillPrompt = (prompt: string, values: Record<string, string>) =>
  prompt.replace(/\{\{(\w+)\}\}/g, (m, k: string) => k in values ? values[k]!.trim() || "(none)" : m);

const onDesktop = (env: Env) => typeof Bun !== "undefined" && !env.BETTER_AUTH_SECRET;

/** Where a lockfile can be regenerated without tests: the desktop. */
const installerFor = (env: Env): Tester | null => (env.DEPS_TESTER as Tester | undefined) ?? (onDesktop(env) ? localTester() : null);

/** The same run in a container of its own (sandbox/server.mjs, POST /deps-test), torn down after. */
export const containerTester = (ns: NonNullable<Env["AGENT_SANDBOX"]>): Tester => async (remote, files, { pm, lock, test, hosts }) => {
  const stub = ns.get(ns.idFromName(crypto.randomUUID()));
  const res = await stub.fetch(new Request("http://sandbox/deps-test", { method: "POST", body: JSON.stringify({ remote, files, pm, lock, test, hosts }) }));
  if (!res.ok) return { ok: false, out: `sandbox: ${res.status} ${(await res.text()).replaceAll(remote, "<remote>")}` };
  return (await res.json()) as { ok: boolean; out: string; lock?: string };
};

/** Where this owner's tests can run: a container for the site's admins, else the desktop. */
function testerAt(env: Env, owner: string): Tester | null {
  if (env.DEPS_TESTER) return env.DEPS_TESTER as Tester;
  if (env.AGENT_SANDBOX) return env.ADMINS && isAdmin(env, owner) ? containerTester(env.AGENT_SANDBOX) : null;
  return installerFor(env);
}

const testerFor = (env: Env, s: Settings, owner: string): Tester | null => s.run_tests ? testerAt(env, owner) : null;

/**
 * The same fix in a container of its own (sandbox/server.mjs, POST /deps-fix), torn down after.
 * The container builds each try's prompt from the template; it gets only the harness's logins.
 */
export const containerFixer = (ns: NonNullable<Env["AGENT_SANDBOX"]>): Fixer => async (job) => {
  const stub = ns.get(ns.idFromName(crypto.randomUUID()));
  const cmd = fixCommand(job.harness, fixPrompt(job.update, job.tries, job.search), job.search);
  const body = { cmd, remote: job.remote, files: job.files, pm: job.pm, name: job.update.name, out: job.out, tries: job.tries, until: job.until, usd: job.usd, hosts: job.hosts };
  const res = await stub.fetch(new Request("http://sandbox/deps-fix", { method: "POST", body: JSON.stringify(body) }));
  if (!res.ok) return { ok: false, tries: 0, out: `sandbox: ${res.status} ${(await res.text()).replaceAll(job.remote, "<remote>")}`, edits: [] };
  return (await res.json()) as Awaited<ReturnType<Fixer>>;
};

/** Who fixes a broken update: the agent the owner picked, wherever the tests run (a container on Cloudflare). */
const fixerFor = (env: Env, s: Settings, owner: string): Fixer | null =>
  !s.fix_with || !testerFor(env, s, owner) ? null
    : (env.DEPS_FIXER as Fixer | undefined) ?? (env.AGENT_SANDBOX ? containerFixer(env.AGENT_SANDBOX) : localFixer(env.AGENT_EXEC as Exec | undefined));

// ---- a run ------------------------------------------------------------------

export type Call = (who: string | null, path: string, init?: RequestInit) => Promise<Response>;

/** Every package.json in a repo: the top one, and each workspace's. A note says why there are none. */
export async function readManifests(call: Call, owner: string, repo: string) {
  const base = `/api/repos/${owner}/${repo}`;
  const fileQ = (path: string, branch?: string) => `?path=${encodeURIComponent(path)}${branch ? `&branch=${branch}` : ""}`;
  const read = async (path: string) => { const r = await call(owner, `${base}/do/file${fileQ(path)}`); return r.ok ? (await r.json()) as Doc : null; };
  const list = async (dir: string) => {
    const r = await call(owner, `${base}/tree?path=${encodeURIComponent(dir)}`);
    return r.status === 200 ? ((await r.json()) as { entries: { path: string; type: string }[] }).entries : null;
  };

  const res = await call(owner, `${base}/do/file${fileQ("package.json")}`);
  if (!res.ok) return { note: res.status === 404 ? "no package.json at the top of this repo" : `reading package.json: ${res.status}` };
  const top = ((await list("")) ?? []).map((e) => e.path);
  const manifests = new Map<string, { lines: string[]; pkg: Record<string, any> }>();
  const add = (path: string, doc: Doc) => {
    const lines = doc.lines.map((l) => l.text);
    try { manifests.set(path, { lines, pkg: JSON.parse(lines.join("\n")) }); return true; } catch { return false; }
  };
  if (!add("package.json", (await res.json()) as Doc)) return { note: "package.json isn't valid JSON" };
  const root = manifests.get("package.json")!.pkg;
  const pnpmYaml = top.includes("pnpm-workspace.yaml") ? (await read("pnpm-workspace.yaml"))?.lines.map((l) => l.text).join("\n") ?? null : null;
  for (const dir of await workspaceDirs(workspaceGlobs(root, pnpmYaml), list)) {
    const doc = await read(`${dir}/package.json`);
    if (doc) add(`${dir}/package.json`, doc);
  }
  return { manifests, top, read, base, fileQ };
}

/** Check one repo now, put what's worth taking on a branch, and keep the report. */
export async function runDoctor(env: Env, call: Call, owner: string, repo: string, opts: { registry?: Registry; now?: number; deadline?: number; beatMs?: number } = {}): Promise<Report> {
  const now = opts.now ?? Date.now();
  const s = await settings(env, owner, repo);
  // While it runs, it says so, so a long one (a slow suite, several fix tries) is never taken for dead.
  const beat = setInterval(() => {
    void env.DB.prepare("UPDATE dep_watches SET running_since = ? WHERE owner = ? AND repo = ? AND running_since IS NOT NULL").bind(Date.now(), owner, repo).run().catch(() => {});
  }, opts.beatMs ?? BEAT);
  const advisories = (env.DEPS_ADVISORIES as Advisories | undefined) ?? osvAdvisories();
  const report = await check(env, call, owner, repo, s, opts.registry ?? (env.DEPS_REGISTRY as Registry | undefined) ?? npmRegistry, advisories, now, opts.deadline)
    .catch((e: Error): Report => ({ at: now, checked: 0, updates: [], note: `failed: ${e.message}` }))
    .finally(() => clearInterval(beat));
  await env.DB.prepare("UPDATE dep_watches SET last_run = ?, last_report = ?, running_since = NULL WHERE owner = ? AND repo = ?").bind(now, JSON.stringify(report), owner, repo).run();
  // A failed run knows nothing new, so it neither alerts nor forgets what was told.
  if (!report.note?.startsWith("failed:")) {
    const row = await env.DB.prepare("SELECT alerted FROM dep_watches WHERE owner = ? AND repo = ?").bind(owner, repo).first();
    const news = whatsNew(row?.alerted ? String(row.alerted).split("\n") : [], report);
    await env.DB.prepare("UPDATE dep_watches SET alerted = ? WHERE owner = ? AND repo = ?").bind(news.seen.join("\n"), owner, repo).run();
    if (news.exposed.length || news.fixes.length || news.broke.length || news.dug.length) await alert(env, owner, repo, report, news).catch((e) => console.error("codeSplitter: dependency alert failed", String((e as Error)?.message ?? e)));
  }
  return report;
}

// ---- telling the owner ----------------------------------------------------------

/**
 * What this report has that the owner wasn't told about yet: advisories no update
 * fixes, security fixes on its branch, broken updates whose on-fail chain
 * ended in 🔔, and 🪏 digs that came out and were tried. `seen` is what to remember for next time: everything in this
 * report, so one that goes away and comes back is news again.
 */
export function whatsNew(told: string[], report: Report): { exposed: Exposed[]; fixes: Update[]; broke: Update[]; dug: Dug[]; seen: string[] } {
  const was = new Set(told), seen: string[] = [];
  const key = (kind: string, path: string | undefined, nameAt: string, id: string) => { const k = `${kind} ${path ?? "package.json"} ${nameAt} ${id}`; seen.push(k); return !was.has(k); };
  const exposed = (report.exposed ?? []).map((x) => ({ ...x, ids: x.ids.filter((id) => key("exposed", x.path, `${x.name}@${x.version}`, id)) })).filter((x) => x.ids.length);
  // What went on the branch: once tests ran, what passed; else everything that didn't break.
  const tested = report.updates.some((u) => u.status !== "untested");
  const taken = report.branch ? report.updates.filter((u) => u.fixes?.length && (tested ? u.status === "kept" || u.status === "fixed" : true)) : [];
  const fixes = taken.filter((u) => u.fixes!.map((id) => key("fix", u.path, `${u.name}@${u.to}`, id)).some(Boolean));
  const dugs = (report.digs ?? []).filter((d) => d.update && d.update.status !== "untested");
  const broke = [...report.updates, ...dugs.map((d) => d.update!)].filter((u) => u.chain?.at(-1)?.step === "alert" && u.chain.at(-1)!.ok).filter((u) => key("broke", u.path, `${u.name}@${u.to}`, "tests"));
  // A dig is news when its release is first tried, and again when it's taken.
  const dug = dugs.filter((d) => key("dug", d.path, `${d.name}@${d.version}`, d.taken ? "taken" : "tried"));
  return { exposed, fixes, broke, dug, seen };
}

/** Says a short thing to the owner: a subject, some lines, a link. */
export type Notify = (owner: string, subject: string, lines: string[], link: string) => Promise<void>;

/**
 * The owner hears about it once: by email on the site (when it can send mail and
 * their address is verified), as a system notification on the desktop.
 */
async function alert(env: Env, owner: string, repo: string, report: Report, news: ReturnType<typeof whatsNew>) {
  const lines: string[] = [];
  if (news.fixes.length) lines.push(`The dependency doctor put security fixes on the branch ${report.branch}, ready to review and merge:`,
    ...news.fixes.map((u) => `  ${u.name} ${u.from} → ${u.to}${u.path && u.path !== "package.json" ? ` (${u.path})` : ""}: ${u.fixes!.join(", ")}`));
  if (news.exposed.length) lines.push(`${news.exposed.length === 1 ? "A dependency has" : `${news.exposed.length} dependencies have`} a known vulnerability that no update here fixes yet:`,
    ...news.exposed.map((x) => `  ${x.name}@${x.version}${x.path && x.path !== "package.json" ? ` (${x.path})` : ""}: ${x.ids.join(", ")}`));
  if (news.broke.length) lines.push(`${news.broke.length === 1 ? "An update breaks" : `${news.broke.length} updates break`} the tests or its preview deploy, and nothing in the on-fail chain got ${news.broke.length === 1 ? "it" : "them"} through, so ${news.broke.length === 1 ? "it's" : "they're"} left out:`,
    ...news.broke.map((u) => `  ${u.name} ${u.from} → ${u.to}${u.path && u.path !== "package.json" ? ` (${u.path})` : ""}: tried ${u.chain!.slice(0, -1).map((c) => c.step).join(", ") || "nothing"}`));
  if (news.dug.length) lines.push(`${news.dug.length === 1 ? "A release you're digging for is" : `${news.dug.length} releases you're digging for are`} out:`,
    ...news.dug.map((d) => `  ${d.name} ${d.version} (${d.target}): ${d.taken ? `tests pass, on the branch ${report.branch}` : d.update!.status === "kept" || d.update!.status === "fixed" ? `tests pass${d.update!.status === "fixed" ? " with a fix" : ""}${d.note ? `, ${d.note}` : ""}` : "it breaks the tests"}`));
  const subject = news.exposed.length ? `${owner}/${repo}: a dependency is exposed` : news.fixes.length ? `${owner}/${repo}: security fixes on ${report.branch}` : news.broke.length ? `${owner}/${repo}: an update breaks the tests or its preview` : `${owner}/${repo}: ${news.dug.map((d) => `${d.name} ${d.version}`).join(", ")} is out`;
  const link = `${(env.BETTER_AUTH_URL ?? "").replace(/\/$/, "")}/#/r/${owner}/${repo}`;
  await notifierFor(env)?.(owner, subject, lines, link);
}

const notifierFor = (env: Env): Notify | null => (env.DEPS_NOTIFY as Notify | undefined) ?? (mailOn(env) ? mailNotify(env) : onDesktop(env) ? desktopNotify : null);

/** Email, to the address behind the owner's account, once it's verified. */
const mailNotify = (env: Env): Notify => async (owner, subject, lines, link) => {
  const u = await env.DB.prepare(`SELECT u.email, u."emailVerified" AS verified FROM users h JOIN "user" u ON u.id = h.auth_id WHERE h.name = ?`).bind(owner).first().catch(() => null) as { email?: string; verified?: unknown } | null;
  if (u?.email && u.verified && u.verified !== "false") await mail(env, u.email, subject, lines, link, "You get this when a dependency doctor run finds something new. Turn the doctor off on the repo's page to stop.");
};

/** A system notification: Notification Center on a Mac, notify-send on Linux. Best effort. */
const desktopNotify: Notify = async (_owner, subject, lines) => {
  const body = lines.filter((l) => l.startsWith("  ")).map((l) => l.trim()).join("; ").slice(0, 200);
  const cmd = process.platform === "darwin" ? ["osascript", "-e", `display notification ${JSON.stringify(body)} with title "codeSplitter" subtitle ${JSON.stringify(subject)}`]
    : process.platform === "linux" ? ["notify-send", "codeSplitter: " + subject, body] : null;
  if (cmd) await Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" }).exited.catch(() => {});
};

async function check(env: Env, call: Call, owner: string, repo: string, s: Settings, registry: Registry, advisories: Advisories, now: number, deadline?: number): Promise<Report> {
  const repoFiles = await readManifests(call, owner, repo);
  if ("note" in repoFiles) return { at: now, checked: 0, updates: [], note: repoFiles.note };
  const { manifests, top, read, base, fileQ } = repoFiles;

  // The registry the repo's .npmrc names, with the owner's tokens on the desktop. A test's fake registry wins.
  // Its hosts are what a container's install may reach besides npm's (#681).
  let hosts: string[] = [];
  if (registry === npmRegistry) {
    const rcs = [await homeNpmrc(env), top.includes(".npmrc") ? parseNpmrc((await read(".npmrc"))?.lines.map((l) => l.text).join("\n") ?? "") : null].filter((x): x is Npmrc => !!x);
    registry = npmrcRegistry(rcs);
    hosts = npmrcHosts(rcs);
  }
  const asked = new Map<string, ReturnType<Registry>>();
  const once: Registry = (name) => { if (!asked.has(name)) asked.set(name, registry(name)); return asked.get(name)!; };
  // A workspace's own packages are the repo's, not the registry's.
  const own = new Set([...manifests.values()].map((m) => m.pkg.name).filter(Boolean));
  // Known vulnerabilities, all manifests in one ask. If the database can't be reached, the run goes on without it.
  let note: string | undefined;
  const asks = new Map([...manifests.values()].flatMap((m) => floors(m.pkg)).filter((p) => !own.has(p.name)).map((p) => [`${p.name}@${p.version}`, p]));
  const vulns = await advisories([...asks.values()]).catch((e: Error) => { note = `couldn't check for known vulnerabilities (${e.message})`; return new Map<string, Vuln[]>(); });
  let checked = 0;
  const found: (Omit<Update, "status"> & { path: string })[] = [];
  const exposed: Exposed[] = [];
  for (const [path, m] of manifests) {
    const r = await outdated(m.pkg, { ...s, ignore: [...s.ignore, ...own] }, once, now, vulns);
    checked += r.checked;
    found.push(...r.updates.map((u) => ({ ...u, path })));
    exposed.push(...r.exposed.filter((x) => !own.has(x.name)).map((x) => ({ ...x, path })));
  }
  // 🪏 Each dig, past the level and the ignore list, since the owner named it. Only one that's out gets tried.
  const digs: Dug[] = [];
  for (const d of s.digs) {
    const at = [...manifests].find(([, m]) => typeof { ...m.pkg.dependencies, ...m.pkg.devDependencies }[d.name] === "string");
    if (!at || own.has(d.name)) { digs.push({ ...d, status: "waiting", note: "not a dependency here" }); continue; }
    const [path, m] = at, spec: string = { ...m.pkg.dependencies, ...m.pkg.devDependencies }[d.name];
    if (!range(spec)) { digs.push({ ...d, path, status: "waiting", note: `its range (${spec}) isn't one the doctor moves` }); continue; }
    const meta = await once(d.name).catch(() => null);
    const version = meta && dugVersion(spec, d.target, meta);
    if (!version) digs.push({ ...d, path, status: "waiting", ...(meta ? {} : { note: "couldn't read the registry" }) });
    else if (reached(spec, version)) digs.push({ ...d, path, version, status: "in" });
    else if (s.held.includes(`${d.name}@${version}`)) digs.push({ ...d, path, version, status: "held" });
    else digs.push({ ...d, path, version, status: "out", update: { ...digUpdate(d.name, spec, version), status: "untested", path } });
  }
  const out = digs.filter((d) => d.status === "out");
  const also = { ...(exposed.length ? { exposed } : {}), ...(digs.length ? { digs } : {}) };
  if (exposed.length) note = [note, `${exposed.length} dependenc${exposed.length === 1 ? "y has a known vulnerability" : "ies have known vulnerabilities"} no update here fixes`].filter(Boolean).join("; ");
  if (!found.length && !out.length) return { at: now, checked, updates: [], ...also, note: note ?? "everything is up to date" };

  const { pm, lock } = packageManager(top, manifests.get("package.json")!.pkg);
  const filesFor = (us: Update[]) => Object.fromEntries([...manifests].filter(([path]) => us.some((u) => (u.path ?? "package.json") === path))
    .map(([path, m]) => [path, bump(m.lines, us.filter((u) => (u.path ?? "package.json") === path)).join("\n") + "\n"]));
  let remote: string | null | undefined;
  const remoteFor = async () => {
    if (remote !== undefined) return remote;
    const h = await handleFor(env, owner, repo, true);
    const art = h && await artifactAccess(h.handle, h.remote, "read", 3600);
    return remote = art ? art.remote.replace("://", `://x:${art.token.split("?")[0]}@`) : null;
  };
  const installer = installerFor(env);
  const key = (us: Update[]) => us.map((u) => `${u.path}:${u.name}`).join(",");
  const tried = new Map<string, Awaited<ReturnType<Tester>>>();

  // Try them together, and only one by one when that breaks.
  const tester = testerFor(env, s, owner);
  let updates: Update[] = found.map((u) => ({ ...u, status: "untested" }));
  if (!tester && s.run_tests) note = [note, env.AGENT_SANDBOX ? "tests on Cloudflare are limited to this site's admins (ADMINS)" : "tests only run on the desktop app"].filter(Boolean).join("; ");
  let tested = false;
  let edits: Edit[] = [];
  const held: string[] = [];
  // With a deadline (the cron's time limit), a try only starts if there's room for one as slow as the slowest so far.
  let slowest = 0;
  const timed = async <T>(f: () => Promise<T>) => { const t0 = Date.now(); try { return await f(); } finally { slowest = Math.max(slowest, Date.now() - t0); } };
  /** These updates' files, over the fixes so far. */
  const filesWith = (us: Update[]) => ({ ...Object.fromEntries(edits.map((e) => [e.path, e.after])), ...filesFor(us) });
  const fixer = fixerFor(env, s, owner);
  const same = (a: Update, b: Update) => a.name === b.name && a.path === b.path;
  /** What goes on the branch: what passed (or, untested, didn't break), with a taken dig in place of its package's update. */
  const taking = () => {
    const dug = out.filter((d) => d.taken).map((d) => d.update!);
    return [...updates.filter((u) => (tested ? (u.status === "kept" || u.status === "fixed") : u.status !== "broke") && !dug.some((x) => same(x, u))), ...dug];
  };
  /** What `u` is tried with: what's going on the branch so far, minus anything of the same package, plus `u`. */
  const chainSet = (u: Update) => [...taking().filter((x) => x !== u && !same(x, u)), u];

  /** What a set of updates has to pass. null: it couldn't run (out of time, or over a limit). */
  type Check = (us: Update[]) => Promise<{ ok: boolean; out: string } | null>;
  /**
   * One broken update down the owner's on-fail chain, on top of what's kept and fixed so far.
   * `check` is the tests, or in the preview phase the tests and then a preview deploy. A fix
   * passes the tests in the fixer's clone, then `verify` (the preview) when there is one.
   */
  const runChain = async (u: Update, r: string, check: Check, verify?: Check) => {
    const until = Math.min(deadline ?? Infinity, Date.now() + s.chain_minutes * 60_000);
    let tries = s.chain_tries, usd = s.chain_usd;
    const chain: NonNullable<Update["chain"]> = u.chain = [];
    const set = () => chainSet(u);
    const room = () => tries > 0 && Date.now() + slowest <= until;
    const test = () => { tries--; return check(set()); };
    const settled = async (step: Step): Promise<{ ok: boolean; note?: string; usd?: number }> => {
      if (step === "retry") {
        const t = room() ? await test() : null;
        if (!t) return { ok: false, note: "out of tries or time" };
        if (t.ok) Object.assign(u, { status: "kept", out: undefined });
        else u.out = tail(t.out);
        return { ok: t.ok };
      }
      if (step === "fix" || step === "search") {
        if (!fixer) return { ok: false, note: "no AI picked to fix it" };
        if (step === "search" && s.fix_with !== "claude") return { ok: false, note: "web search needs claude" };
        if (usd <= 0) return { ok: false, note: "out of dollars" };
        if (!room()) return { ok: false, note: "out of tries or time" };
        const f = await fixer({ remote: r, files: filesWith(set()), pm, update: u, out: u.out ?? "", harness: s.fix_with!, tries: Math.min(s.fix_tries, tries), hosts, until: Number.isFinite(until) ? until : undefined, usd, ...(step === "search" ? { search: true } : {}) });
        tries -= f.tries; usd -= f.usd ?? 0;
        const by = `agent-${s.fix_with}`, spent = f.usd ? { usd: f.usd } : {};
        if (!f.ok) { Object.assign(u, { out: tail(f.out), fix: { by, tries: f.tries, files: [] } }); return { ok: false, ...spent }; }
        const had = edits;
        edits = edits.map((e) => ({ ...e }));
        for (const e of f.edits) {
          const was = edits.find((x) => x.path === e.path);
          if (was) was.after = e.after; else edits.push(e);
        }
        Object.assign(u, { status: "fixed", out: undefined, fix: { by, tries: f.tries, files: f.edits.map((e) => e.path) } });
        if (verify) {
          tries--;
          const v = await verify(set());
          if (!v?.ok) {
            edits = had;
            Object.assign(u, { status: "broke", ...(v ? { out: tail(v.out) } : {}) });
            return { ok: false, note: v ? "the fix passes the tests, not the preview" : "out of tries or time", ...spent };
          }
        }
        return { ok: true, ...spent };
      }
      if (step === "rollback") {
        // The advisory says which version is safe, so a security fix never steps back.
        if (u.fixes) return { ok: false, note: "a security fix isn't rolled back" };
        // The owner asked for this release by name.
        if (out.some((d) => d.update === u)) return { ok: false, note: "a dig isn't rolled back" };
        // A major that broke tries the newest minor, then the newest patch.
        for (const level of LEVELS.slice(0, LEVELS.indexOf(u.level)).reverse()) {
          const smaller = (await outdated({ dependencies: { [u.name]: u.from } }, { ...s, max_level: level, ignore: [], held: [...s.held, ...held] }, once, now)).updates[0];
          if (!smaller || smaller.to === u.to) continue;
          if (!room()) return { ok: false, note: "out of tries or time" };
          const was = { to: u.to, level: u.level };
          Object.assign(u, { to: smaller.to, level: smaller.level });
          const t = await test();
          if (t?.ok) { Object.assign(u, { status: "kept", out: undefined, was: was.to }); return { ok: true }; }
          Object.assign(u, was);
          if (!t) return { ok: false, note: "out of tries or time" };
        }
        return { ok: false, note: "no smaller release passes" };
      }
      // Held back: off the branch, and no later run proposes this release again.
      if (step === "hold") { held.push(`${u.name}@${u.to.replace(/^[\^~]/, "")}`); u.status = "held"; return { ok: true }; }
      // The owner hears about it once the run is over (runDoctor), once per release.
      return { ok: true };
    };
    for (const step of s.on_fail) {
      const got = await settled(step);
      chain.push({ step, ...got });
      if (got.ok) break;
    }
  };

  if (tester) {
    const r = await remoteFor();
    if (!r) note = [note, "no git remote to test against"].filter(Boolean).join("; ");
    else {
      tested = true;
      let short = false;
      const tryWith = async (us: Update[], files = filesFor(us)) => {
        if (deadline && Date.now() + slowest > deadline) { short = true; return null; }
        const t = await timed(() => tester(r, files, { pm, lock, test: true, hosts }));
        tried.set(key(us), t);
        return t;
      };
      const all = updates.length ? await tryWith(updates) : null;
      if (all?.ok) updates = updates.map((u) => ({ ...u, status: "kept" }));
      else if (all && updates.length === 1) updates = [{ ...updates[0]!, status: "broke", out: tail(all.out) }];
      else if (all) {
        for (const u of updates) { const t = await tryWith([u]); if (t) Object.assign(u, t.ok ? { status: "kept" } : { status: "broke", out: tail(t.out) }); }
        const kept = updates.filter((u) => u.status === "kept");
        const again = kept.length > 1 ? await tryWith(kept) : { ok: true };
        if (!again?.ok) for (const u of kept) u.status = "untested";
        if (again && !again.ok) {
          note = [note, "each of these passes alone but not together; nothing was put on a branch"].filter(Boolean).join("; ");
          return { at: now, checked, updates, ...also, note };
        }
      }
      if (short) note = [note, "ran out of time before every test ran; only what passed went on a branch, and the next run tries the rest"].filter(Boolean).join("; ");
      // Each broken update goes down the owner's on-fail chain in turn, on top of what's kept and fixed so far.
      const runTests: Check = (us) => timed(() => tester(r, filesWith(us), { pm, lock, test: true, hosts }));
      for (const u of updates.filter((u) => u.status === "broke")) await runChain(u, r, runTests);
      // 🪏 Each dig that's out, on top of what passes (in place of an update of the same package), then down the chain if it breaks.
      // Its fix's edits stay its own unless it's taken.
      for (const d of out) {
        const u = d.update!, before = edits;
        const t = await tryWith(chainSet(u), filesWith(chainSet(u)));
        if (!t) continue;
        if (t.ok) u.status = "kept";
        else { Object.assign(u, { status: "broke", out: tail(t.out) }); await runChain(u, r, runTests); }
        const green = u.status === "kept" || u.status === "fixed";
        if (green && d.take) {
          // Taking it waits out the minimum age, like any update; trying it didn't.
          const published = Date.parse((await once(u.name).catch(() => null))?.time[d.version!] ?? "");
          if (published <= now - s.min_age_days * 86_400_000) { d.taken = true; continue; }
          d.note = `taken once it's ${s.min_age_days} day${s.min_age_days === 1 ? "" : "s"} old`;
        }
        edits = before;
      }
    }
  }
  if (out.length && !tested) note = [note, "a dig is tried only with tests on"].filter(Boolean).join("; ");

  // Then, when the owner turned it on, what passed goes up as a preview deploy, is checked, and comes down (#864).
  const previews: NonNullable<Report["previews"]> = [];
  const runner = s.preview ? runnerFor(env) : null;
  if (s.preview && !runner) note = [note, "preview deploys run on the desktop app, with your own logins"].filter(Boolean).join("; ");
  if (runner && taking().length) {
    const r = await remoteFor();
    if (!r) note = [note, "no git remote to deploy a preview from"].filter(Boolean).join("; ");
    else {
      const { dir } = await deploySettings(env, owner, repo);
      let stopped: string | null = null;
      /** One preview of these updates' files, logged beside the owner's own previews. */
      const deploy = async (us: Update[], files: Record<string, string>) => {
        if (stopped) return null;
        if (deadline && Date.now() + slowest > deadline) { stopped = "out of time"; return null; }
        // Each counts against the owner's preview deploys, like one they started.
        const over = env.ADMINS && isAdmin(env, owner) ? null : await charge(env, "preview", `@${owner}`);
        if (over) { stopped = over; return null; }
        const id = crypto.randomUUID().slice(0, 8);
        const run: PreviewDeploy = { id, at: Date.now(), stage: `preview-${id}`, steps: PREVIEW_STEPS.map((key) => ({ key, status: "waiting", out: "" })), done: false };
        const shown = `${owner}/${repo}`;
        if (!livePreviews.get(shown) || livePreviews.get(shown)!.done) livePreviews.set(shown, run);
        await logStart(env, owner, repo, run, "agent-deps", "preview");
        await timed(() => preview(runner, r, run, { dir, files })).catch((e: Error) => { run.note = `failed: ${e.message}`; run.done = true; });
        await logEnd(env, run);
        const ok = run.steps.every((x) => x.status === "done");
        const failed = run.steps.find((x) => x.status === "failed");
        previews.push({ id, stage: run.stage, ok, names: us.map((u) => u.name), ...(run.url ? { url: run.url } : {}), ...(failed ? { failed: failed.key } : {}), ...(run.note ? { note: run.note } : {}) });
        return { ok, out: ok ? "" : `preview deploy ${run.stage}: ${failed?.key ?? "it"} failed${run.note ? ` (${run.note})` : ""}\n${tail(failed?.out ?? "")}` };
      };
      const deployAll: Check = (us) => deploy(us, filesWith(us));
      // The chain's retry and roll back have to pass the tests too, when there are any, before a deploy.
      const both: Check = async (us) => {
        if (tester) { const t = await timed(() => tester(r, filesWith(us), { pm, lock, test: true, hosts })); if (!t.ok) return t; }
        return deployAll(us);
      };
      const first = taking();
      tested = true;
      const all = await deployAll(first);
      if (!all) for (const u of first) u.status = "untested";
      else if (all.ok) { for (const u of first) if (u.status === "untested") u.status = "kept"; }
      else {
        // Which one breaks it: each alone, with its own fix if it has one.
        for (const u of first) {
          const own = new Set(u.fix?.files ?? []);
          const p = first.length === 1 ? all : await deploy([u], { ...Object.fromEntries(edits.filter((e) => own.has(e.path)).map((e) => [e.path, e.after])), ...filesFor([u]) });
          if (!p) u.status = "untested";
          else if (!p.ok) Object.assign(u, { status: "broke", out: tail(p.out) });
          else if (u.status === "untested") u.status = "kept";
        }
        for (const u of first.filter((u) => u.status === "broke")) await runChain(u, r, both, deployAll);
        // What's left goes up together once more: each passing alone doesn't make them pass together.
        const last = taking();
        const again = last.length > 1 ? await deployAll(last) : { ok: true };
        if (!again?.ok) {
          for (const u of last) u.status = "untested";
          note = [note, again ? "each of these passes a preview alone but not together; nothing was put on a branch" : "what passed alone couldn't go up together to check it; nothing was put on a branch"].filter(Boolean).join("; ");
        }
      }
      if (stopped) note = [note, `a preview deploy couldn't go (${stopped}): only what passed one went on a branch`].filter(Boolean).join("; ");
    }
  }
  if (held.length) await env.DB.prepare("UPDATE dep_watches SET held = ? WHERE owner = ? AND repo = ?").bind([...new Set([...s.held, ...held])].join(","), owner, repo).run();
  // Once tests ran, only what passed them goes on the branch.
  const take = taking();
  const shown = previews.length ? { previews } : {};
  if (!take.length) return { at: now, checked, updates, ...also, ...shown, note: [note, previews.length ? "nothing passed both the tests and a preview deploy; nothing was put on a branch" : "every update broke the tests; nothing was put on a branch"].filter(Boolean).join("; ") };

  // The lockfile to match, from the install that passed, else one made for it.
  let locked: string | undefined;
  const lockNote = (why: string) => { note = [note, `${lock} ${why}`].filter(Boolean).join("; "); };
  if (lock === "bun.lockb") lockNote("is binary, so it isn't updated here: run `bun install --save-text-lockfile` to switch to bun.lock");
  else if (lock && !installer && !tried.has(key(take))) lockNote(`isn't updated here: run \`${pm} install\` on the branch, or check from the desktop app`);
  else if (lock) {
    const r = await remoteFor();
    const t = tried.get(key(take)) ?? (r ? await installer!(r, filesFor(take), { pm, lock, test: false, hosts }) : null);
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
  if (edits.length) {
    const { merged, skipped } = await landFix(call, owner, base, branch, `agent-${s.fix_with}`, edits);
    if (merged.length) note = [note, `the fix was merged into live edits, untested together: ${merged.join(", ")}`].filter(Boolean).join("; ");
    if (skipped.length) note = [note, `left out of the fix, its live edits touch the same lines: ${skipped.join(", ")}`].filter(Boolean).join("; ");
  }
  return { at: now, checked, updates, ...also, ...shown, branch, ...(locked !== undefined ? { lock: lock! } : {}), ...(note ? { note } : {}) };
}

/**
 * The fixer's edits, on the branch as its agent. The agent worked on the last
 * commit; a file with live edits since gets the fix merged into them, line by
 * line (`merged`), unless the two touch the same lines (`skipped`).
 */
async function landFix(call: Call, owner: string, base: string, branch: string, agent: string, edits: Edit[]): Promise<{ merged: string[]; skipped: string[] }> {
  const add = await call(owner, `${base}/collaborators`, { method: "POST", body: JSON.stringify({ name: agent }) });
  if (!add.ok && add.status !== 409) throw new Error(`adding ${agent}: ${add.status}`);
  const merged: string[] = [], skipped: string[] = [];
  for (const e of edits) {
    const q = `?path=${encodeURIComponent(e.path)}&branch=${branch}`;
    if (e.before === null) {
      const r = await call(agent, `${base}/files`, { method: "POST", body: JSON.stringify({ path: e.path, content: e.after.replace(/\n$/, ""), branch }) });
      if (!r.ok) skipped.push(e.path);
      continue;
    }
    const doc = (await (await call(agent, `${base}/do/file${q}`)).json()) as Doc;
    let next = fromDisk(e.after);
    if (toDisk(doc.lines) !== e.before) {
      const m = merge3(fromDisk(e.before), doc.lines.map((l) => l.text), next);
      if (!m) { skipped.push(e.path); continue; }
      next = m;
      merged.push(e.path);
    }
    const ops = diffToOps(doc.lines, next);
    const r = ops.length && await call(agent, `${base}/do/ops${q}`, { method: "POST", body: JSON.stringify({ ops }) });
    if (r && !r.ok) throw new Error(`editing ${e.path} on ${branch}: ${r.status}`);
  }
  return { merged, skipped };
}

const tail = (s: string) => s.trim().slice(-1500);

// ---- settings, routes and the schedule ----------------------------------------

export async function settings(env: Env, owner: string, repo: string): Promise<Settings> {
  const r = await env.DB.prepare("SELECT * FROM dep_watches WHERE owner = ? AND repo = ?").bind(owner, repo).first();
  if (!r) return { ...DEFAULTS };
  const list = (v: unknown) => v ? String(v).split(",").filter(Boolean) : [];
  return {
    on: !!r.enabled, every_hours: r.every_hours, max_level: r.max_level, min_age_days: r.min_age_days, ignore: list(r.ignore), run_tests: !!r.run_tests,
    fix_with: FIX_HARNESSES.includes(r.fix_with as Harness) ? r.fix_with as Harness : null, fix_tries: r.fix_tries,
    on_fail: list(r.on_fail).filter((x): x is Step => STEPS.includes(x as Step)), chain_tries: r.chain_tries, chain_minutes: r.chain_minutes, chain_usd: r.chain_usd, held: list(r.held),
    preview: !!r.preview,
    digs: parseDigs(r.digs),
  };
}

/** The digs as stored (JSON), keeping only well-formed ones. */
function parseDigs(v: unknown): Dig[] {
  let raw: unknown;
  try { raw = JSON.parse(String(v ?? "[]")); } catch { return []; }
  return Array.isArray(raw) ? raw.flatMap((d) => digOf(d) ?? []) : [];
}

const PACKAGE = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i;
/** One dig from a request or the table: a package name, and "major", an exact version or a dist-tag. */
function digOf(d: any): Dig | null {
  const name = String(d?.name ?? "").trim(), target = String(d?.target ?? "").trim();
  if (!PACKAGE.test(name) || !(target === "major" || VERSION.test(target) || /^[a-z][\w.-]{0,39}$/i.test(target))) return null;
  return { name, target, take: !!d.take };
}

/** Repos one owner may have the doctor watching on a schedule: each costs registry lookups every cron it's due. */
export const MAX_WATCHED = 10;

/** A run beats this often while it goes (running_since moves up)... */
const BEAT = 5 * 60_000;
/** ...so one that hasn't beaten in this long died with its process, and the next one may go. */
const STALE = 20 * 60_000;

/** Mark a run as started, unless one already is. */
async function claim(env: Env, owner: string, repo: string, now = Date.now()) {
  const r = await env.DB.prepare("UPDATE dep_watches SET running_since = ? WHERE owner = ? AND repo = ? AND (running_since IS NULL OR running_since < ?)").bind(now, owner, repo, now - STALE).run();
  return !!r.meta?.changes;
}

/** Calls into the app as someone, the way agent-routes does. */
export const caller = (self: (r: Request) => Promise<Response>, origin: string): Call => (who, path, init = {}) => {
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
    return json({ settings: await settings(env, owner, repo), last_run: r.last_run, report: r.last_report ? JSON.parse(r.last_report) : null, running: !!r.running_since && r.running_since > Date.now() - STALE, can_test: !!testerAt(env, owner), can_preview: !!runnerFor(env), malicious: await hitsFor(env, owner, repo) });
  }
  if (!p[5] && req.method === "PUT") {
    const b = (await req.json()) as Partial<Settings>;
    const s = { ...(await settings(env, owner, repo)), ...b };
    if (!LEVELS.includes(s.max_level)) return json({ error: "max_level: patch, minor or major" }, 400);
    const every = Math.round(Number(s.every_hours)), age = Math.round(Number(s.min_age_days));
    if (!(every >= 6 && every <= 24 * 30)) return json({ error: "every_hours: 6 to 720" }, 400);
    if (!(age >= 0 && age <= 90)) return json({ error: "min_age_days: 0 to 90" }, 400);
    const fixWith = s.fix_with || null, tries = Math.round(Number(s.fix_tries));
    if (fixWith && !FIX_HARNESSES.includes(fixWith)) return json({ error: `fix_with: ${FIX_HARNESSES.join(", ")} or null` }, 400);
    if (!(tries >= 1 && tries <= 5)) return json({ error: "fix_tries: 1 to 5" }, 400);
    const csv = (v: unknown) => (Array.isArray(v) ? v.map(String) : String(v ?? "").split(",")).map((x) => x.trim()).filter(Boolean);
    const ignore = csv(s.ignore).join(",");
    const onFail = csv(s.on_fail);
    if (onFail.some((x) => !STEPS.includes(x as Step)) || new Set(onFail).size !== onFail.length) return json({ error: `on_fail: each of ${STEPS.join(", ")} at most once, in order` }, 400);
    const chainTries = Math.round(Number(s.chain_tries)), minutes = Math.round(Number(s.chain_minutes)), usd = Number(s.chain_usd);
    if (!(chainTries >= 1 && chainTries <= 20)) return json({ error: "chain_tries: 1 to 20" }, 400);
    if (!(minutes >= 1 && minutes <= 120)) return json({ error: "chain_minutes: 1 to 120" }, 400);
    if (!(usd >= 0 && usd <= 50)) return json({ error: "chain_usd: 0 to 50" }, 400);
    const held = csv(s.held);
    if (held.some((x) => !/^(@[^@/\s]+\/)?[^@\s]+@\d+\.\d+\.\d+(-[\w.-]+)?$/.test(x))) return json({ error: "held: name@version, comma-separated" }, 400);
    const digs = Array.isArray(s.digs) ? s.digs.map(digOf) : [null];
    if (digs.some((d) => !d) || digs.length > MAX_DIGS || new Set(digs.map((d) => d!.name)).size !== digs.length)
      return json({ error: `digs: up to ${MAX_DIGS} of {name, target: "major", a version or a dist-tag, take}, one per package` }, 400);
    if (s.on) {
      const others = await env.DB.prepare("SELECT COUNT(*) AS n FROM dep_watches WHERE owner = ? AND repo != ? AND enabled = 1").bind(owner, repo).first();
      if ((others?.n as number) >= MAX_WATCHED) return json({ error: `the doctor watches ${MAX_WATCHED} of your repos at most: turn it off on one first` }, 400);
    }
    await env.DB.prepare("UPDATE dep_watches SET enabled = ?, every_hours = ?, max_level = ?, min_age_days = ?, ignore = ?, run_tests = ?, fix_with = ?, fix_tries = ?, on_fail = ?, chain_tries = ?, chain_minutes = ?, chain_usd = ?, held = ?, preview = ?, digs = ? WHERE owner = ? AND repo = ?")
      .bind(s.on ? 1 : 0, every, s.max_level, age, ignore, s.run_tests ? 1 : 0, fixWith, tries, onFail.join(","), chainTries, minutes, Math.round(usd * 100) / 100, held.join(","), s.preview ? 1 : 0, JSON.stringify(digs), owner, repo).run();
    return json(await settings(env, owner, repo));
  }
  if (p[5] === "run" && req.method === "POST") {
    if (!(await claim(env, owner, repo))) return json({ error: "already checking" }, 409);
    const done = runDoctor(env, caller(self, url.origin), owner, repo);
    // A run that installs and tests takes minutes: answer now, and the page polls.
    // Not on Cloudflare, where work left after the response is cut off.
    if (env.AGENT_SANDBOX) return json(await done);
    if ((await settings(env, owner, repo)).run_tests && testerAt(env, owner)) { void done; return json({ running: true }, 202); }
    // One that only reads the registry is quick, unless it regenerates a lockfile.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const report = await Promise.race([done, new Promise<null>((r) => { timer = setTimeout(() => r(null), 15_000); })]);
    clearTimeout(timer);
    return report ? json(report) : json({ running: true }, 202);
  }
  return null;
}

/**
 * How long a scheduled run may test for. A cron's waitUntil gets 15 minutes of wall clock on
 * Cloudflare; this leaves room to write the branch. Repos not reached wait for the next cron.
 */
export const SCHEDULED_BUDGET = 12 * 60_000;

/** The Worker's scheduled(): every repo whose doctor is on and due gets a run, while there's time, longest waiting first so no one's repos crowd out the rest. */
export async function scheduledDoctor(env: Env, self: (r: Request) => Promise<Response>, now = Date.now(), budgetMs = SCHEDULED_BUDGET) {
  const deadline = Date.now() + budgetMs;
  const { results } = await env.DB.prepare(
    "SELECT owner, repo FROM dep_watches WHERE enabled = 1 AND (running_since IS NULL OR running_since < ?) AND (last_run IS NULL OR last_run + every_hours * 3600000 <= ?) ORDER BY COALESCE(last_run, 0)").bind(now - STALE, now + 60_000).all();
  const call = caller(self, "http://codesplitter.local");
  for (const { owner, repo } of results as { owner: string; repo: string }[]) {
    if (Date.now() >= deadline) break;
    if (await claim(env, owner, repo, now)) await runDoctor(env, call, owner, repo, { now, deadline });
  }
}
