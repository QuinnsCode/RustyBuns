// Do real apps from GitHub "just work" under Rusty Buns? Finds repos that depend on a package
// (GitHub code search over package.json), then for each one: clone, install, `rustybuns init`, and
// build + boot the desktop host in each mode, GET / with the token, and record how far it got.
//
//   bun scripts/trial-github.ts --dep rwsdk --major 1 --local --jobs 3
//   bun scripts/trial-github.ts --local owner/repo owner/monorepo:apps/web
//
//   --dep <name>      search for package.json files that depend on <name> (needs `gh` logged in)
//   --major <n>       keep only apps whose <dep> version is <n>.x
//   --limit <n>       try at most n apps (default: all found): the first n, most stars first
//   --sample <n>      try n apps spread evenly across the list: a fair picture in minutes, not hours
//   --stable          skip prerelease versions (1.0.0-beta.9, 1.3.0-canary.5): betas fail more, for the betas' own churn
//   --since <date>    keep only repos pushed to on or after this date (e.g. 2026-01-01)
//   --local           test this checkout's cli and shell-bun instead of the npm release
//   --modes spa,worker  desktop modes to try; worker swaps init's mode for the app's own Worker build
//   --jobs <n>        apps at a time at most (default 2); fewer while the machine is busy, see --persona
//   --persona <name>  the resource budget (packages/shell-bun/src/priority.ts, #955): balanced (default:
//                     60% of CPU, 50% of memory), power-user, background-beatdown, background-burner.
//                     Trials run as low priority: OS background priority for every install, build and
//                     host, and fewer apps at once while the machine stays over the budget
//   --priority <p>    low (default) or normal: normal skips the OS demotion. --prof implies normal, so
//                     its timings measure the host, not the throttle
//   --out <dir>       results.jsonl, summary.md, logs, clones (default .rustybuns-trial/, gitignored)
//   --from <file>     the apps a saved --list printed, instead of searching again (no API calls)
//   --fresh           ask GitHub again instead of <out>/gh-cache (search pages and repo meta keep a day,
//                     a package.json until its repo's pushed_at moves). A search stops before it would
//                     leave the shared core budget under 500 calls.
//   --list            print the apps a search finds (stars, last push, version) and stop
//   --keep            keep node_modules after each app (default: removed, to bound disk use)
//   --prof            time boot and 200 GETs of /, read the host's memory, and save a CPU profile per
//                     mode (logs/<app>.<mode>.cpuprofile: open it in Chrome DevTools or speedscope.app)
//
// The summary puts a ⚠️ beside an app worth a human look (scripts/trial-flags.ts): uncommon install
// scripts, network or home reads the sandbox blocked, a host busy or huge while idle, and dependencies
// OSV lists as malicious. Nothing here is published either way.
// A repo with no package.json (a GitHub Pages site) gets init first, then installs what init wrote; a
// generator this machine lacks (jekyll, hugo, mkdocs) shows as 🧰 toolchain, not a failed build.
// It runs each app's install scripts and build on this machine, with none of its logins (see ENV).
// Each app's host keeps its data in <out>/data/<app>, so nothing lands in ~ and no two apps share sqlite.
import { $ } from "bun";
import { existsSync, mkdirSync, appendFileSync, writeFileSync, rmSync, symlinkSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { parseArgs } from "node:util";
import { Cache, cacheKey, DAY, overBudget, parseRate, rateLine } from "./trial-github-cache.ts";
import { scheduler, lowPriorityCommand, PERSONAS, type Persona } from "../packages/shell-bun/src/priority.ts";
import { staticBuild, staticTool, toolchainError } from "./trial-static.ts";
import { installedPackages, ownInstallScripts, parseDenials, treeUsage, malicious, flagLines, USUAL_INSTALL, IDLE_CPU, BIG_RSS_MB, type Flags, type Idle } from "./trial-flags.ts";
import { withMode } from "../packages/cli/src/smoke.ts";
import { declaredSecrets, fakeSecret, removeCommittedSecrets } from "../packages/cli/src/fake-secrets.ts";

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    dep: { type: "string" }, major: { type: "string" }, limit: { type: "string" }, sample: { type: "string" }, since: { type: "string" }, stable: { type: "boolean" }, local: { type: "boolean" },
    modes: { type: "string", default: "spa,worker" }, jobs: { type: "string", default: "2" },
    out: { type: "string", default: ".rustybuns-trial" }, keep: { type: "boolean" }, prof: { type: "boolean" }, list: { type: "boolean" }, from: { type: "string" }, fresh: { type: "boolean" },
    persona: { type: "string", default: "balanced" }, priority: { type: "string" },
  },
});
const REPO = resolve(import.meta.dir, "..");
const OUT = resolve(o.out!);
const MODES = o.modes!.split(",") as ("spa" | "worker")[];
const VERSION = "0.1.11";
if (!(o.persona! in PERSONAS)) throw new Error(`--persona: one of ${Object.keys(PERSONAS).join(", ")}`);
const PRIORITY = (o.priority ?? (o.prof ? "normal" : "low")) as "low" | "normal";
if (PRIORITY !== "low" && PRIORITY !== "normal") throw new Error("--priority: low or normal");
const cache = new Cache(join(OUT, "gh-cache"), o.fresh);
for (const d of ["clones", "logs", "data", "sandbox"]) mkdirSync(join(OUT, d), { recursive: true });

