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
//   --jobs <n>        apps at a time (default 2)
//   --out <dir>       results.jsonl, summary.md, logs, clones (default .rustybuns-trial/, gitignored)
//   --from <file>     the apps a saved --list printed, instead of searching again (no API calls)
//   --list            print the apps a search finds (stars, last push, version) and stop
//   --keep            keep node_modules after each app (default: removed, to bound disk use)
//   --prof            time boot and 200 GETs of /, read the host's memory, and save a CPU profile per
//                     mode (logs/<app>.<mode>.cpuprofile: open it in Chrome DevTools or speedscope.app)
//
// It runs each app's install scripts and build on this machine, with none of its logins (see ENV).
// Each app's host keeps its data in <out>/data/<app>, so nothing lands in ~ and no two apps share sqlite.
import { $ } from "bun";
import { existsSync, mkdirSync, appendFileSync, writeFileSync, rmSync, symlinkSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { parseArgs } from "node:util";

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    dep: { type: "string" }, major: { type: "string" }, limit: { type: "string" }, sample: { type: "string" }, since: { type: "string" }, stable: { type: "boolean" }, local: { type: "boolean" },
    modes: { type: "string", default: "spa,worker" }, jobs: { type: "string", default: "2" },
    out: { type: "string", default: ".rustybuns-trial" }, keep: { type: "boolean" }, prof: { type: "boolean" }, list: { type: "boolean" }, from: { type: "string" },
  },
});
const REPO = resolve(import.meta.dir, "..");
const OUT = resolve(o.out!);
const MODES = o.modes!.split(",") as ("spa" | "worker")[];
const VERSION = "0.1.11";
for (const d of ["clones", "logs", "data"]) mkdirSync(join(OUT, d), { recursive: true });

type App = { repo: string; sub: string; version?: string; stars?: number; pushed?: string };
type Prof = { bootMs: number; p50: number; p95: number; max: number; rssMb: number; profile?: string };
type ModeResult = { stage: string; status?: number; bytes?: number; text?: string; error?: string; prof?: Prof };
type Result = App & { fakeSecrets?: string[]; pm?: string; init?: string; error?: string; modes: Record<string, ModeResult> };

/** The version range an app's package.json gives <dep>, or undefined. */
export function depVersion(pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }, dep: string) {
  return pkg.dependencies?.[dep] ?? pkg.devDependencies?.[dep];
}
/** "^1.7.0", "1.0.0-beta.9", "~1.2" are major 1; "workspace:*", "latest", "0.0.88" are not. */
export const isMajor = (range: string, major: string) => new RegExp(`^[\\^~=v]?${major}\\.`).test(range.trim());

