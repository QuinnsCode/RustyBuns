import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { maybe, obj, opt, rec, str } from "@rustybuns/shell-bun/guard";

// The Alchemy + Effect version set that is known to work together. Alchemy is
// beta and Effect is rc; carets drift across breaking changes within days, so
// every package here is pinned exactly and (on pnpm) forced via overrides.
// Bump this table when Alchemy bumps its peers.
export const DEPLOY_DEPS: Record<string, string> = {
  "alchemy": "2.0.0-beta.84",
  // Providers are their own packages since beta.84; the generated stack imports whichever its config uses.
  "@alchemy.run/cloudflare": "2.0.0-beta.84",
  "@alchemy.run/hetzner": "2.0.0-beta.84",
  "@alchemy.run/railway": "2.0.0-beta.84",
  "@alchemy.run/neon": "2.0.0-beta.84",
  // Alchemy's optional peer, loaded by the Railway provider even for a plain Service.
  "@alchemy.run/frontend-frameworks": "2.0.0-beta.84",
  "effect": "4.0.5",
  "@effect/platform-bun": "4.0.5",
  "@effect/platform-node": "4.0.5",
};
/** Transitive @effect/* packages that must match `effect` exactly. */
export const DEPLOY_OVERRIDES: Record<string, string> = {
  "effect": "4.0.5",
  "@effect/platform-bun": "4.0.5",
  "@effect/platform-node": "4.0.5",
  "@effect/platform-node-shared": "4.0.5",
  "@effect/vitest": "4.0.5",
};

/** A package.json's dependencies and devDependencies, as name -> version. */
const Deps = obj({ dependencies: opt(rec(str())), devDependencies: opt(rec(str())) });
export function pkgDeps(pkg: unknown): Record<string, string> {
  const d = maybe(Deps)(pkg);
  return { ...d?.dependencies, ...d?.devDependencies };
}

/** The Alchemy and Effect versions an app already pins exactly, or null. */
export interface OwnDeploySet { alchemy: string; effect: string }

const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;
const major = (v: string) => v.split(".")[0];

/**
 * An app that brings its own Alchemy 2 + Effect 4, pinned exactly (a Rat Stack app, or any project
 * on that toolchain): its versions, or null. Such an app keeps them. `add deploy` adds only the
 * packages it is missing, at its versions, and writes no overrides. A range, a `catalog:` or
 * another major gets the pinned set.
 */
export function ownDeploySet(deps: Record<string, string>): OwnDeploySet | null {
  const alchemy = deps.alchemy, effect = deps.effect;
  if (alchemy === undefined || effect === undefined) return null;
  if (!EXACT.test(alchemy) || !EXACT.test(effect)) return null;
  if (major(alchemy) !== major(DEPLOY_DEPS.alchemy!) || major(effect) !== major(DEPLOY_DEPS.effect!)) return null;
  return { alchemy, effect };
}

/** What `add deploy` installs: the pinned set, or, for an app with its own set, only what it lacks, at its versions. */
export function deployDeps(deps: Record<string, string>): Record<string, string> {
  const own = ownDeploySet(deps);
  if (!own) return DEPLOY_DEPS;
  const out: Record<string, string> = {};
  for (const name of Object.keys(DEPLOY_DEPS)) {
    if (deps[name] !== undefined) continue;
    out[name] = name === "effect" || name.startsWith("@effect/") ? own.effect : own.alchemy;
  }
  return out;
}

export function installCommand(pm: string, hasWorkspaceFile: boolean, deps: Record<string, string> = DEPLOY_DEPS): string | null {
  if (!Object.keys(deps).length) return null;
  const specs = Object.entries(deps).map(([n, v]) => `${n}@${v}`).join(" ");
  switch (pm) {
    case "bun": return `bun add -d ${specs}`;
    case "pnpm": return `pnpm add -D${hasWorkspaceFile ? "w" : ""} ${specs}`;
    case "yarn": return `yarn add -D ${specs}`;
    // Exact, or npm saves ^ranges that its own EOVERRIDE check rejects against the exact overrides.
    default: return `npm i -D -E ${specs}`;
  }
}

/** pnpm and npm need overrides to pin transitive @effect/*; bun/yarn honor "resolutions"/"overrides" too. */
export function applyOverrides(pkg: any, pm: string): { pkg: any; changed: boolean } {
  const key = pm === "yarn" ? "resolutions" : "overrides";
  const target = pm === "pnpm" ? (pkg.pnpm ??= {}) : pkg;
  const before = JSON.stringify(target[key] ?? {});
  // npm overrides nest (a package can hold its own map), so the values stay unknown: only our pins are strings.
  const next: Record<string, unknown> = { ...(target[key] ?? {}) };
  // A range that already covers the pin stays: narrowing a monorepo root's "^4.0.5" to "4.0.5" would downgrade every app (#3803).
  for (const [name, pin] of Object.entries(DEPLOY_OVERRIDES)) {
    const have = next[name];
    if (typeof have !== "string" || !Bun.semver.satisfies(pin, have)) next[name] = pin;
  }
  target[key] = next;
  return { pkg, changed: before !== JSON.stringify(target[key]) };
}

/**
 * The workspace root `dir` is a member of, or null. Bun, npm and yarn only honour
 * `overrides`/`resolutions` in the ROOT package.json: written into a member they
 * are silently ignored, and Alchemy then fails to load its peers (a transitive
 * @effect/* resolves to a version that cannot find `effect`).
 */
export function workspaceRoot(dir: string): string | null {
  const start = resolve(dir);
  for (let d = dirname(start); ; d = dirname(d)) {
    const pkgPath = join(d, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const ws = JSON.parse(readFileSync(pkgPath, "utf8")).workspaces;
        const patterns: string[] = Array.isArray(ws) ? ws : Array.isArray(ws?.packages) ? ws.packages : [];
        const rel = relative(d, start).split("\\").join("/");
        if (patterns.some((p) => !p.startsWith("!") && new Bun.Glob(p.replace(/\/$/, "")).match(rel))) return d;
      } catch { /* not a readable package.json: keep walking */ }
    }
    if (existsSync(join(d, "pnpm-workspace.yaml"))) return d;
    if (dirname(d) === d) return null;
  }
}