type App = { repo: string; sub: string; version?: string; stars?: number; pushed?: string };
type Prof = { bootMs: number; p50: number; p95: number; max: number; rssMb: number; profile?: string };
type ModeResult = { stage: string; status?: number; bytes?: number; text?: string; error?: string; prof?: Prof; idle?: Idle };
type Result = App & { fakeSecrets?: string[]; traits?: string[]; pm?: string; init?: string; error?: string; flags?: Flags; modes: Record<string, ModeResult> };

/** The version range an app's package.json gives <dep>, or undefined. */
export function depVersion(pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }, dep: string) {
  return pkg.dependencies?.[dep] ?? pkg.devDependencies?.[dep];
}
/** "^1.7.0", "1.0.0-beta.9", "~1.2" are major 1; "workspace:*", "latest", "0.0.88" are not. */
export const isMajor = (range: string, major: string) => new RegExp(`^[\\^~=v]?${major}\\.`).test(range.trim());

const rate = async () => parseRate(await $`gh api rate_limit`.quiet().nothrow().text()); // free: rate_limit doesn't count

type Meta = { stars: number; archived: boolean; pushed: string; pushedAt: string };
type Deps = { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null;

/** Repos depending on <dep>. Everything it asks GitHub is cached under <out>/gh-cache (see trial-github-cache.ts),
 *  so a rerun costs a few calls, not thousands; --fresh asks again. */
async function search(dep: string): Promise<App[]> {
  const before = await rate();
  console.log(before ? rateLine(before) : "could not read gh api rate_limit: no budget check this run");
  const q = `"${dep}" filename:package.json`;
  const hits = new Map<string, App>();
  for (let page = 1; page <= 10; page++) {
    const key = cacheKey("search", q, page);
    let items = cache.get<{ path: string; repo: string; fork: boolean }[]>(key, DAY);
    if (!items) {
      const r = await $`gh api -X GET search/code -f q=${q} -f per_page=100 -f page=${page}`.quiet().nothrow();
      if (r.exitCode) { console.error(`search page ${page}: ${r.stderr.toString().trim().split("\n").at(-1)}`); break; }
      items = (JSON.parse(r.stdout.toString()).items as { path: string; repository: { full_name: string; fork: boolean } }[])
        .map((it) => ({ path: it.path, repo: it.repository.full_name, fork: it.repository.fork }));
      cache.set(key, items);
      if (items.length === 100) await Bun.sleep(7000); // code search allows 10 requests a minute
    }
    for (const it of items) if (it.path.endsWith("package.json") && !it.fork) {
      const sub = dirname(it.path) === "." ? "" : dirname(it.path);
      hits.set(`${it.repo}:${sub}`, { repo: it.repo, sub });
    }
    if (items.length < 100) break;
  }
  const metaKey = (repo: string) => cacheKey("meta", repo);
  const pkgKey = (a: App, m: Meta) => cacheKey("pkg", a.repo, a.sub, m.pushedAt);
  // Before spending any: what the uncached lookups cost, against what's left for everyone else.
  const repos = new Set([...hits.values()].map((a) => a.repo));
  let needed = [...repos].filter((r) => !cache.get(metaKey(r), DAY)).length;
  for (const a of hits.values()) { const m = cache.get<Meta>(metaKey(a.repo), DAY); if (!m || (!m.archived && cache.get(pkgKey(a, m)) === undefined)) needed++; }
  console.log(`${hits.size} hits in ${repos.size} repos, ${needed} uncached GitHub calls`);
  if (before && needed) {
    const over = overBudget(before.core, needed);
    if (over) { console.error(over); process.exit(1); }
  }
  const meta = new Map<string, Promise<Meta>>();
  const repoMeta = (repo: string) => meta.get(repo) ?? meta.set(repo, (async () => {
    const hit = cache.get<Meta>(metaKey(repo), DAY);
    if (hit) return hit;
    const r = await $`gh api repos/${repo} --jq ${"[.stargazers_count,.archived,.pushed_at]"}`.quiet().nothrow();
    let parsed: unknown; try { parsed = JSON.parse(r.stdout.toString()); } catch {}
    if (r.exitCode || !Array.isArray(parsed)) return { stars: 0, archived: true, pushed: "", pushedAt: "" }; // not cached: ask again next run
    const [stars, archived, pushedAt] = parsed;
    const m: Meta = { stars, archived, pushed: String(pushedAt).slice(0, 10), pushedAt: String(pushedAt) };
    cache.set(metaKey(repo), m);
    return m;
  })()).get(repo)!;
  const apps: App[] = [];
  // 8 at a time: GitHub's secondary rate limit answers a burst with an error body, not data
  const queue = [...hits.values()];
  await Promise.all(Array.from({ length: 8 }, async () => { for (let a; (a = queue.shift()); ) await (async (a: App) => {
    const m = await repoMeta(a.repo);
    if (m.archived || (o.since && m.pushed < o.since)) return;
    let pkg = cache.get<Deps>(pkgKey(a, m));
    if (pkg === undefined) {
      const r = await $`gh api repos/${a.repo}/contents/${a.sub ? `${a.sub}/` : ""}package.json -H ${"Accept: application/vnd.github.raw"}`.quiet().nothrow();
      if (r.exitCode) return; // a 404 or a rate-limit answer: not cached, ask again next run
      try { const j = JSON.parse(r.stdout.toString()); pkg = { dependencies: j.dependencies, devDependencies: j.devDependencies }; } catch { pkg = null; }
      cache.set(pkgKey(a, m), pkg);
    }
    const v = pkg ? depVersion(pkg, dep) : undefined;
    if (!v || (o.major && !isMajor(v, o.major)) || (o.stable && /\d-[a-z]/i.test(v))) return;
    apps.push({ ...a, version: v, stars: m.stars, pushed: m.pushed });
  })(a); }));
  const after = await rate();
  if (after) console.log(rateLine(after));
  return apps.sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0) || a.repo.localeCompare(b.repo));
}

