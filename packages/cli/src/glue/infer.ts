// Inference: read what the app already says about itself and don't ask twice.
//   package.json  -> framework, package manager, scripts, workspaces
//   vite.config.* -> plugins (rwsdk / cloudflare / react), root, outDir, aliases
//   wrangler.*    -> bindings, compat, assets   (see ../wrangler.ts)
// Everything is best-effort text analysis; nothing here executes user code.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, dirname, resolve, relative, sep } from "node:path";
import { parseJsonc } from "./jsonc.ts";
import { SUPPORTED, stackOf, vitePlugins, type Stack } from "./fit.ts";

export type Framework = "rwsdk" | "tanstack-start" | "astro" | "vite-react" | "vite" | "unknown";
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
  /** Node server frameworks it depends on (express, socket.io, ...): its frontend alone isn't the app. */
  serverDeps: string[];
  scripts: Record<string, string>;
  vite: {
    configPath: string | null;
    plugins: string[];
    root: string | null;
    outDir: string | null;
    aliases: Record<string, string>;
    desktopConfigPath: string | null;
  };
  /** astro.config.*: its adapter by package name and its `output`. Null when there is no config. */
  astro: AstroInfo | null;
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

export function inferVite(root: string) {
  const cands = ["vite.config.ts", "vite.config.mts", "vite.config.js", "vite.config.mjs"];
  const configPath = cands.map((c) => join(root, c)).find(existsSync) ?? null;
  const desktopConfigPath = ["vite.desktop.config.ts", "vite.desktop.config.mts"].map((c) => join(root, c)).find(existsSync) ?? null;
  const out = { configPath, plugins: [] as string[], root: null as string | null, outDir: null as string | null, aliases: {} as Record<string, string>, desktopConfigPath };
  if (!configPath) return out;
  const src = readFileSync(configPath, "utf8");
  out.plugins = vitePlugins(src);
  out.root = viteRoot(src);
  out.outDir = src.match(/\boutDir:\s*["']([^"']+)["']/)?.[1] ?? null;
  for (const m of src.matchAll(/["'](@[\w/-]*|~)["']\s*:\s*(?:path\.)?resolve\([^,]+,\s*["']([^"']+)["']\)/g)) out.aliases[m[1]!] = m[2]!;
  for (const m of src.matchAll(/["'](@[\w/-]*|~)["']\s*:\s*["']([^"']+)["']/g)) out.aliases[m[1]!] ??= m[2]!;
  return out;
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

const SERVER_DEPS = ["express", "fastify", "koa", "socket.io", "@hono/node-server", "@nestjs/core", "@hapi/hapi"];

export function infer(root = process.cwd()): Inferred {
  const pkg = readPackageJson(root) ?? {};
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const vite = inferVite(root);
  const stack = stackOf(deps, vite.plugins);
  const framework = (SUPPORTED.includes(stack) ? stack : "unknown") as Framework;
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
    serverDeps: SERVER_DEPS.filter((d) => deps[d]),
    scripts: pkg.scripts ?? {},
    vite, astro: inferAstro(root), wranglerPath, srcDir, aliases, srcDirSource, workerEntry,
    isWorkspaceRoot: !!pkg.workspaces || existsSync(join(root, "pnpm-workspace.yaml")),
    hasPackageJson: existsSync(join(root, "package.json")),
  };
}
