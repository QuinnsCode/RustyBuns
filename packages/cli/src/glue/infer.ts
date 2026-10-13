// Inference: read what the app already says about itself and don't ask twice.
//   package.json  -> framework, package manager, scripts, workspaces
//   vite.config.* -> plugins (rwsdk / cloudflare / react), root, outDir, aliases
//   wrangler.*    -> bindings, compat, assets   (see ../wrangler.ts)
// Everything is best-effort text analysis; nothing here executes user code.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve, relative, sep } from "node:path";
import { parseJsonc } from "./jsonc.ts";
import { workspaceRoot } from "./deploy-deps.ts";
import { inits, stackOf, vitePlugins, type Stack } from "./fit.ts";
import { inferStaticBuild } from "./build-script.ts";

export type Framework = "rwsdk" | "tanstack-start" | "astro" | "react-router" | "vite-react" | "vite" | "unknown";
export type PackageManager = "bun" | "pnpm" | "npm" | "yarn";

export interface Inferred {
  name: string;
  version: string;
  framework: Framework;
  /** The framework even when init doesn't support it (next, astro, ...), for a better refusal. */
  stack: Stack;
  pm: PackageManager;
  runCmd: (script: string) => string;
  /** Run a dependency's bin: bunx / pnpm exec / yarn / npx. */
  execCmd: (bin: string) => string;
  hasReact: boolean;
  hasThree: boolean;
  hasPrisma: boolean;
  hasBetterAuth: boolean;
  /** What says the app talks to Postgres (`pg`, `postgres`, Drizzle's or Prisma's postgresql), or null. */
  postgres: string | null;
  /** Node server frameworks it depends on (express, socket.io, ...): its frontend alone isn't the app. */
  serverDeps: string[];
  scripts: Record<string, string>;
  /** What the app's build runs before vite (prebuild, generators), to run before ours. */
  prebuild: string[];
  vite: {
    configPath: string | null;
    /** The `--config` the app's build passes to vite, as written; null for the default vite.config.*. */
    buildConfig: string | null;
    plugins: string[];
    root: string | null;
    outDir: string | null;
    aliases: Record<string, string>;
    desktopConfigPath: string | null;
    /** Paths `server.proxy` hands to another server in dev ("/api"): the build alone doesn't answer them. */
    proxy: string[];
    /** Each of those paths' target ("http://localhost:3001"), null when the config doesn't spell it out. */
    proxyTargets: Record<string, string | null>;
  };
  /** astro.config.*: its adapter by package name and its `output`. Null when there is no config. */
  astro: AstroInfo | null;
  /** React Router's buildDirectory (react-router.config.*), "build" by default. */
  reactRouterBuild: string;
  wranglerPath: string | null;
  /** Where app source lives. From tsconfig paths, then the vite "@" alias, then common names. */
  srcDir: string;
  /** Import aliases, e.g. { "@": "src", "~": "app" }. tsconfig paths first, vite second. */
  aliases: Record<string, string>;
  srcDirSource: "tsconfig" | "vite" | "guess";
  workerEntry: string | null;
  /** package.json declares workspaces (or pnpm-workspace.yaml exists): likely a monorepo root. */
  isWorkspaceRoot: boolean;
  hasPackageJson: boolean;
}

/** package.json, or a clear error naming the file when it exists but does not parse. */
export function readPackageJson(root: string): any | null {
  const p = join(root, "package.json");
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); }
  catch (e) { throw new Error(`${p} is not valid JSON (${(e as Error).message.split("\n")[0]}); fix it and re-run`); }
}

/**
 * tsconfig paths -> { alias: dir }. "@/*": ["./src/*"] becomes { "@": "src" }.
 * Follows relative `extends` (string or array), nearer configs win, and each
 * `paths` is resolved against the config that declares it.
 */
export function inferTsconfigAliases(root: string): Record<string, string> {
  const start = ["tsconfig.json", "jsconfig.json"].map((c) => join(root, c)).find(existsSync);
  return start ? readTsAliases(root, start, new Set()) : {};
}