async function search(dep: string): Promise<App[]> {
  const hits = new Map<string, App>();
  for (let page = 1; page <= 10; page++) {
    const r = await $`gh api -X GET search/code -f q=${`"${dep}" filename:package.json`} -f per_page=100 -f page=${page}`.quiet().nothrow();
    if (r.exitCode) { console.error(`search page ${page}: ${r.stderr.toString().trim().split("\n").at(-1)}`); break; }
    const items: { path: string; repository: { full_name: string; fork: boolean } }[] = JSON.parse(r.stdout.toString()).items;
    for (const it of items) if (it.path.endsWith("package.json") && !it.repository.fork) {
      const sub = dirname(it.path) === "." ? "" : dirname(it.path);
      hits.set(`${it.repository.full_name}:${sub}`, { repo: it.repository.full_name, sub });
    }
    if (items.length < 100) break;
    await Bun.sleep(7000); // code search allows 10 requests a minute
  }
  const meta = new Map<string, { stars: number; archived: boolean; pushed: string }>();
  const apps: App[] = [];
  // 8 at a time: GitHub's secondary rate limit answers a burst with an error body, not data
  const queue = [...hits.values()];
  await Promise.all(Array.from({ length: 8 }, async () => { for (let a; (a = queue.shift()); ) await (async (a: App) => {
    const raw = await $`gh api repos/${a.repo}/contents/${a.sub ? `${a.sub}/` : ""}package.json -H ${"Accept: application/vnd.github.raw"}`.quiet().nothrow().text();
    let v: string | undefined;
    try { v = depVersion(JSON.parse(raw), dep); } catch { return; }
    if (!v || (o.major && !isMajor(v, o.major)) || (o.stable && /\d-[a-z]/i.test(v))) return;
    if (!meta.has(a.repo)) {
      const m = await $`gh api repos/${a.repo} --jq ${"[.stargazers_count,.archived,.pushed_at]"}`.quiet().nothrow().text();
      let parsed: unknown; try { parsed = JSON.parse(m); } catch {}
      const [stars, archived, pushed] = Array.isArray(parsed) ? parsed : [0, true, ""];
      meta.set(a.repo, { stars, archived, pushed: String(pushed).slice(0, 10) });
    }
    const m = meta.get(a.repo)!;
    if (!m.archived && (!o.since || m.pushed >= o.since)) apps.push({ ...a, version: v, stars: m.stars, pushed: m.pushed });
  })(a); }));
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
type Net = "net" | "offline";
const PROFILES: Partial<Record<Net, string>> = {};
function profile(net: Net): string | undefined {
  if (process.platform !== "darwin" || !Bun.which("sandbox-exec")) return undefined;
  if (PROFILES[net]) return PROFILES[net];
  const ok = [join(realHome, ".bun"), join(realHome, ".nvm"), join(realHome, ".npm"), join(realHome, "Library/pnpm"), REPO, OUT];
  const sb = [
    "(version 1)", "(allow default)",
    `(deny file-read* file-write* (subpath ${JSON.stringify(realHome)}))`,
    // later rules win: these stay reachable
    ...ok.map((p) => `(allow file-read* file-write* (subpath ${JSON.stringify(p)}))`),
    `(allow file-read* (literal ${JSON.stringify(realHome)}))`,
    ...(net === "offline" ? ["(deny network-outbound)", '(allow network-outbound (remote ip "localhost:*"))', "(allow network-outbound (remote unix-socket))"] : []),
  ].join("\n");
  const f = join(OUT, `sandbox-${net}.sb`);
  writeFileSync(f, sb + "\n");
  return (PROFILES[net] = f);
}
const sandboxed = (cmd: string[], net: Net) => { const f = profile(net); return f ? ["sandbox-exec", "-f", f, ...cmd] : cmd; };

async function step(log: string, cwd: string, cmd: string[], ms: number, net: Net = "offline", fakes: Record<string, string> = {}) {
  const p = Bun.spawn(sandboxed(cmd, net), { cwd, stdout: "pipe", stderr: "pipe", env: { ...fakes, ...ENV } });
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
async function boot(dir: string, log: string, profName?: string, fakes: Record<string, string> = {}): Promise<ModeResult> {
  const prof = profName ? ["--cpu-prof", `--cpu-prof-dir=${join(OUT, "logs")}`, `--cpu-prof-name=${profName}.cpuprofile`] : [];
  const t0 = performance.now();
  const host = Bun.spawn(sandboxed(["bun", ...prof, ".rustybuns/dev/desktop.js"], "offline"), { cwd: dir, stdout: "pipe", stderr: "pipe", env: { ...fakes, ...ENV } });
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
    const res: ModeResult = { stage: r.status < 400 ? "works" : "request", status: r.status, bytes: html.length, text: text.slice(0, 160) };
    if (profName && r.status < 400) {
      const bootMs = Math.round(performance.now() - t0);
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

/** The config init wrote, with this run's data dir and (for worker) the app's own Worker build on the desktop. */
function setMode(cfg: string, mode: "spa" | "worker", dataDir: string) {
  let s = cfg.replace(/\n\s*"dataDir": "[^"]*",?/, "").replace(/("desktop": \{)/, `$1\n      "dataDir": ${JSON.stringify(dataDir)},`);
  if (mode === "worker") s = s.replace(/"mode": "spa"/, `"mode": "worker"`).replace(/\n\s*"client(Build|Dir)": "[^"]*",?/g, "");
  return s;
}

/** A plausible fake for a secret, by its name. Never real: enough for an app to boot logged-out. */
export function fakeSecret(name: string): string | undefined {
  const hex = (n: number) => Buffer.from(crypto.getRandomValues(new Uint8Array(n))).toString("hex");
  if (/^(NODE_ENV|PORT|HOST|HOSTNAME|CI|HOME|PATH|TZ|PWD)$|^CLOUDFLARE_/.test(name)) return undefined;
  // Clerk checks the format: pk_<env>_ + base64("<frontend api host>$")
  if (/CLERK.*PUBLISHABLE|PUBLISHABLE.*CLERK/.test(name)) return `pk_test_${Buffer.from("rustybuns-trial.clerk.accounts.dev$").toString("base64")}`;
  if (/CLERK.*SECRET/.test(name)) return `sk_test_${hex(20)}`;
  if (/STRIPE.*PUBLISHABLE/.test(name)) return `pk_test_${hex(24)}`;
  if (/STRIPE.*SECRET/.test(name)) return `sk_test_${hex(24)}`;
  // addresses go nowhere: port 9 (discard) refuses at once, and the sandbox has no network anyway
  if (/(DATABASE|DB|POSTGRES|PG).*(URL|URI)|^DATABASE_URL$/.test(name)) return "postgres://trial:trial@127.0.0.1:9/trial";
  if (/(MYSQL).*(URL|URI)/.test(name)) return "mysql://trial:trial@127.0.0.1:9/trial";
  if (/(REDIS|KV).*(URL|URI)/.test(name)) return "redis://127.0.0.1:9";
  if (/(URL|URI|ENDPOINT|ORIGIN|BASE)$/.test(name)) return "http://127.0.0.1:9";
  if (/SECRET|KEY|TOKEN|PASSWORD|PASS$|SALT|PRIVATE|SIGNING/.test(name)) return hex(32);
  if (/EMAIL|FROM$/.test(name)) return "trial@example.invalid";
  if (/^VITE_|^PUBLIC_|^NEXT_PUBLIC_/.test(name)) return "rustybuns-trial";
  return undefined;
}

/** The secret names an app declares (.env.example and friends) or reads (process.env.X, env.X) in its own code. */
export function declaredSecrets(dir: string): string[] {
  const names = new Set<string>();
  const examples = /^\.(env|dev\.vars)(\..+)?\.(example|sample|template)$|^\.env\.(example|sample|template)$/;
  const code = /\.(m?[jt]sx?)$/;
  let files = 0;
  const walk = (d: string, depth: number) => {
    if (depth > 6 || files > 2000) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (/^(node_modules|\.git|dist|build|\.output|\.vercel|\.wrangler|\.rustybuns)$/.test(e.name)) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) { walk(p, depth + 1); continue; }
      if (examples.test(e.name)) for (const m of readFileSync(p, "utf8").matchAll(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]+)\s*=/gm)) names.add(m[1]!);
      else if (code.test(e.name) && files++ < 2000) {
        const src = readFileSync(p, "utf8");
        for (const m of src.matchAll(/\b(?:process\.env|import\.meta\.env|env)\.([A-Z][A-Z0-9_]{2,})\b/g)) names.add(m[1]!);
        for (const m of src.matchAll(/\b(?:process\.env|env)\[["']([A-Z][A-Z0-9_]{2,})["']\]/g)) names.add(m[1]!);
      }
    }
  };
  walk(dir, 0);
  // SDKs that read their own variables, which the app's code never names
  const pkg = (() => { try { return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")); } catch { return {}; } })();
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  for (const [dep, vars] of Object.entries(IMPLICIT)) if (deps.some((d) => d === dep || d.startsWith(dep + "/"))) vars.forEach((v) => names.add(v));
  return [...names].sort();
}

/** Variables an SDK reads by itself when present. */
const IMPLICIT: Record<string, string[]> = {
  "@clerk": ["CLERK_SECRET_KEY", "CLERK_PUBLISHABLE_KEY", "VITE_CLERK_PUBLISHABLE_KEY"],
  "better-auth": ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL"],
  "next-auth": ["AUTH_SECRET", "NEXTAUTH_SECRET", "NEXTAUTH_URL"], "@auth": ["AUTH_SECRET", "AUTH_URL"],
  "convex": ["CONVEX_URL", "VITE_CONVEX_URL"], "@convex-dev": ["CONVEX_URL", "VITE_CONVEX_URL"],
  "@supabase": ["SUPABASE_URL", "SUPABASE_ANON_KEY", "VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"],
  "stripe": ["STRIPE_SECRET_KEY"], "resend": ["RESEND_API_KEY"], "openai": ["OPENAI_API_KEY"],
  "@anthropic-ai": ["ANTHROPIC_API_KEY"], "@neondatabase": ["DATABASE_URL"], "@prisma/client": ["DATABASE_URL"], "postgres": ["DATABASE_URL"],
};

/** .env, .env.production, .dev.vars and the like anywhere in a clone (not .env.example), deleted; returns their paths. */
export function removeCommittedSecrets(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/^\.(env|dev\.vars)(\..+)?$/.test(e.name) && !/\.(example|sample|template|schema|defaults)$/.test(e.name)) { rmSync(p); out.push(p.slice(root.length + 1)); }
    }
  };
  walk(root);
  return out;
}

async function trial(app: App): Promise<Result> {
  const slug = `${app.repo.replace("/", "__")}${app.sub ? `__${app.sub.replace(/\//g, "_")}` : ""}`;
  const log = join(OUT, "logs", `${slug}.log`);
  writeFileSync(log, "");
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
  let { pm, at } = packageManager(dir, root);
  let s = await step(log, at, pm === "yarn" ? ["npx", "-y", "yarn@1", "install"] : pm === "pnpm" ? ["pnpm", "install", "--config.minimum-release-age=0"] : [pm, "install"], 600e3, "net");
  // an npm lockfile that npm itself can't install (peer conflicts): pnpm reads package.json alone
  if (!s.ok && pm === "npm") { pm = "pnpm"; s = await step(log, at, ["pnpm", "install", "--config.minimum-release-age=0"], 600e3, "net"); }
  r.pm = pm;
  if (!s.ok) return { ...r, error: `install: ${s.tail}` };
  const cli = o.local ? ["bun", join(REPO, "packages/cli/src/index.ts")] : [join(dir, "node_modules/.bin/rustybuns")];
  if (o.local) {
    // the app resolves @rustybuns/* (its config imports @rustybuns/cli/config) to this checkout
    mkdirSync(join(dir, "node_modules/@rustybuns"), { recursive: true });
    for (const p of ["cli", "shell-bun"]) { rmSync(join(dir, "node_modules/@rustybuns", p), { recursive: true, force: true }); symlinkSync(join(REPO, "packages", p), join(dir, "node_modules/@rustybuns", p)); }
  } else {
    const add = pm === "npm" ? ["npm", "i", "-D"] : [pm, "add", "-D", ...(pm === "pnpm" ? ["--config.minimum-release-age=0"] : [])];
    s = await step(log, dir, [...add, `@rustybuns/cli@${VERSION}`, `@rustybuns/shell-bun@${VERSION}`], 300e3, "net");
    if (!s.ok) return { ...r, error: `add rustybuns: ${s.tail}` };
  }
  s = await step(log, dir, [...cli, "init", "--force"], 120e3, "offline", fakes);
  if (!s.ok) return { ...r, error: `init: ${s.tail}` };
  r.init = strip(s.out).match(/^detected: (.*)$/m)?.[1];
  const initCfg = readFileSync(join(dir, "rustybuns.config.ts"), "utf8");
  const initMode = initCfg.match(/"mode": "(\w+)"/)?.[1];
  for (const mode of MODES) {
    if (mode === "worker" && !/"builtMain"/.test(initCfg)) { r.modes[mode] = { stage: "skipped", error: "init found no Worker build" }; continue; }
    // init chose worker itself (TanStack Start's server, Astro's adapter): there is no SPA to try
    if (mode === "spa" && initMode === "worker") { r.modes[mode] = { stage: "skipped", error: "init chose worker mode" }; continue; }
    writeFileSync(join(dir, "rustybuns.config.ts"), setMode(initCfg, mode, join(OUT, "data", slug, mode)));
    appendFileSync(log, `\n===== mode ${mode} =====\n`);
    if (mode === "spa" && initMode === "spa" && !existsSync(join(dir, "vite.desktop.config.ts"))) {
      s = await step(log, dir, [...cli, "add", "desktop"], 300e3, "offline", fakes);
      if (!s.ok) { r.modes[mode] = { stage: "add desktop", error: s.tail }; continue; }
    }
    s = await step(log, dir, [...cli, "build", "desktop", "--dev"], 600e3, "offline", fakes);
    r.modes[mode] = s.ok ? await boot(dir, log, o.prof ? `${slug}.${mode}` : undefined, fakes) : { stage: "build", error: s.tail };
  }
  if (!o.keep) for (const d of new Set([dir, at])) rmSync(join(d, "node_modules"), { recursive: true, force: true });
  return r;
}

const cell = (m?: ModeResult) => !m ? "" : m.stage === "works" ? `✅ ${m.status}` : m.stage === "skipped" ? "—" : `❌ ${m.stage}`;
const note = (r: Result) => (r.error ?? Object.values(r.modes).find((m) => m.error)?.error ?? "").split("\n").at(-1)!.replace(/\|/g, "\\|").replace(/\/[^\s"']*\/(clones|node_modules)\//g, "…/").slice(0, 140);
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
    `| app | version | ${MODES.join(" | ")} | first error |`, `|---|---|${MODES.map(() => "---|").join("")}---|`,
    ...rs.map((r) => `| [${r.repo}${r.sub ? `:${r.sub}` : ""}](https://github.com/${r.repo}${r.sub ? `/tree/HEAD/${r.sub}` : ""}) | ${r.version ?? ""} | ${MODES.map((m) => cell(r.modes[m]) || (r.error ? `❌ ${r.error.split(":")[0]}` : "")).join(" | ")} | ${note(r)} |`),
    ...freshness(rs),
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
  if (o.sample && Number(o.sample) < apps.length) { const n = Number(o.sample), step = apps.length / n; apps = Array.from({ length: n }, (_, i) => apps[Math.floor(i * step + step / 2)]!); }
  if (o.list) {
    for (const a of apps) console.log(`${String(a.stars ?? "").padStart(6)}  ${a.pushed ?? "          "}  ${(a.version ?? "").padEnd(16)}  ${a.repo}${a.sub ? `:${a.sub}` : ""}`);
    console.log(`${apps.length} apps`);
    process.exit(0);
  }
  console.log(`trying ${apps.length} apps, ${o.jobs} at a time, modes ${MODES.join(",")}; results in ${OUT}`);
  const results: Result[] = [];
  // One worker per repo at a time: apps in the same clone would install over each other.
  const groups = [...Map.groupBy(apps, (a) => a.repo).values()];
  await Promise.all(Array.from({ length: Number(o.jobs) }, async () => {
    for (let group; (group = groups.shift()); ) for (const app of group) {
      const r = await trial(app).catch((e): Result => ({ ...app, error: String(e), modes: {} }));
      results.push(r);
      appendFileSync(join(OUT, "results.jsonl"), JSON.stringify(r) + "\n");
      console.log(`[${results.length}/${apps.length}] ${r.repo}${r.sub ? `:${r.sub}` : ""}  ${MODES.map((m) => `${m} ${cell(r.modes[m]) || "❌"}`).join("  ")}  ${note(r)}`);
    }
  }));
  const order = new Map(apps.map((a, i) => [`${a.repo}:${a.sub}`, i]));
  results.sort((a, b) => order.get(`${a.repo}:${a.sub}`)! - order.get(`${b.repo}:${b.sub}`)!);
  writeFileSync(join(OUT, "summary.md"), summary(results));
  console.log(`\n${join(OUT, "summary.md")}`);
}
