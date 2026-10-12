// Do real apps from GitHub "just work" under Rusty Buns? Finds repos that depend on a package
// (GitHub code search over package.json), then for each one: clone, install, `rustybuns init`, and
// build + boot the desktop host in each mode, GET / with the token, and record how far it got.
//
//   bun scripts/trial-github.ts --dep rwsdk --major 1 --local --jobs 3
//   bun scripts/trial-github.ts --local owner/repo owner/monorepo:apps/web
//
//   --dep <name>      search for package.json files that depend on <name> (needs `gh` logged in)
//   --major <n>       keep only apps whose <dep> version is <n>.x
//   --limit <n>       try at most n apps (default: all found)
//   --local           test this checkout's cli and shell-bun instead of the npm release
//   --modes spa,worker  desktop modes to try; worker swaps init's mode for the app's own Worker build
//   --jobs <n>        apps at a time (default 2)
//   --out <dir>       results.jsonl, summary.md, logs, clones (default .rustybuns-trial/, gitignored)
//   --keep            keep node_modules after each app (default: removed, to bound disk use)
//   --prof            time boot and 200 GETs of /, read the host's memory, and save a CPU profile per
//                     mode (logs/<app>.<mode>.cpuprofile: open it in Chrome DevTools or speedscope.app)
//
// It runs each app's install scripts and build on this machine: only point it at code you'd run.
// Each app's host keeps its data in <out>/data/<app>, so nothing lands in ~ and no two apps share sqlite.
import { $ } from "bun";
import { existsSync, mkdirSync, appendFileSync, writeFileSync, rmSync, symlinkSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { parseArgs } from "node:util";

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    dep: { type: "string" }, major: { type: "string" }, limit: { type: "string" }, local: { type: "boolean" },
    modes: { type: "string", default: "spa,worker" }, jobs: { type: "string", default: "2" },
    out: { type: "string", default: ".rustybuns-trial" }, keep: { type: "boolean" }, prof: { type: "boolean" },
  },
});
const REPO = resolve(import.meta.dir, "..");
const OUT = resolve(o.out!);
const MODES = o.modes!.split(",") as ("spa" | "worker")[];
const VERSION = "0.1.11";
for (const d of ["clones", "logs", "data"]) mkdirSync(join(OUT, d), { recursive: true });

type App = { repo: string; sub: string; version?: string; stars?: number };
type Prof = { bootMs: number; p50: number; p95: number; max: number; rssMb: number; profile?: string };
type ModeResult = { stage: string; status?: number; bytes?: number; text?: string; error?: string; prof?: Prof };
type Result = App & { pm?: string; init?: string; error?: string; modes: Record<string, ModeResult> };

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
  const meta = new Map<string, { stars: number; archived: boolean }>();
  const apps: App[] = [];
  await Promise.all([...hits.values()].map(async (a) => {
    const raw = await $`gh api repos/${a.repo}/contents/${a.sub ? `${a.sub}/` : ""}package.json -H ${"Accept: application/vnd.github.raw"}`.quiet().nothrow().text();
    let v: string | undefined;
    try { v = depVersion(JSON.parse(raw), dep); } catch { return; }
    if (!v || (o.major && !isMajor(v, o.major))) return;
    if (!meta.has(a.repo)) {
      const m = await $`gh api repos/${a.repo} --jq ${"[.stargazers_count,.archived]"}`.quiet().nothrow().text();
      const [stars, archived] = m ? JSON.parse(m) : [0, true];
      meta.set(a.repo, { stars, archived });
    }
    if (!meta.get(a.repo)!.archived) apps.push({ ...a, version: v, stars: meta.get(a.repo)!.stars });
  }));
  return apps.sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0) || a.repo.localeCompare(b.repo));
}

const ENV = { ...process.env, CI: "1", RUSTYBUNS_NO_UPDATE_CHECK: "1", RB_NO_BROWSER: "1" };
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
/** The last lines of a failed step's output worth reading: no stack frames. */
const tail = (s: string) => strip(s).trim().split("\n").filter((l) => !/^\s+at /.test(l) && !/^Bun v\d/.test(l) && l.trim()).slice(-4).join("\n");

async function step(log: string, cwd: string, cmd: string[], ms: number) {
  const p = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe", env: ENV });
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
  return { pm: "npm", at: dir };
}

