// What trial-github flags for a human look (#954). Containment is the defense: strangers' code
// runs with no logins, no home and no network after install. These only point at behaviour worth
// reading: install scripts, what the sandbox stopped, a host busy while idle, known-malicious packages.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Installed = { name: string; version: string; scripts: string[] };

const LIFECYCLE = ["preinstall", "install", "postinstall"] as const;

/** Every package under a node_modules (npm, yarn, bun, and pnpm's .pnpm store), once each by name@version,
 *  with the install-time scripts it declares. A binding.gyp with no install script still runs node-gyp. */
export function installedPackages(root: string): Installed[] {
  const seen = new Map<string, Installed>();
  const visit = (pkgDir: string) => {
    let pkg: { name?: string; version?: string; scripts?: Record<string, string> };
    try { pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")); } catch { return; }
    if (pkg.name && pkg.version && !seen.has(`${pkg.name}@${pkg.version}`)) {
      const scripts: string[] = LIFECYCLE.filter((s) => pkg.scripts?.[s]);
      if (!pkg.scripts?.install && !pkg.scripts?.preinstall && existsSync(join(pkgDir, "binding.gyp"))) scripts.push("binding.gyp");
      seen.set(`${pkg.name}@${pkg.version}`, { name: pkg.name, version: pkg.version, scripts });
    }
    walk(join(pkgDir, "node_modules"));
  };
  const walk = (nm: string) => {
    let entries; try { entries = readdirSync(nm, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() && !e.isSymbolicLink()) continue;
      const p = join(nm, e.name);
      // pnpm keeps the real copies in .pnpm/<name@version>/node_modules, bun in .bun/
      if (e.name === ".pnpm" || e.name === ".bun") { try { for (const s of readdirSync(p)) walk(join(p, s, "node_modules")); } catch {} continue; }
      if (e.name.startsWith(".")) continue;
      if (e.name.startsWith("@")) { try { for (const s of readdirSync(p)) visit(join(p, s)); } catch {} continue; }
      if (!e.isSymbolicLink()) visit(p); // pnpm's top-level links point into .pnpm, visited there
    }
  };
  walk(join(root, "node_modules"));
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Install scripts nearly every app has (native binaries, toolchains): listed in the log, not flagged. */
export const USUAL_INSTALL = new Set(["esbuild", "workerd", "sharp", "@parcel/watcher", "@swc/core", "@biomejs/biome", "@tailwindcss/oxide",
  "better-sqlite3", "bufferutil", "utf-8-validate", "fsevents", "core-js", "core-js-pure", "protobufjs", "prisma", "@prisma/client", "@prisma/engines",
  "msw", "unrs-resolver", "lefthook", "husky", "simple-git-hooks", "puppeteer", "playwright", "cypress", "electron", "nx", "@sentry/cli", "turbo", "cbor-extract", "msgpackr-extract", "re2", "canvas", "bcrypt", "argon2"]);

/** The app's own install scripts (it runs them on install too). */
export function ownInstallScripts(dir: string): string[] {
  try { const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")); return LIFECYCLE.filter((s) => pkg.scripts?.[s]); } catch { return []; }
}

/** Places under the real home worth a ⚠️ if anything tried to read them: logins, keys, browsers. */
const SENSITIVE = /\/(\.ssh|\.aws|\.gnupg|\.kube|\.docker|\.netrc|\.npmrc|\.yarnrc|\.pypirc|\.git-credentials|\.wrangler|\.alchemy|\.config\/(gh|gcloud|op|wrangler|\.wrangler)|\.vercel|\.netlify|Library\/Keychains|Library\/Cookies|Library\/Application Support\/(Google\/Chrome|Firefox|BraveSoftware|Microsoft Edge|Arc|1Password)|Library\/Group Containers\/[^/]*1password)(\/|$)/i;

export type Denials = { net: string[]; reads: string[]; other: number };

/** Sandbox denials from `log show --style ndjson`, the lines carrying `tag` (each trial profile's
 *  `(with message …)`). Network: outbound to anywhere but localhost. Reads: the sensitive ones under
 *  home; the rest (a toolchain probing ~/.gitconfig) only counted. Deduplicated by process and target. */
export function parseDenials(ndjson: string, tag: string): Denials {
  const net = new Set<string>(), reads = new Set<string>();
  let other = 0;
  for (const line of ndjson.split("\n")) {
    let msg: string;
    try { msg = JSON.parse(line).eventMessage ?? ""; } catch { continue; }
    if (!msg.includes(tag)) continue;
    const m = msg.match(/Sandbox: (.+?)\(\d+\) deny\(\d+\) ([\w*-]+)(?: (.+?))?(?:\n|$)/);
    if (!m) continue;
    const [, proc, op, target = ""] = m as unknown as [string, string, string, string?];
    if (op.startsWith("network-outbound")) {
      if (/^(localhost|127\.|::1|\[::1\])/.test(target) || target.startsWith("/")) continue;
      // the kernel hides the address ("remote:*:443"), and sometimes logs none at all
      const port = target.match(/:(\d+)$/)?.[1];
      net.add(port ? `${proc} → port ${port}` : target && !target.startsWith("remote:") ? `${proc} → ${target}` : `${proc}`);
    } else if (op.startsWith("file-read") || op.startsWith("file-write")) {
      if (SENSITIVE.test(target)) reads.add(`${proc} ${op.startsWith("file-write") ? "wrote" : "read"} ${target}`);
      else other++;
    }
  }
  // a bare "curl" says nothing a "curl → port 443" doesn't
  for (const n of net) if (!n.includes(" → ") && [...net].some((x) => x.startsWith(`${n} → `))) net.delete(n);
  return { net: [...net].sort(), reads: [...reads].sort(), other };
}

/** CPU seconds from ps's `time` column: "0:01.23", "12:34.56", "1:02:03.45" or "1-02:03:04". */
export function cpuSeconds(t: string): number {
  const [days, rest] = t.includes("-") ? [Number(t.split("-")[0]), t.split("-")[1]!] : [0, t];
  return days * 86400 + rest.trim().split(":").reduce((s, p) => s * 60 + Number(p), 0);
}

/** A process and every process under it, from `ps -A -o pid=,ppid=,time=,rss=`: total CPU seconds and RSS in MB. */
export function treeUsage(ps: string, root: number): { cpu: number; rssMb: number } {
  const rows = ps.trim().split("\n").map((l) => l.trim().split(/\s+/)).filter((r) => r.length >= 4)
    .map(([pid, ppid, time, rss]) => ({ pid: Number(pid), ppid: Number(ppid), cpu: cpuSeconds(time!), rss: Number(rss) }));
  const tree = new Set([root]);
  for (let grew = true; grew;) { grew = false; for (const r of rows) if (!tree.has(r.pid) && tree.has(r.ppid)) { tree.add(r.pid); grew = true; } }
  const mine = rows.filter((r) => tree.has(r.pid));
  return { cpu: mine.reduce((s, r) => s + r.cpu, 0), rssMb: Math.round(mine.reduce((s, r) => s + r.rss, 0) / 1024) };
}

/** A host idle after serving / should sit near 0% CPU; a miner doesn't. Over half a core, or over a GB. */
export const IDLE_CPU = 0.5, BIG_RSS_MB = 1024;
export type Idle = { cpu: number; rssMb: number };

/** OSV's MAL- advisories (OpenSSF malicious packages) for these versions: known-bad, not merely vulnerable. */
export async function malicious(pkgs: { name: string; version: string }[], get: typeof fetch = fetch): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < pkgs.length; i += 1000) {
    const batch = pkgs.slice(i, i + 1000);
    const res = await get("https://api.osv.dev/v1/querybatch", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ queries: batch.map((p) => ({ package: { name: p.name, ecosystem: "npm" }, version: p.version })) }) });
    if (!res.ok) throw new Error(`osv.dev: ${res.status}`);
    const { results } = (await res.json()) as { results: { vulns?: { id: string }[] }[] };
    batch.forEach((p, j) => { for (const v of results[j]?.vulns ?? []) if (v.id.startsWith("MAL-")) out.push(`${p.name}@${p.version} (${v.id})`); });
  }
  return out;
}

export type Flags = { installScripts?: string[]; network?: string[]; reads?: string[]; idle?: string[]; malicious?: string[]; osvError?: string };

/** One short line per kind of flag, for the summary's ⚠️ column and section. */
export function flagLines(f: Flags | undefined): string[] {
  if (!f) return [];
  const list = (xs: string[], n = 3) => xs.slice(0, n).join(", ") + (xs.length > n ? ` and ${xs.length - n} more` : "");
  return [
    f.malicious?.length && `known-malicious: ${list(f.malicious)}`,
    f.network?.length && `blocked network: ${list(f.network)}`,
    f.reads?.length && `blocked reads: ${list(f.reads)}`,
    f.idle?.length && `busy at idle: ${f.idle.join(", ")}`,
    f.installScripts?.length && `install scripts: ${list(f.installScripts, 5)}`,
  ].filter((x): x is string => !!x);
}
