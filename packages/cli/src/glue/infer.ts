// Inference: read what the app already says about itself and don't ask twice.
//   package.json  -> framework, package manager, scripts, workspaces
//   vite.config.* -> plugins (rwsdk / cloudflare / react), root, outDir, aliases
//   wrangler.*    -> bindings, compat, assets   (see ../wrangler.ts)
// Everything is best-effort text analysis; nothing here executes user code.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseJsonc } from "./jsonc.ts";

export type Framework = "rwsdk" | "tanstack-start" | "vite-react" | "vite" | "unknown";
export type PackageManager = "bun" | "pnpm" | "npm" | "yarn";

export interface Inferred {
  name: string;
  version: string;
  framework: Framework;
  pm: PackageManager;
  runCmd: (script: string) => string;
  /** Run a dependency's bin: bunx / pnpm exec / yarn / npx. */
  execCmd: (bin: string) => string;
  hasReact: boolean;
  hasThree: boolean;
  hasPrisma: boolean;
  hasBetterAuth: boolean;
  scripts: Record<string, string>;
  vite: {
    configPath: string | null;
    plugins: string[];
    root: string | null;
    outDir: string | null;
    aliases: Record<string, string>;
    desktopConfigPath: string | null;
  };
  wranglerPath: string | null;
  /** Where app source lives. From tsconfig paths, then the vite "@" alias, then common names. */
  srcDir: string;
  /** Import aliases, e.g. { "@": "src", "~": "app" }. tsconfig paths first, vite second. */
  aliases: Record<string, string>;
  srcDirSource: "tsconfig" | "vite" | "guess";
  workerEntry: string | null;
}

/** tsconfig paths -> { alias: dir }. "@/*": ["./src/*"] becomes { "@": "src" }. */
export function inferTsconfigAliases(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const cfg = ["tsconfig.json", "jsconfig.json"].map((c) => join(root, c)).find(existsSync);
  if (!cfg) return out;
  let j: any; try { j = parseJsonc(readFileSync(cfg, "utf8")); } catch { return out; }
  const baseUrl: string = j.compilerOptions?.baseUrl ?? ".";
  for (const [k, v] of Object.entries<any>(j.compilerOptions?.paths ?? {})) {
    const target = Array.isArray(v) ? v[0] : v;
    if (typeof target !== "string") continue;
    const alias = k.replace(/\/\*$/, "");
    const dir = join(baseUrl, target.replace(/^\.\//, "").replace(/\/\*$/, "")).replace(/^\.\//, "");
    if (alias && !alias.includes("*")) out[alias] = dir;
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
  return "npm";
}

export function inferVite(root: string) {
  const cands = ["vite.config.ts", "vite.config.mts", "vite.config.js", "vite.config.mjs"];
  const configPath = cands.map((c) => join(root, c)).find(existsSync) ?? null;
  const desktopConfigPath = ["vite.desktop.config.ts", "vite.desktop.config.mts"].map((c) => join(root, c)).find(existsSync) ?? null;
  const out = { configPath, plugins: [] as string[], root: null as string | null, outDir: null as string | null, aliases: {} as Record<string, string>, desktopConfigPath };
  if (!configPath) return out;
  const src = readFileSync(configPath, "utf8");
  // plugin imports, by package name
  for (const m of src.matchAll(/from\s+["']([^"']+)["']/g)) {
    const pkg = m[1]!;
    if (/rwsdk\/vite|redwood/.test(pkg)) out.plugins.push("rwsdk");
    else if (/@cloudflare\/vite-plugin/.test(pkg)) out.plugins.push("cloudflare");
    else if (/@vitejs\/plugin-react/.test(pkg)) out.plugins.push("react");
    else if (/@tanstack\/(react-)?start/.test(pkg)) out.plugins.push("tanstack-start");
    else if (/@tailwindcss\/vite/.test(pkg)) out.plugins.push("tailwind");
  }
  out.root = src.match(/\broot:\s*["']([^"']+)["']/)?.[1] ?? null;
  out.outDir = src.match(/\boutDir:\s*["']([^"']+)["']/)?.[1] ?? null;
  for (const m of src.matchAll(/["'](@[\w/-]*|~)["']\s*:\s*(?:path\.)?resolve\([^,]+,\s*["']([^"']+)["']\)/g)) out.aliases[m[1]!] = m[2]!;
  for (const m of src.matchAll(/["'](@[\w/-]*|~)["']\s*:\s*["']([^"']+)["']/g)) out.aliases[m[1]!] ??= m[2]!;
  return out;
}

export function infer(root = process.cwd()): Inferred {
  const pkg = readJson(join(root, "package.json")) ?? {};
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const vite = inferVite(root);
  const framework: Framework =
    deps["rwsdk"] || vite.plugins.includes("rwsdk") ? "rwsdk"
    : deps["@tanstack/react-start"] || deps["@tanstack/start"] || vite.plugins.includes("tanstack-start") ? "tanstack-start"
    : deps["vite"] && deps["react"] ? "vite-react"
    : deps["vite"] ? "vite" : "unknown";
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
    framework, pm,
    runCmd: (s) => pm === "npm" ? `npm run ${s}` : `${pm} ${s}`,
    execCmd: (b) => pm === "bun" ? `bunx ${b}` : pm === "pnpm" ? `pnpm exec ${b}` : pm === "yarn" ? `yarn ${b}` : `npx ${b}`,
    hasReact: !!deps["react"] || framework === "rwsdk",
    hasThree: !!deps["three"],
    hasPrisma: !!deps["@prisma/client"] || !!deps["prisma"],
    hasBetterAuth: !!deps["better-auth"],
    scripts: pkg.scripts ?? {},
    vite, wranglerPath, srcDir, aliases, srcDirSource, workerEntry,
  };
}