function readTsAliases(root: string, file: string, seen: Set<string>): Record<string, string> {
  if (seen.has(file) || seen.size > 8) return {};
  seen.add(file);
  let j: any; try { j = parseJsonc(readFileSync(file, "utf8")); } catch { return {}; }
  const dir = dirname(file);
  const out: Record<string, string> = {};
  const parents: string[] = ([] as string[]).concat(j.extends ?? []);
  for (const e of parents) {
    if (!e.startsWith(".")) continue;   // package presets (@tsconfig/*) carry no app aliases
    const f = resolve(dir, e);
    const cand = [f, f + ".json"].find((c) => existsSync(c) && statSync(c).isFile());
    if (cand) Object.assign(out, readTsAliases(root, cand, seen));
  }
  const base = resolve(dir, j.compilerOptions?.baseUrl ?? ".");
  for (const [k, v] of Object.entries<any>(j.compilerOptions?.paths ?? {})) {
    const target = Array.isArray(v) ? v[0] : v;
    if (typeof target !== "string") continue;
    const alias = k.replace(/\/\*$/, "");
    const abs = resolve(base, target.replace(/\/\*$/, ""));
    const rel = relative(root, abs).split(sep).join("/") || ".";
    if (alias && !alias.includes("*")) out[alias] = rel;
  }
  return out;
}

function readJson(p: string): any | null {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

export function detectPm(root: string): PackageManager {
  if (existsSync(join(root, "bun.lock")) || existsSync(join(root, "bun.lockb"))) return "bun";
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(root, "yarn.lock"))) return "yarn";
  if (existsSync(join(root, "package-lock.json"))) return "npm";
  // No lockfile yet (fresh clone, or a monorepo child): the corepack field, then the install-time env.
  const declared = String(readJson(join(root, "package.json"))?.packageManager ?? "").split("@")[0];
  if (declared === "bun" || declared === "pnpm" || declared === "yarn" || declared === "npm") return declared;
  const ua = process.env.npm_config_user_agent?.split("/")[0];
  if (ua === "bun" || ua === "pnpm" || ua === "yarn") return ua;
  return "npm";
}

/**
 * vite's `root`, which `--outDir` resolves against: "public", resolve(__dirname, "public"),
 * or the shorthand `root,` after `const root = ...`. Null when unset or not read.
 */
export function viteRoot(src: string): string | null {
  const EXPR = String.raw`((?:[\w.]*(?:resolve|join))\([^)]*\)|["'][^"']+["'])`;
  let expr = src.match(new RegExp(String.raw`\broot:\s*` + EXPR))?.[1];
  if (!expr && /^\s*root\s*,/m.test(src)) expr = src.match(new RegExp(String.raw`\bconst\s+root\s*=\s*` + EXPR))?.[1];
  if (!expr) return null;
  const literal = expr.trim().match(/^["']([^"']+)["']$/)?.[1];
  if (literal) return literal.replace(/^\.\/?/, "") || null;
  // resolve(__dirname, "public") / path.join(import.meta.dirname, "src", "app"): the literal parts.
  const call = expr.match(/\b(?:resolve|join)\(([^)]*)\)/)?.[1];
  const parts = call ? [...call.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]!) : [];
  return parts.length ? parts.join("/").replace(/^\.\/?/, "") || null : null;
}

