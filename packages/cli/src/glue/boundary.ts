// Boundary analysis: where the server/client line runs through the app, so the
// desktop build can satisfy each side locally without touching src/.
//
//   client  "use client", or imports nothing server-only          -> renders in the tab
//   action  "use server"                                            -> proxied to the Bun host, runs for real
//   server  imports a server-only module (db, prisma, cf, auth)     -> clientize via use(), or stub the import
//   leak    a client module that (transitively) imports a server module -> the Prisma-in-the-bundle bug
//
// Text analysis only. Good enough to generate aliases and proxies; not a type checker.

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative, extname } from "node:path";

export type Tier = "client" | "action" | "server" | "leak";

export interface ModuleInfo {
  file: string;              // relative to root
  directive: "use client" | "use server" | null;
  imports: string[];         // raw specifiers
  /** specifier -> named imports (default is "default", namespace is "*") */
  importNames: Record<string, string[]>;
  serverOnly: string[];      // matched server-only specifiers
  exports: string[];         // exported function names (for actions)
  tier: Tier;
  leaksVia?: string;         // for leak: the first server module on the path
}

export interface BoundaryOptions {
  root?: string;
  srcDir?: string;
  aliases?: Record<string, string>;
  /** Specifier patterns that mean "server-only". Extend per app. */
  serverOnly?: RegExp[];
  ignore?: RegExp[];
}

export const DEFAULT_SERVER_ONLY: RegExp[] = [
  /^cloudflare:/, /^rwsdk\/worker/, /^rwsdk\/db/, /^@prisma\//, /^@generated\/prisma/, /^\.prisma\//,
  /^better-auth$/, /^better-auth\/(?!react|client)/, /^@simplewebauthn\/server/,
  /^node:/, /^bun:/, /^drizzle-orm\/d1/, /^@\/db$/, /\/db$/,
];

const EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs"];

function walk(dir: string, ignore: RegExp[], out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (ignore.some((r) => r.test(p))) continue;
    if (statSync(p).isDirectory()) walk(p, ignore, out);
    else if (EXTS.includes(extname(p))) out.push(p);
  }
  return out;
}

function directiveOf(src: string): ModuleInfo["directive"] {
  const head = src.slice(0, 400).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").trimStart();
  if (/^["']use client["']/.test(head)) return "use client";
  if (/^["']use server["']/.test(head)) return "use server";
  return null;
}

function importsOf(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/(?:import|export)\s+(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']/g)) out.push(m[1]!);
  for (const m of src.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1]!);
  return out;
}

function importNamesOf(src: string): Record<string, string[]> {
  const out: Record<string, Set<string>> = {};
  const add = (spec: string, n: string) => (out[spec] ??= new Set()).add(n);
  for (const m of src.matchAll(/import\s+(?:type\s+)?([A-Za-z_$][\w$]*)?\s*,?\s*(?:\{([^}]*)\})?\s*(?:\*\s+as\s+([A-Za-z_$][\w$]*))?\s*from\s*["']([^"']+)["']/g)) {
    const [, def, named, ns, spec] = m;
    if (!spec || (!def && !named && !ns)) continue;
    if (def) add(spec, "default");
    if (ns) add(spec, "*");
    for (const n of (named ?? "").split(",")) { const nm = n.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!.trim(); if (nm) add(spec, nm); }
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v]]));
}

function exportsOf(src: string): string[] {
  const out = new Set<string>();
  for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) out.add(m[1]!);
  for (const m of src.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)\s*=/g)) out.add(m[1]!);
  return [...out];
}