// Strangers' scripts run with none of this machine's logins. A release script can say
// `wrangler d1 migrations apply --remote` or `wrangler deploy`, and with the owner's wrangler
// login that reaches their real account (the RWSDK sweep saw it, stopped only by a placeholder
// database id). So HOME is an empty dir (no ~/.wrangler, ~/.alchemy, ~/.config/gh, ~/.npmrc,
// ~/.aws, git credentials), Cloudflare's variables hold dead values, and only the package
// caches point back at the real ones so installs stay fast.
const SANDBOX_HOME = join(OUT, "home");
mkdirSync(SANDBOX_HOME, { recursive: true });
const realHome = process.env.HOME ?? "";
const ENV: Record<string, string | undefined> = {
  PATH: process.env.PATH, TERM: process.env.TERM, LANG: process.env.LANG, TMPDIR: process.env.TMPDIR, USER: process.env.USER,
  HOME: SANDBOX_HOME, XDG_CONFIG_HOME: join(SANDBOX_HOME, ".config"), GH_CONFIG_DIR: join(SANDBOX_HOME, ".config/gh"),
  CLOUDFLARE_API_TOKEN: "rustybuns-trial-has-no-credentials", CLOUDFLARE_ACCOUNT_ID: "rustybuns-trial-no-account",
  WRANGLER_SEND_METRICS: "false", GIT_TERMINAL_PROMPT: "0",
  // macOS's git config hands credentials to the keychain, and this HOME has none: a 401 would pop
  // "Keychain Not Found" on screen. An empty helper clears the list.
  GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "credential.helper", GIT_CONFIG_VALUE_0: "",
  npm_config_cache: join(realHome, ".npm"), npm_config_store_dir: join(realHome, "Library/pnpm/store"),
  BUN_INSTALL_CACHE_DIR: join(realHome, ".bun/install/cache"),
  CI: "1", RUSTYBUNS_NO_UPDATE_CHECK: "1", RB_NO_BROWSER: "1",
};
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
/** The last lines of a failed step's output worth reading: no stack frames. */
const tail = (s: string) => strip(s).trim().split("\n").filter((l) => !/^\s+at /.test(l) && !/^Bun v\d/.test(l) && l.trim()).slice(-4).join("\n");

// On macOS the OS enforces the rest (sandbox-exec). Every app command: no reads or writes under
// the real home except the toolchains and package caches it needs (so no ~/.ssh, keychains,
// ~/.wrangler). After install: no network but localhost, so a build or a booted server can't send
// anything out or reach anyone's real service. Install keeps the network: packages come from registries.
// Each app's profile tags its denials with `rbtrial:<app>;`, so the unified log says which app tried what.
type Net = "net" | "offline";
const SANDBOXED = process.platform === "darwin" && !!Bun.which("sandbox-exec");
const PROFILES = new Map<string, string>();
function profile(net: Net, tag: string): string | undefined {
  if (!SANDBOXED) return undefined;
  const key = `${net}:${tag}`;
  if (PROFILES.has(key)) return PROFILES.get(key);
  const ok = [join(realHome, ".bun"), join(realHome, ".nvm"), join(realHome, ".npm"), join(realHome, "Library/pnpm"), REPO, OUT];
  const msg = tag ? ` (with message ${JSON.stringify(tag)})` : "";
  const sb = [
    "(version 1)", "(allow default)",
    `(deny file-read* file-write* (subpath ${JSON.stringify(realHome)})${msg})`,
    // later rules win: these stay reachable
    ...ok.map((p) => `(allow file-read* file-write* (subpath ${JSON.stringify(p)}))`),
    `(allow file-read* (literal ${JSON.stringify(realHome)}))`,
    ...(net === "offline" ? [`(deny network-outbound${msg})`, '(allow network-outbound (remote ip "localhost:*"))', "(allow network-outbound (remote unix-socket))"] : []),
  ].join("\n");
  const f = join(OUT, "sandbox", `${tag.replace(/\W+/g, "_") || "harness"}-${net}.sb`);
  writeFileSync(f, sb + "\n");
  PROFILES.set(key, f);
  return f;
}
const sandboxed = (cmd: string[], net: Net, tag = "") => {
  const f = profile(net, tag), boxed = f ? ["sandbox-exec", "-f", f, ...cmd] : cmd;
  return PRIORITY === "low" ? lowPriorityCommand(boxed) : boxed;
};