/** `buildConfig`: the config the app's build names (vite.app.config.ts), read instead of vite.config.*. */
export function inferVite(root: string, buildConfig: string | null = null) {
  const cands = ["vite.config.ts", "vite.config.mts", "vite.config.js", "vite.config.mjs"];
  if (buildConfig && !existsSync(join(root, buildConfig))) buildConfig = null;
  const configPath = buildConfig ? join(root, buildConfig) : cands.map((c) => join(root, c)).find(existsSync) ?? null;
  const desktopConfigPath = ["vite.desktop.config.ts", "vite.desktop.config.mts"].map((c) => join(root, c)).find(existsSync) ?? null;
  const out = { configPath, buildConfig, plugins: [] as string[], root: null as string | null, outDir: null as string | null, aliases: {} as Record<string, string>, desktopConfigPath, proxy: [] as string[], proxyTargets: {} as Record<string, string | null> };
  if (!configPath) return out;
  const src = readFileSync(configPath, "utf8");
  out.plugins = vitePlugins(src);
  out.proxy = viteProxyPaths(src);
  out.proxyTargets = viteProxyTargets(src);
  out.root = viteRoot(src);
  out.outDir = src.match(/\boutDir:\s*["']([^"']+)["']/)?.[1] ?? null;
  const dir = (d: string) => d.replace(/^\.\//, "").replace(/\/$/, "") || ".";
  for (const m of src.matchAll(/["'](@[\w/-]*|~)["']\s*:\s*(?:path\.)?resolve\([^,]+,\s*["']([^"']+)["']\)/g)) out.aliases[m[1]!] = dir(m[2]!);
  // "@": fileURLToPath(new URL("./src", import.meta.url))
  for (const m of src.matchAll(/["'](@[\w/-]*|~)["']\s*:\s*(?:\w+\.)?fileURLToPath\(\s*new\s+URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)\s*\)/g)) out.aliases[m[1]!] ??= dir(m[2]!);
  for (const m of src.matchAll(/["'](@[\w/-]*|~)["']\s*:\s*["']([^"']+)["']/g)) out.aliases[m[1]!] ??= dir(m[2]!);
  return out;
}

/** The keys of vite's `server.proxy` object ("/api", "^/ws/.*"), from the config's text. */
export function viteProxyPaths(src: string): string[] {
  const at = src.search(/\bproxy\s*:\s*\{/);
  if (at < 0) return [];
  const open = src.indexOf("{", at);
  let end = open;
  for (let depth = 0; end < src.length; end++) {
    if (src[end] === "{") depth++;
    else if (src[end] === "}" && --depth === 0) break;
  }
  // Drop the nested option objects ({ target, changeOrigin }) so only the top-level keys remain.
  let body = src.slice(open + 1, end);
  for (let prev = ""; prev !== body; ) { prev = body; body = body.replace(/\{[^{}]*\}/g, ""); }
  return [...body.matchAll(/["'`]([^"'`]+)["'`]\s*:/g)].map((m) => m[1]!);
}

export interface SiblingServer {
  dir: string;
  /** What starts it: its start script, or the frameworks it uses. */
  runs: string;
  /** The file it runs, from the app's folder ("../api/server.js", "api/server.js"), null when init can't find it. */
  entry: string | null;
  /** The port it listens on unless told otherwise. */
  port: number | null;
  /** Whether its entry reads PORT. One that doesn't keeps its own port. */
  readsPort: boolean;
}

/**
 * The servers a proxy's paths go to: its keys grouped by target port, each group given the sibling
 * server that listens there (or the one server there is, when the proxy has one target). Paths
 * no server found for are `left` for desktop/host.ts.
 */
export function proxyServers(targets: Record<string, string | null>, servers: SiblingServer[]) {
  const groups = new Map<string, string[]>();
  for (const [path, t] of Object.entries(targets)) {
    const k = String(targetPort(t) ?? t ?? "?");
    groups.set(k, [...(groups.get(k) ?? []), path]);
  }
  const runnable = servers.filter((s) => s.entry);
  const found: { server: SiblingServer; paths: string[]; port?: number }[] = [], left: string[] = [];
  for (const [k, paths] of groups) {
    const port = /^\d+$/.test(k) ? +k : null;
    const at = runnable.filter((s) => port !== null && s.port === port);
    const server = at.length === 1 ? at[0] : groups.size === 1 && runnable.length === 1 ? runnable[0] : undefined;
    if (!server || found.some((f) => f.server === server)) { left.push(...paths); continue; }
    // One that ignores PORT listens where the proxy pointed: the host proxies there too.
    found.push({ server, paths, ...(!server.readsPort && (server.port ?? port) ? { port: (server.port ?? port)! } : {}) });
  }
  return { found, left };
}

/**
 * Where each server.proxy key goes: its string value, or its options' `target`, or the first URL
 * in the declaration of the variable named there (`const backend = env.API ?? "http://localhost:3001"`).
 */
export function viteProxyTargets(src: string): Record<string, string | null> {
  const at = src.search(/\bproxy\s*:\s*\{/);
  if (at < 0) return {};
  const body = src.slice(src.indexOf("{", at) + 1);
  const url = (v: string | undefined): string | null => {
    if (!v) return null;
    const lit = v.match(/^["'`]([^"'`]+)["'`]$/)?.[1];
    if (lit) return lit;
    if (!/^[A-Za-z_$][\w$]*$/.test(v)) return null;
    return src.match(new RegExp(`\\b${v.replace(/\$/g, "\\$")}\\s*=[^;\\n]*?["'\`]((?:https?|wss?)://[^"'\`]+)["'\`]`))?.[1] ?? null;
  };
  const out: Record<string, string | null> = {};
  for (const key of viteProxyPaths(src)) {
    const q = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = body.match(new RegExp(`["'\`]${q}["'\`]\\s*:\\s*(\\{[^{}]*?\\btarget\\s*:\\s*([^,}\\s]+)|([^,{}\\s]+))`));
    out[key] = url(m?.[2] ?? m?.[3]);
  }
  return out;
}

/** The port a proxy target names ("http://localhost:3001" is 3001), null when it names none. */
export function targetPort(target: string | null): number | null {
  if (!target) return null;
  try {
    const u = new URL(target);
    return u.port ? +u.port : /^(https|wss):$/.test(u.protocol) ? 443 : 80;
  } catch { return null; }
}

/**
 * Folders beside `root`, or inside it, that look like the server its dev proxy points at: a
 * package.json with a Node server framework, or a `start` script that runs node.
 * "../api (node server.js)", "api (node server.js)".
 */
export function siblingServers(root: string): SiblingServer[] {
  const self = resolve(root);
  return [...serversIn(dirname(self), "../", (n) => join(dirname(self), n) !== self), ...serversIn(self, "", (n) => !NOT_SERVER_DIRS.has(n))];
}

/** An app's own folders that hold its source, assets, build output or tooling, never a server of its own. */
const NOT_SERVER_DIRS = new Set(["src", "public", "static", "assets", "dist", "build", "out", "coverage", "test", "tests", "e2e", "desktop", "scripts"]);

function serversIn(parent: string, prefix: string, keep: (name: string) => boolean): SiblingServer[] {
  const out: SiblingServer[] = [];
  let names: string[] = [];
  try { names = readdirSync(parent); } catch { return out; }
  for (const n of names.sort()) {
    const d = join(parent, n);
    if (n.startsWith(".") || n === "node_modules" || !keep(n)) continue;
    const pkg = readJson(join(d, "package.json"));
    if (!pkg) continue;
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    const fw = SERVER_DEPS.filter((x) => deps[x]);
    const start = String(pkg.scripts?.start ?? "");
    if (!fw.length && !/^(node|bun|tsx|ts-node)\s/.test(start)) continue;
    // The file it runs: `node server.js`'s first non-flag argument, else package.json main.
    const file = start.match(/^(?:node|bun|tsx|ts-node)\s+(?:-\S+\s+)*([^\s-]\S*\.[cm]?[jt]s)\b/)?.[1] ?? (typeof pkg.main === "string" ? pkg.main : null);
    const entry = file && existsSync(join(d, file)) ? `${prefix}${n}/${file.replace(/^\.\//, "")}` : null;
    // The port it listens on when PORT isn't set (`process.env.PORT || 3001`, `listen(3001)`).
    const code = entry ? readFileSync(join(d, file!), "utf8") : "";
    const port = code.match(/\bPORT\b[^\n;]*?(?:\|\||\?\?|=)\s*(\d{2,5})\b/)?.[1] ?? code.match(/\.listen\(\s*(\d{2,5})\b/)?.[1];
    out.push({ dir: `${prefix}${n}`, runs: start || fw.join(", "), entry, port: port ? +port : null, readsPort: /\bPORT\b/.test(code) });
  }
  return out;
}

/** Apps init can box one level down (frontend/, web/, apps/*, packages/*), for a repo root that isn't one. */
export function appsBelow(root: string): string[] {
  const kids = (d: string) => { try { return readdirSync(join(root, d), { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules").map((e) => d ? `${d}/${e.name}` : e.name); } catch { return []; } };
  const dirs = kids("").flatMap((d) => d === "apps" || d === "packages" ? kids(d) : [d]);
  return dirs.filter((d) => {
    if (!existsSync(join(root, d, "package.json"))) return false;
    try { return infer(join(root, d)).framework !== "unknown"; } catch { return false; }
  }).sort();
}

export interface AstroInfo {
  configPath: string;
  /** e.g. "@astrojs/cloudflare", "@astrojs/node"; null when the config sets none. */
  adapter: string | null;
  /** "static" when unset, as in Astro itself. */
  output: "static" | "server";
  /** The KV binding the Cloudflare adapter keeps sessions in. */
  sessionKV: string;
  /** The Images binding the adapter's /_image endpoint uses; null when imageService doesn't need one. */
  images: string | null;
}

/**
 * As @astrojs/cloudflare decides it: the binding is used when the runtime image
 * service is "cloudflare-binding", the default. `imageService` is a mode, or
 * { build, runtime } where runtime defaults to build ("compile" -> "passthrough").
 */
function astroNeedsImages(src: string): boolean {
  const m = src.match(/\bimageService:\s*(?:["']([^"']+)["']|\{([^}]*)\})/);
  if (!m) return true;
  if (m[1]) return m[1] === "cloudflare-binding";
  const field = (k: string) => m[2]!.match(new RegExp(`\\b${k}:\\s*["']([^"']+)["']`))?.[1];
  return (field("runtime") ?? field("build")) === "cloudflare-binding";
}

export function inferAstro(root: string): AstroInfo | null {
  const cands = ["astro.config.mjs", "astro.config.ts", "astro.config.mts", "astro.config.js", "astro.config.cjs"];
  const configPath = cands.map((c) => join(root, c)).find(existsSync) ?? null;
  if (!configPath) return null;
  const src = readFileSync(configPath, "utf8");
  const adapter = [...src.matchAll(/from\s+["'](@astrojs\/(?:cloudflare|node|vercel|netlify|deno)|[^"']*astro-adapter[^"']*)["']/g)][0]?.[1] ?? null;
  return {
    configPath, adapter,
    output: /\boutput:\s*["']server["']/.test(src) ? "server" : "static",
    sessionKV: src.match(/\bsessionKVBindingName:\s*["']([^"']+)["']/)?.[1] ?? "SESSION",
    images: astroNeedsImages(src) ? src.match(/\bimagesBindingName:\s*["']([^"']+)["']/)?.[1] ?? "IMAGES" : null,
  };
}

export function inferReactRouterBuild(root: string): string {
  const cfg = ["react-router.config.ts", "react-router.config.js", "react-router.config.mjs"].map((c) => join(root, c)).find(existsSync);
  const dir = cfg ? readFileSync(cfg, "utf8").match(/\bbuildDirectory:\s*["']([^"']+)["']/)?.[1] : undefined;
  return (dir ?? "build").replace(/^\.\//, "").replace(/\/$/, "");
}

/**
 * The Postgres client an app queries with, by what names it: a driver in package.json, or
 * Drizzle or Prisma set to postgresql. Neon's serverless driver is left out: it goes over
 * HTTP and needs no Hyperdrive.
 */
export function inferPostgres(root: string, deps: Record<string, string>): string | null {
  for (const d of ["pg", "postgres", "@prisma/adapter-pg"]) if (deps[d]) return d;
  const read = (f: string) => { try { return readFileSync(join(root, f), "utf8"); } catch { return ""; } };
  if (deps["drizzle-orm"] || deps["drizzle-kit"]) {
    const cfg = ["drizzle.config.ts", "drizzle.config.js", "drizzle.config.mjs", "drizzle.config.json"].map(read).join("\n");
    if (/\bdialect["']?\s*:\s*["']postgresql["']/.test(cfg)) return "drizzle (postgresql)";
  }
  if (deps["prisma"] || deps["@prisma/client"]) {
    const schema = ["prisma/schema.prisma", "schema.prisma"].map(read).join("\n");
    if (/\bprovider\s*=\s*["']postgres(?:ql)?["']/.test(schema)) return "prisma (postgresql)";
  }
  return null;
}

const SERVER_DEPS = ["express", "fastify", "koa", "socket.io", "@hono/node-server", "@nestjs/core", "@hapi/hapi"];

export function infer(root = process.cwd()): Inferred {
  const pkg = readPackageJson(root) ?? {};
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const staticBuild = inferStaticBuild(pkg.scripts ?? {});
  const vite = inferVite(root, staticBuild.config);
  let stack = stackOf(deps, vite.plugins);
  // A workspace member often gets vite from the root package.json (excalidraw-app): a vite
  // config here, or vite at the workspace root, still makes it a vite app.
  if (stack === "unknown") {
    const ws = workspaceRoot(root), top = ws ? readPackageJson(ws) ?? {} : {};
    const viaRoot = { ...(top.dependencies ?? {}), ...(top.devDependencies ?? {}) }["vite"];
    if (vite.configPath || viaRoot) stack = stackOf({ ...deps, vite: viaRoot ?? "*" }, vite.plugins);
  }
  const framework = (inits(stack, vite.plugins) ? stack : "unknown") as Framework;
  const pm = detectPm(root);
  const wranglerPath = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"].map((c) => join(root, c)).find(existsSync) ?? null;
  const tsAliases = inferTsconfigAliases(root);
  const aliases = { ...vite.aliases, ...tsAliases };   // tsconfig wins: it is what the framework and editor use
  let srcDir: string, srcDirSource: Inferred["srcDirSource"];
  const primary = aliases["@"] ?? aliases["~"];
  if (primary) { srcDir = primary; srcDirSource = tsAliases["@"] || tsAliases["~"] ? "tsconfig" : "vite"; }
  else { srcDir = ["src", "app", "lib", "client", "web"].find((d) => existsSync(join(root, d))) ?? "."; srcDirSource = "guess"; }
  const workerEntry = [`${srcDir}/worker.tsx`, `${srcDir}/worker.ts`, `${srcDir}/index.ts`, "worker.ts"].find((c) => existsSync(join(root, c))) ?? null;
  return {
    name: pkg.name ?? "app",
    version: pkg.version ?? "0.0.0",
    framework, stack, pm,
    runCmd: (s) => pm === "npm" ? `npm run ${s}` : `${pm} ${s}`,
    execCmd: (b) => pm === "bun" ? `bunx ${b}` : pm === "pnpm" ? `pnpm exec ${b}` : pm === "yarn" ? `yarn ${b}` : `npx ${b}`,
    hasReact: !!deps["react"] || framework === "rwsdk",
    hasThree: !!deps["three"],
    hasPrisma: !!deps["@prisma/client"] || !!deps["prisma"],
    hasBetterAuth: !!deps["better-auth"],
    postgres: inferPostgres(root, deps),
    serverDeps: SERVER_DEPS.filter((d) => deps[d]),
    scripts: pkg.scripts ?? {},
    prebuild: staticBuild.pre,
    vite, astro: inferAstro(root), reactRouterBuild: inferReactRouterBuild(root), wranglerPath, srcDir, aliases, srcDirSource, workerEntry,
    isWorkspaceRoot: !!pkg.workspaces || existsSync(join(root, "pnpm-workspace.yaml")),
    hasPackageJson: existsSync(join(root, "package.json")),
  };
}