export function analyze(opts: BoundaryOptions = {}) {
  const root = resolve(opts.root ?? process.cwd());
  const srcDir = join(root, opts.srcDir ?? "src");
  const aliases = opts.aliases ?? { "@": "src" };
  const serverOnly = opts.serverOnly ?? DEFAULT_SERVER_ONLY;
  const ignore = opts.ignore ?? [/node_modules/, /\.test\.[tj]sx?$/, /\/scripts\//, /\.d\.ts$/];
  if (!existsSync(srcDir)) return { modules: [] as ModuleInfo[], byFile: new Map<string, ModuleInfo>() };

  const files = walk(srcDir, ignore);
  const byFile = new Map<string, ModuleInfo>();

  const resolveLocal = (from: string, spec: string): string | null => {
    let base: string | null = null;
    if (spec.startsWith(".")) base = resolve(dirname(from), spec);
    else for (const [a, target] of Object.entries(aliases)) {
      if (spec === a || spec.startsWith(a + "/")) { base = join(root, target, spec.slice(a.length)); break; }
    }
    if (!base) return null;
    for (const c of [base, ...EXTS.map((e) => base + e), ...EXTS.map((e) => join(base!, "index" + e))]) {
      if (existsSync(c) && statSync(c).isFile()) return c;
    }
    return null;
  };

  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const imports = importsOf(src);
    const so = imports.filter((s) => serverOnly.some((r) => r.test(s)));
    const directive = directiveOf(src);
    const tier: Tier = directive === "use server" ? "action" : so.length ? "server" : "client";
    byFile.set(f, { file: relative(root, f), directive, imports, importNames: importNamesOf(src), serverOnly: so, exports: exportsOf(src), tier });
  }

  // leaks: client modules reaching a server module through local imports
  const memo = new Map<string, string | null>();
  const firstServer = (f: string, seen = new Set<string>()): string | null => {
    if (memo.has(f)) return memo.get(f)!;
    if (seen.has(f)) return null;
    seen.add(f);
    const info = byFile.get(f);
    if (!info) return null;
    if (info.tier === "server") return info.file;
    if (info.tier === "action") return null;   // importing an action from a client is normal RSC; the proxy handles it
    for (const spec of info.imports) {
      const t = resolveLocal(f, spec);
      if (!t) continue;
      const hit = firstServer(t, seen);
      if (hit) { memo.set(f, hit); return hit; }
    }
    memo.set(f, null);
    return null;
  };
  for (const [f, info] of byFile) {
    if (info.tier !== "client") continue;
    const via = firstServer(f);
    if (via && via !== info.file) { info.tier = "leak"; info.leaksVia = via; }
  }
  return { modules: [...byFile.values()].sort((a, b) => a.file.localeCompare(b.file)), byFile };
}

/** What the desktop build generates from the analysis. */
export function plan(modules: ModuleInfo[]) {
  const actions = modules.filter((m) => m.tier === "action");
  const servers = modules.filter((m) => m.tier === "server");
  const leaks = modules.filter((m) => m.tier === "leak");
  const stubSpecifiers = new Set<string>();
  const stubNames: Record<string, Set<string>> = {};
  for (const m of [...servers, ...leaks, ...actions]) for (const s of m.serverOnly) {
    stubSpecifiers.add(s);
    for (const n of m.importNames[s] ?? []) (stubNames[s] ??= new Set()).add(n);
  }
  return {
    counts: { client: modules.filter((m) => m.tier === "client").length, action: actions.length, server: servers.length, leak: leaks.length },
    actions,     // -> proxies that POST to the host; the host imports the real module
    servers,     // -> clientize via use(), with their server-only imports aliased
    leaks,       // -> same aliasing fixes the leak; report them so the dev knows
    stubSpecifiers: [...stubSpecifiers].filter((s) => !/^(node|bun):/.test(s)),
    /** named exports each stub must provide, so Rollup's import analysis is satisfied */
    stubNames: Object.fromEntries(Object.entries(stubNames).map(([k, v]) => [k, [...v].filter((n) => n !== "default" && n !== "*")])),
  };
}

export function report(modules: ModuleInfo[]): string {
  const p = plan(modules);
  const lines = [`boundary: ${p.counts.client} client, ${p.counts.action} action, ${p.counts.server} server, ${p.counts.leak} leak`];
  for (const m of p.actions) lines.push(`  action  ${m.file}  [${m.exports.join(", ")}]  -> proxied to host`);
  for (const m of p.servers) lines.push(`  server  ${m.file}  (${m.serverOnly.join(", ")})  -> clientize + alias`);
  for (const m of p.leaks) lines.push(`  leak    ${m.file}  via ${m.leaksVia}  -> alias fixes it`);
  if (p.stubSpecifiers.length) lines.push(`  stubs   ${p.stubSpecifiers.join(", ")}`);
  return lines.join("\n");
}