/** What the sandbox denied an app since `since`, from the unified log; undefined off macOS. */
async function denials(tag: string, since: Date) {
  if (!SANDBOXED) return undefined;
  await Bun.sleep(1000); // the log lags a little
  const at = new Date(since.getTime() - since.getTimezoneOffset() * 6e4).toISOString().slice(0, 19).replace("T", " ");
  const r = await $`/usr/bin/log show --style ndjson --start ${at} --predicate ${`sender == "Sandbox" AND eventMessage CONTAINS "${tag}"`}`.quiet().nothrow();
  return r.exitCode ? undefined : parseDenials(r.stdout.toString(), tag);
}

async function step(log: string, cwd: string, cmd: string[], ms: number, net: Net = "offline", fakes: Record<string, string> = {}, tag = "") {
  const p = Bun.spawn(sandboxed(cmd, net, tag), { cwd, stdout: "pipe", stderr: "pipe", env: { ...fakes, ...ENV } });
  const t = setTimeout(() => p.kill(), ms);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited; clearTimeout(t);
  appendFileSync(log, `\n$ ${cmd.join(" ")}  (exit ${code})\n${out}\n${err}\n`);
  return { ok: code === 0, out, tail: tail(err.trim() ? err : out) };
}

/** Walks up from the app to the clone root for the lockfile that says which package manager installs it. */
function packageManager(dir: string, root: string): { pm: string; at: string } {
  for (let d = dir; d.startsWith(root); d = dirname(d)) {
    for (const [f, pm] of [["pnpm-lock.yaml", "pnpm"], ["bun.lock", "bun"], ["bun.lockb", "bun"], ["yarn.lock", "yarn"], ["package-lock.json", "npm"]] as const)
      if (existsSync(join(d, f))) return { pm, at: d };
    if (d === root) break;
  }
  // no lockfile: pnpm, as RWSDK's starters use. npm 10 fails 41 of 42 such apps (ERESOLVE, an edgesOut crash).
  return { pm: "pnpm", at: dir };
}

/** Boots the dev host, logs in with the printed token like a browser does, and GETs /. */
async function boot(dir: string, log: string, tag: string, profName?: string, fakes: Record<string, string> = {}): Promise<ModeResult> {
  const prof = profName ? ["--cpu-prof", `--cpu-prof-dir=${join(OUT, "logs")}`, `--cpu-prof-name=${profName}.cpuprofile`] : [];
  const t0 = performance.now();
  const host = Bun.spawn(sandboxed(["bun", ...prof, ".rustybuns/dev/desktop.js"], "offline", tag), { cwd: dir, stdout: "pipe", stderr: "pipe", env: { ...fakes, ...ENV } });
  let buf = "";
  for (const s of [host.stdout, host.stderr]) void (async () => { for await (const c of s) buf += new TextDecoder().decode(c); })();
  try {
    let url: string | undefined;
    for (let i = 0; i < 240 && !url && host.exitCode === null; i++) { await Bun.sleep(250); url = buf.match(/https?:\/\/\S+token=[\w-]+/)?.[0]; }
    if (!url) return { stage: "boot", error: tail(buf) || "no token URL within 60s" };
    const cookie = ((await fetch(url, { redirect: "manual" })).headers.get("set-cookie") ?? "").split(";")[0]!;
    const r = await fetch(new URL("/", url), { headers: { cookie }, redirect: "manual" });
    const html = await r.text();
    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const bootMs = Math.round(performance.now() - t0);
    const res: ModeResult = { stage: r.status < 400 ? "works" : "request", status: r.status, bytes: html.length, text: text.slice(0, 160) };
    // A served host should then sit idle: CPU over two quiet seconds and memory, its children included (a miner).
    const usage = async () => treeUsage(await $`ps -A -o pid=,ppid=,time=,rss=`.quiet().nothrow().text(), host.pid);
    const a = await usage(); await Bun.sleep(2000); const b = await usage();
    res.idle = { cpu: Math.round(((b.cpu - a.cpu) / 2) * 100) / 100, rssMb: b.rssMb };
    if (profName && r.status < 400) {
      const times: number[] = [];
      for (let i = 0; i < 200; i++) { const a = performance.now(); await (await fetch(new URL("/", url), { headers: { cookie } })).text(); times.push(performance.now() - a); }
      times.sort((a, b) => a - b);
      const rssMb = Math.round(Number((await $`ps -o rss= -p ${host.pid}`.quiet().nothrow().text()).trim()) / 1024);
      const ms = (n: number) => Math.round(n * 100) / 100;
      res.prof = { bootMs, p50: ms(times[100]!), p95: ms(times[190]!), max: ms(times.at(-1)!), rssMb, profile: join(OUT, "logs", `${profName}.cpuprofile`) };
    }
    return res;
  } finally {
    Bun.spawnSync(["pkill", "-P", String(host.pid)]); host.kill(profName ? "SIGINT" : "SIGTERM"); await host.exited;
    appendFileSync(log, `\n[host]\n${buf.replace(/token=[\w-]+/g, "token=<redacted>")}\n`);
  }
}