/** Boots the dev host, logs in with the printed token like a browser does, and GETs /. */
async function boot(dir: string, log: string, profName?: string): Promise<ModeResult> {
  const prof = profName ? ["--cpu-prof", `--cpu-prof-dir=${join(OUT, "logs")}`, `--cpu-prof-name=${profName}.cpuprofile`] : [];
  const t0 = performance.now();
  const host = Bun.spawn(["bun", ...prof, ".rustybuns/dev/desktop.js"], { cwd: dir, stdout: "pipe", stderr: "pipe", env: ENV });
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

async function trial(app: App): Promise<Result> {
  const slug = `${app.repo.replace("/", "__")}${app.sub ? `__${app.sub.replace(/\//g, "_")}` : ""}`;
  const log = join(OUT, "logs", `${slug}.log`);
  writeFileSync(log, "");
  const root = join(OUT, "clones", app.repo.replace("/", "__"));
  const dir = join(root, app.sub);
  const r: Result = { ...app, modes: {} };
  if (!existsSync(root)) {
    const s = await step(log, OUT, ["git", "clone", "--depth", "1", `https://github.com/${app.repo}`, root], 180e3);
    if (!s.ok) return { ...r, error: `clone: ${s.tail}` };
  }
  const { pm, at } = packageManager(dir, root);
  r.pm = pm;
  let s = await step(log, at, pm === "yarn" ? ["npx", "-y", "yarn@1", "install"] : [pm, "install"], 600e3);
  if (!s.ok) return { ...r, error: `install: ${s.tail}` };
  const cli = o.local ? ["bun", join(REPO, "packages/cli/src/index.ts")] : [join(dir, "node_modules/.bin/rustybuns")];
  if (o.local) {
    // the app resolves @rustybuns/* (its config imports @rustybuns/cli/config) to this checkout
    mkdirSync(join(dir, "node_modules/@rustybuns"), { recursive: true });
    for (const p of ["cli", "shell-bun"]) { rmSync(join(dir, "node_modules/@rustybuns", p), { recursive: true, force: true }); symlinkSync(join(REPO, "packages", p), join(dir, "node_modules/@rustybuns", p)); }
  } else {
    const add = pm === "npm" ? ["npm", "i", "-D"] : [pm, "add", "-D", ...(pm === "pnpm" ? ["--config.minimum-release-age=0"] : [])];
    s = await step(log, dir, [...add, `@rustybuns/cli@${VERSION}`, `@rustybuns/shell-bun@${VERSION}`], 300e3);
    if (!s.ok) return { ...r, error: `add rustybuns: ${s.tail}` };
  }
  s = await step(log, dir, [...cli, "init", "--force"], 120e3);
  if (!s.ok) return { ...r, error: `init: ${s.tail}` };
  r.init = strip(s.out).match(/^detected: (.*)$/m)?.[1];
  const initCfg = readFileSync(join(dir, "rustybuns.config.ts"), "utf8");
  const initMode = initCfg.match(/"mode": "(\w+)"/)?.[1];
  for (const mode of MODES) {
    if (mode === "worker" && !/"builtMain"/.test(initCfg)) { r.modes[mode] = { stage: "skipped", error: "init found no Worker build" }; continue; }
    writeFileSync(join(dir, "rustybuns.config.ts"), setMode(initCfg, mode, join(OUT, "data", slug, mode)));
    appendFileSync(log, `\n===== mode ${mode} =====\n`);
    if (mode === "spa" && initMode === "spa" && !existsSync(join(dir, "vite.desktop.config.ts"))) {
      s = await step(log, dir, [...cli, "add", "desktop"], 300e3);
      if (!s.ok) { r.modes[mode] = { stage: "add desktop", error: s.tail }; continue; }
    }
    s = await step(log, dir, [...cli, "build", "desktop", "--dev"], 600e3);
    r.modes[mode] = s.ok ? await boot(dir, log, o.prof ? `${slug}.${mode}` : undefined) : { stage: "build", error: s.tail };
  }
  if (!o.keep) for (const d of new Set([dir, at])) rmSync(join(d, "node_modules"), { recursive: true, force: true });
  return r;
}

const cell = (m?: ModeResult) => !m ? "" : m.stage === "works" ? `✅ ${m.status}` : m.stage === "skipped" ? "—" : `❌ ${m.stage}`;
const note = (r: Result) => (r.error ?? Object.values(r.modes).find((m) => m.error)?.error ?? "").split("\n").at(-1)!.replace(/\|/g, "\\|").replace(/\/[^\s"']*\/(clones|node_modules)\//g, "…/").slice(0, 140);
function summary(rs: Result[]) {
  const ok = (mode: string) => rs.filter((r) => r.modes[mode]?.stage === "works").length;
  return [`# trial-github: ${rs.length} apps${o.dep ? ` depending on ${o.dep}${o.major ? ` ${o.major}.x` : ""}` : ""} (${o.local ? "this checkout" : `@rustybuns ${VERSION}`})`, "",
    MODES.map((m) => `${m}: ${ok(m)}/${rs.length} serve /`).join(" · "), "",
    `| app | version | ${MODES.join(" | ")} | first error |`, `|---|---|${MODES.map(() => "---|").join("")}---|`,
    ...rs.map((r) => `| [${r.repo}${r.sub ? `:${r.sub}` : ""}](https://github.com/${r.repo}${r.sub ? `/tree/HEAD/${r.sub}` : ""}) | ${r.version ?? ""} | ${MODES.map((m) => cell(r.modes[m]) || (r.error ? `❌ ${r.error.split(":")[0]}` : "")).join(" | ")} | ${note(r)} |`),
    ...(o.prof ? ["", "## Perf (dev host, this machine)", "", "Boot is spawn to the first page; latency is 200 sequential GETs of /.", "",
      "| app | mode | boot | p50 | p95 | max | rss | page |", "|---|---|---|---|---|---|---|---|",
      ...rs.flatMap((r) => Object.entries(r.modes).filter(([, m]) => m.prof).map(([mode, m]) =>
        `| ${r.repo}${r.sub ? `:${r.sub}` : ""} | ${mode} | ${m.prof!.bootMs} ms | ${m.prof!.p50} ms | ${m.prof!.p95} ms | ${m.prof!.max} ms | ${m.prof!.rssMb} MB | ${Math.round(m.bytes! / 1024)} KB |`))] : []),
  ].join("\n") + "\n";
}

if (import.meta.main) {
  let apps: App[] = positionals.map((p) => { const [repo, sub = ""] = p.split(":"); return { repo: repo!, sub }; });
  if (o.dep) apps.push(...await search(o.dep));
  if (!apps.length) throw new Error("usage: bun scripts/trial-github.ts [--dep <name> [--major <n>]] [owner/repo[:subdir] ...]");
  if (o.limit) apps = apps.slice(0, Number(o.limit));
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
