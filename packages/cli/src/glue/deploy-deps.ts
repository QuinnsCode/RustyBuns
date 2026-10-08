import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

// The Alchemy + Effect version set that is known to work together. Alchemy is
// beta and Effect is rc; carets drift across breaking changes within days, so
// every package here is pinned exactly and (on pnpm) forced via overrides.
// Bump this table when Alchemy bumps its peers.
export const DEPLOY_DEPS: Record<string, string> = {
  "alchemy": "2.0.0-beta.77",
  "effect": "4.0.0-rc.112",
  "@effect/platform-bun": "4.0.0-rc.112",
  "@effect/platform-node": "4.0.0-rc.112",
};
/** Transitive @effect/* packages that must match `effect` exactly. */
export const DEPLOY_OVERRIDES: Record<string, string> = {
  "effect": "4.0.0-rc.112",
  "@effect/platform-bun": "4.0.0-rc.112",
  "@effect/platform-node": "4.0.0-rc.112",
  "@effect/platform-node-shared": "4.0.0-rc.112",
  "@effect/vitest": "4.0.0-rc.112",
};

export function installCommand(pm: string, hasWorkspaceFile: boolean): string {
  const specs = Object.entries(DEPLOY_DEPS).map(([n, v]) => `${n}@${v}`).join(" ");
  switch (pm) {
    case "bun": return `bun add -d ${specs}`;
    case "pnpm": return `pnpm add -D${hasWorkspaceFile ? "w" : ""} ${specs}`;
    case "yarn": return `yarn add -D ${specs}`;
    default: return `npm i -D ${specs}`;
  }
}

/** pnpm and npm need overrides to pin transitive @effect/*; bun/yarn honor "resolutions"/"overrides" too. */
export function applyOverrides(pkg: any, pm: string): { pkg: any; changed: boolean } {
  const key = pm === "yarn" ? "resolutions" : "overrides";
  const target = pm === "pnpm" ? (pkg.pnpm ??= {}) : pkg;
  const before = JSON.stringify(target[key] ?? {});
  target[key] = { ...(target[key] ?? {}), ...DEPLOY_OVERRIDES };
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