async function trial(app: App): Promise<Result> {
  const slug = `${app.repo.replace("/", "__")}${app.sub ? `__${app.sub.replace(/\//g, "_")}` : ""}`;
  const log = join(OUT, "logs", `${slug}.log`);
  writeFileSync(log, "");
  const tag = `rbtrial:${slug};`, since = new Date();
  const r = await trialSteps(app, slug, log, tag);
  const d = await denials(tag, since);
  if (d) {
    if (d.net.length || d.reads.length) r.flags = { ...r.flags, ...(d.net.length ? { network: d.net } : {}), ...(d.reads.length ? { reads: d.reads } : {}) };
    appendFileSync(log, `\nsandbox denials: ${[...d.net, ...d.reads].join("\n  ") || "none flagged"}${d.other ? ` (+${d.other} other reads under home)` : ""}\n`);
  }
  const idle = Object.entries(r.modes).filter(([, m]) => m.idle && (m.idle.cpu >= IDLE_CPU || m.idle.rssMb >= BIG_RSS_MB))
    .map(([mode, m]) => `${mode} ${Math.round(m.idle!.cpu * 100)}% CPU, ${m.idle!.rssMb} MB`);
  if (idle.length) r.flags = { ...r.flags, idle };
  return r;
}

/** After an install: which packages run install scripts, and whether OSV lists any as malicious. */
async function installFlags(dirs: string[], log: string): Promise<Flags> {
  const pkgs = [...new Map(dirs.flatMap(installedPackages).map((p) => [`${p.name}@${p.version}`, p])).values()];
  const scripted = pkgs.filter((p) => p.scripts.length);
  if (scripted.length) appendFileSync(log, `\ninstall scripts: ${scripted.map((p) => `${p.name}@${p.version} (${p.scripts.join(", ")})`).join(" ")}\n`);
  const own = ownInstallScripts(dirs[0]!).map((s) => `the app's ${s}`);
  const f: Flags = {};
  const odd = [...own, ...scripted.filter((p) => !USUAL_INSTALL.has(p.name)).map((p) => p.name)];
  if (odd.length) f.installScripts = [...new Set(odd)];
  await malicious(pkgs).then((m) => { if (m.length) f.malicious = m; }, (e: Error) => { f.osvError = e.message; appendFileSync(log, `\nosv.dev: ${e.message}\n`); });
  return f;
}

async function trialSteps(app: App, slug: string, log: string, tag: string): Promise<Result> {
  const root = join(OUT, "clones", app.repo.replace("/", "__"));
  const dir = join(root, app.sub);
  const r: Result = { ...app, modes: {} };
  if (!existsSync(root)) {
    const s = await step(log, OUT, ["git", "clone", "--depth", "1", `https://github.com/${app.repo}`, root], 180e3, "net");
    if (!s.ok) return { ...r, error: `clone: ${s.tail}` };
  }
  // Some repos commit their real secrets (.env with a production DATABASE_URL, .dev.vars). Nothing
  // here may use them: they go before any of the app's code runs. Examples and templates stay.
  const removed = removeCommittedSecrets(root);
  if (removed.length) appendFileSync(log, `\nremoved committed secrets files: ${removed.join(", ")}\n`);
  // In their place, fakes for every secret the app declares or reads, so a missing key doesn't stop it
  // booting: .env (Vite, dotenv), .dev.vars (Workers, init's secret bindings), and the process itself.
  const fakes: Record<string, string> = {};
  for (const n of declaredSecrets(dir)) { const v = fakeSecret(n); if (v) fakes[n] = v; }
  if (Object.keys(fakes).length) {
    const lines = Object.entries(fakes).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
    writeFileSync(join(dir, ".env"), lines);
    writeFileSync(join(dir, ".dev.vars"), lines);
    r.fakeSecrets = Object.keys(fakes);
    appendFileSync(log, `\nfake secrets: ${Object.keys(fakes).join(" ")}\n`);
  }
  r.traits = traits(dir, root);
  let { pm, at } = packageManager(dir, root);
  // A site with no package.json (a GitHub Pages repo): init boxes it and writes a package.json holding
  // Rusty Buns, so init goes first and install then fetches what it wrote.
  const noPkg = !existsSync(join(dir, "package.json"));
  const local = ["bun", join(REPO, "packages/cli/src/index.ts")];
  let s: Awaited<ReturnType<typeof step>> | undefined, initOut = "";
  if (noPkg) {
    s = await step(log, dir, [...(o.local ? local : ["bunx", `@rustybuns/cli@${VERSION}`]), "init", "--force"], 120e3, o.local ? "offline" : "net", fakes, tag);
    if (!s.ok) return { ...r, error: `init: ${s.tail}` };
    initOut = s.out;
    if (o.local) {
      // this checkout's packages may be ahead of npm: they're linked below instead
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      for (const p of ["cli", "shell-bun"]) delete pkg.devDependencies?.[`@rustybuns/${p}`];
      writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
    }
  }
  s = await step(log, at, pm === "yarn" ? ["npx", "-y", "yarn@1", "install"] : pm === "pnpm" ? ["pnpm", "install", "--config.minimum-release-age=0"] : [pm, "install"], 600e3, "net", {}, tag);
  // an npm lockfile that npm itself can't install (peer conflicts): pnpm reads package.json alone
  if (!s.ok && pm === "npm") { pm = "pnpm"; s = await step(log, at, ["pnpm", "install", "--config.minimum-release-age=0"], 600e3, "net", {}, tag); }
  r.pm = pm;
  // what ran during install (or tried to): even a failed install ran scripts
  r.flags = await installFlags([dir, at], log);
  if (!s.ok) return { ...r, error: `install: ${s.tail}` };
  const cli = o.local ? local : [join(dir, "node_modules/.bin/rustybuns")];
  if (o.local) {
    // the app resolves @rustybuns/* (its config imports @rustybuns/cli/config) to this checkout,
    // and the bin too: a plain-HTML site's build runs `rustybuns copy-site`
    mkdirSync(join(dir, "node_modules/@rustybuns"), { recursive: true });
    for (const p of ["cli", "shell-bun"]) { rmSync(join(dir, "node_modules/@rustybuns", p), { recursive: true, force: true }); symlinkSync(join(REPO, "packages", p), join(dir, "node_modules/@rustybuns", p)); }
    mkdirSync(join(dir, "node_modules/.bin"), { recursive: true });
    rmSync(join(dir, "node_modules/.bin/rustybuns"), { force: true });
    symlinkSync(join(REPO, "packages/cli/src/index.ts"), join(dir, "node_modules/.bin/rustybuns"));
  } else if (!noPkg) {
    const add = pm === "npm" ? ["npm", "i", "-D"] : [pm, "add", "-D", ...(pm === "pnpm" ? ["--config.minimum-release-age=0"] : [])];
    s = await step(log, dir, [...add, `@rustybuns/cli@${VERSION}`, `@rustybuns/shell-bun@${VERSION}`], 300e3, "net", {}, tag);
    if (!s.ok) return { ...r, error: `add rustybuns: ${s.tail}` };
  }
  if (!noPkg) {
    s = await step(log, dir, [...cli, "init", "--force"], 120e3, "offline", fakes, tag);
    if (!s.ok) return { ...r, error: `init: ${s.tail}` };
    initOut = s.out;
  }
  r.init = strip(initOut).match(/^detected: (.*)$/m)?.[1];
  const initCfg = readFileSync(join(dir, "rustybuns.config.ts"), "utf8");
  const initMode = initCfg.match(/"mode": "(\w+)"/)?.[1];
  // a static site's build is the generator's: `add desktop` would scaffold a React UI over the site
  const site = staticBuild(initCfg), tool = site && staticTool(site);
  if (site) r.traits.push("static");
  for (const mode of MODES) {
    if (mode === "worker" && !/"builtMain"/.test(initCfg)) { r.modes[mode] = { stage: "skipped", error: "init found no Worker build" }; continue; }
    // init chose worker itself (TanStack Start's server, Astro's adapter): there is no SPA to try
    if (mode === "spa" && initMode === "worker") { r.modes[mode] = { stage: "skipped", error: "init chose worker mode" }; continue; }
    // Jekyll, Hugo, MkDocs come from outside npm: this machine lacking one says nothing about the site
    if (tool && !Bun.which(tool, { PATH: ENV.PATH })) { r.modes[mode] = { stage: "toolchain", error: `${tool} is not on PATH` }; continue; }
    writeFileSync(join(dir, "rustybuns.config.ts"), withMode(initCfg, mode, join(OUT, "data", slug, mode)));
    appendFileSync(log, `\n===== mode ${mode} =====\n`);
    if (mode === "spa" && initMode === "spa" && !site && !existsSync(join(dir, "vite.desktop.config.ts"))) {
      s = await step(log, dir, [...cli, "add", "desktop"], 300e3, "offline", fakes, tag);
      if (!s.ok) { r.modes[mode] = { stage: "add desktop", error: s.tail }; continue; }
    }
    s = await step(log, dir, [...cli, "build", "desktop", "--dev"], 600e3, "offline", fakes, tag);
    r.modes[mode] = s.ok ? await boot(dir, log, tag, o.prof ? `${slug}.${mode}` : undefined, fakes) : { stage: site && toolchainError(s.tail) ? "toolchain" : "build", error: s.tail };
  }
  if (!o.keep) for (const d of new Set([dir, at])) rmSync(join(d, "node_modules"), { recursive: true, force: true });
  return r;
}

/** n apps across kinds, not just the long tail of small ones: big and other monorepo apps, popular,
 *  mid and unstarred standalone apps, an equal share each, spread within each kind. A short kind's
 *  unused share goes to the others. */
export function stratified<T extends { sub: string; stars?: number }>(apps: T[], n: number): T[] {
  const kinds: ((a: T) => boolean)[] = [
    (a) => !!a.sub && (a.stars ?? 0) >= 20, (a) => !!a.sub && (a.stars ?? 0) < 20,
    (a) => !a.sub && (a.stars ?? 0) >= 10, (a) => !a.sub && (a.stars ?? 0) >= 1 && (a.stars ?? 0) < 10, (a) => !a.sub && !(a.stars ?? 0),
  ];
  const groups = kinds.map((k) => apps.filter(k));
  const take = groups.map(() => 0);
  for (let left = n; left > 0;) {
    const open = groups.map((g, i) => i).filter((i) => take[i]! < groups[i]!.length);
    if (!open.length) break;
    for (const i of open) if (left > 0) { take[i]!++; left--; }
  }
  return groups.flatMap((g, i) => { const k = take[i]!, step = g.length / Math.max(k, 1); return Array.from({ length: k }, (_, j) => g[Math.floor(j * step + step / 2)]!); });
}

/** What kind of app it is, read from its package.json and Vite config: deploy target, auth, database, monorepo. */
export function traits(dir: string, root: string): string[] {
  const read = (f: string) => { try { return readFileSync(join(dir, f), "utf8"); } catch { return ""; } };
  const pkg = (() => { try { return JSON.parse(read("package.json")); } catch { return {}; } })();
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).join(" ");
  const vite = ["vite.config.ts", "vite.config.mts", "vite.config.js", "app.config.ts"].map(read).join("\n");
  const has = (re: RegExp) => re.test(deps);
  const t: string[] = [];
  const preset = vite.match(/\bpreset\s*:\s*["']([\w-]+)["']/)?.[1];
  t.push(/cloudflare\(/.test(vite) || existsSync(join(dir, "wrangler.jsonc")) || existsSync(join(dir, "wrangler.toml")) ? "cloudflare"
    : preset ? preset : /\bnitro\(/.test(vite) ? "node" : /netlify/.test(deps + vite) ? "netlify" : /vercel/.test(deps + vite) ? "vercel" : "start-only");
  if (has(/@clerk\//)) t.push("clerk"); if (has(/\bbetter-auth\b/)) t.push("better-auth"); if (has(/next-auth|@auth\//)) t.push("authjs");
  if (has(/@supabase\//)) t.push("supabase"); if (has(/\bconvex\b/)) t.push("convex");
  if (has(/@prisma\/client|\bprisma\b/)) t.push("prisma"); if (has(/drizzle-orm/)) t.push("drizzle"); if (has(/@neondatabase|\bpostgres\b|\bpg\b/)) t.push("postgres");
  if (dir !== root) t.push("monorepo");
  return t;
}

// toolchain: a static site's generator (jekyll, hugo, mkdocs) missing here, not a failure of the site or of Rusty Buns
const cell = (m?: ModeResult) => !m ? "" : m.stage === "works" ? `✅ ${m.status}` : m.stage === "skipped" ? "—" : m.stage === "toolchain" ? "🧰 toolchain" : `❌ ${m.stage}`;
const note = (r: Result) => (r.error ?? Object.values(r.modes).find((m) => m.error)?.error ?? "").split("\n").at(-1)!.replace(/\|/g, "\\|").replace(/\/[^\s"']*\/(clones|node_modules)\//g, "…/").slice(0, 140);
/** Pass rates by trait (deploy target, auth, database, monorepo): which kinds of app lag. */
function byTrait(rs: Result[]): string[] {
  const names = [...new Set(rs.flatMap((r) => r.traits ?? []))].sort();
  if (!names.length) return [];
  const works = (r: Result) => MODES.some((m) => r.modes[m]?.stage === "works");
  return ["", "## By kind of app", "", "| trait | apps | install | serve / |", "|---|---|---|---|",
    ...names.map((t) => { const b = rs.filter((r) => r.traits?.includes(t)); const i = b.filter((r) => !r.error);
      return `| ${t} | ${b.length} | ${i.length} | ${b.filter(works).length} of ${i.length} |`; })];
}

/** The apps worth a human look, and why: what they ran at install, what the sandbox stopped, what OSV knows. */
function flagged(rs: Result[]): string[] {
  const f = rs.filter((r) => flagLines(r.flags).length);
  if (!f.length) return [];
  return ["", "## ⚠️ Worth a look", "", "Containment, not detection: these ran with no logins, no home and no network after install. Logs have the detail.", "",
    ...f.flatMap((r) => [`- **${r.repo}${r.sub ? `:${r.sub}` : ""}**`, ...flagLines(r.flags).map((l) => `  - ${l.replace(/\|/g, "\\|")}`)])];
}

/** Pass rates by how long ago the repo was last pushed to: is a failure Rusty Buns, or an abandoned app? */
function freshness(rs: Result[]): string[] {
  const dated = rs.filter((r) => r.pushed);
  if (!dated.length) return [];
  const age = (r: Result) => (Date.now() - Date.parse(r.pushed!)) / 864e5;
  const buckets = [["under 3 months", 0, 91], ["3 to 12 months", 91, 365], ["over a year", 365, Infinity]] as const;
  return ["", "## By last push", "", `| last push | apps | install | ${MODES.join(" | ")} |`, `|---|---|---|${MODES.map(() => "---|").join("")}`,
    ...buckets.map(([name, lo, hi]) => {
      const b = dated.filter((r) => age(r) >= lo && age(r) < hi);
      const pct = (n: number) => (b.length ? `${n} (${Math.round((n / b.length) * 100)}%)` : "0");
      return `| ${name} | ${b.length} | ${pct(b.filter((r) => !r.error).length)} | ${MODES.map((m) => pct(b.filter((r) => r.modes[m]?.stage === "works").length)).join(" | ")} |`;
    })];
}

function summary(rs: Result[]) {
  const ok = (mode: string) => rs.filter((r) => r.modes[mode]?.stage === "works").length;
  return [`# trial-github: ${rs.length} apps${o.dep ? ` depending on ${o.dep}${o.major ? ` ${o.major}.x` : ""}` : ""} (${o.local ? "this checkout" : `@rustybuns ${VERSION}`})`, "",
    MODES.map((m) => `${m}: ${ok(m)}/${rs.length} serve /`).join(" · "), "",
    `| app | version | ⚠️ | ${MODES.join(" | ")} | first error |`, `|---|---|---|${MODES.map(() => "---|").join("")}---|`,
    ...rs.map((r) => `| [${r.repo}${r.sub ? `:${r.sub}` : ""}](https://github.com/${r.repo}${r.sub ? `/tree/HEAD/${r.sub}` : ""}) | ${r.version ?? ""} | ${flagLines(r.flags).length ? "⚠️" : ""} | ${MODES.map((m) => cell(r.modes[m]) || (r.error ? `❌ ${r.error.split(":")[0]}` : "")).join(" | ")} | ${note(r)} |`),
    ...flagged(rs), ...freshness(rs), ...byTrait(rs),
    ...(o.prof ? ["", "## Perf (dev host, this machine)", "", "Boot is spawn to the first page; latency is 200 sequential GETs of /.", "",
      "| app | mode | boot | p50 | p95 | max | rss | page |", "|---|---|---|---|---|---|---|---|",
      ...rs.flatMap((r) => Object.entries(r.modes).filter(([, m]) => m.prof).map(([mode, m]) =>
        `| ${r.repo}${r.sub ? `:${r.sub}` : ""} | ${mode} | ${m.prof!.bootMs} ms | ${m.prof!.p50} ms | ${m.prof!.p95} ms | ${m.prof!.max} ms | ${m.prof!.rssMb} MB | ${Math.round(m.bytes! / 1024)} KB |`))] : []),
  ].join("\n") + "\n";
}

if (import.meta.main) {
  let apps: App[] = positionals.map((p) => { const [repo, sub = ""] = p.split(":"); return { repo: repo!, sub }; });
  if (o.from) for (const line of readFileSync(o.from, "utf8").split("\n")) {
    const m = line.match(/^\s*(\d*)\s+(\d{4}-\d\d-\d\d)?\s+(\S+)\s+([\w.-]+\/[\w.-]+)(?::(\S+))?\s*$/);
    if (!m || (o.since && m[2]! < o.since)) continue;
    apps.push({ repo: m[4]!, sub: m[5] ?? "", stars: Number(m[1]) || 0, pushed: m[2], version: m[3] });
  }
  if (o.dep && !o.from) apps.push(...await search(o.dep));
  if (!apps.length) throw new Error("usage: bun scripts/trial-github.ts [--dep <name> [--major <n>]] [owner/repo[:subdir] ...]");
  if (o.limit) apps = apps.slice(0, Number(o.limit));
  if (o.sample && Number(o.sample) < apps.length) apps = stratified(apps, Number(o.sample));
  if (o.list) {
    for (const a of apps) console.log(`${String(a.stars ?? "").padStart(6)}  ${a.pushed ?? "          "}  ${(a.version ?? "").padEnd(16)}  ${a.repo}${a.sub ? `:${a.sub}` : ""}`);
    console.log(`${apps.length} apps`);
    process.exit(0);
  }
  const sched = scheduler({ persona: o.persona as Persona, max: Number(o.jobs), log: (l) => console.log(l) });
  console.log(`trying ${apps.length} apps, up to ${sched.stats().slots} at a time (${o.persona}, ${PRIORITY} priority), modes ${MODES.join(",")}; results in ${OUT}`);
  const results: Result[] = [];
  // One worker per repo at a time: apps in the same clone would install over each other.
  const groups = [...Map.groupBy(apps, (a) => a.repo).values()];
  await Promise.all(Array.from({ length: sched.stats().slots }, async () => {
    for (let group; (group = groups.shift()); ) for (const app of group) {
      const r = await sched.run(PRIORITY, () => trial(app)).catch((e): Result => ({ ...app, error: String(e), modes: {} }));
      results.push(r);
      appendFileSync(join(OUT, "results.jsonl"), JSON.stringify(r) + "\n");
      console.log(`[${results.length}/${apps.length}] ${r.repo}${r.sub ? `:${r.sub}` : ""}  ${MODES.map((m) => `${m} ${cell(r.modes[m]) || "❌"}`).join("  ")}${flagLines(r.flags).length ? "  ⚠️" : ""}  ${note(r)}`);
    }
  }));
  const order = new Map(apps.map((a, i) => [`${a.repo}:${a.sub}`, i]));
  results.sort((a, b) => order.get(`${a.repo}:${a.sub}`)! - order.get(`${b.repo}:${b.sub}`)!);
  sched.stop();
  writeFileSync(join(OUT, "summary.md"), summary(results));
  console.log(`\n${join(OUT, "summary.md")}`);
}
