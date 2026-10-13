// One place that decides where the app source is: config.source wins,
// inference fills the rest. Used by init, add desktop, build desktop.
import { readdirSync, type Dirent } from "node:fs";
import { join } from "node:path";
import type { RustyBunsConfig } from "../config.ts";
import { infer, type Inferred } from "./infer.ts";

export interface SourceLayout { dir: string; aliases: Record<string, string>; ignore: RegExp[]; from: string; inf: Inferred }

export function sourceLayout(root: string, cfg?: Partial<RustyBunsConfig>): SourceLayout {
  const inf = infer(root);
  const dir = cfg?.source?.dir ?? inf.srcDir;
  const aliases = { "@": dir, ...inf.aliases, ...(cfg?.source?.aliases ?? {}) };
  const ignore = [/node_modules/, /(^|\/)(dist|\.rustybuns)\//, /\.test\.[tj]sx?$/, /\.d\.ts$/, /\/scripts\//, ...(cfg?.source?.ignore ?? []).map((g) => new RegExp(g))];
  return { dir, aliases, ignore, from: cfg?.source?.dir ? "config" : inf.srcDirSource, inf };
}

const SCRIPT = /\.[mc]?[jt]sx?$/;

/**
 * Names under `dir` that differ only by case: `factBar.ts` and `FactBar.tsx`, or `Components/`
 * and `components/`. Linux builds them; macOS's case-insensitive disk resolves `./FactBar` to
 * whichever comes first, and the build fails somewhere confusing (#1198). Scripts compare
 * without their extension, as an import names them. Each group is root-relative paths.
 */
export function caseCollisions(root: string, dir: string): string[][] {
  const out: string[][] = [];
  const walk = (rel: string) => {
    let entries: Dirent[];
    try { entries = readdirSync(join(root, rel), { withFileTypes: true }); } catch { return; }
    const groups = new Map<string, Map<string, string[]>>();
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const stem = e.isFile() && SCRIPT.test(e.name) ? e.name.replace(SCRIPT, "") : e.name;
      const byCase = groups.get(stem.toLowerCase()) ?? new Map<string, string[]>();
      groups.set(stem.toLowerCase(), byCase.set(stem, [...(byCase.get(stem) ?? []), e.name]));
      if (e.isDirectory() && e.name !== "dist") walk(rel === "." ? e.name : `${rel}/${e.name}`);
    }
    for (const byCase of groups.values())
      if (byCase.size > 1) out.push([...byCase.values()].flat().sort().map((n) => (rel === "." ? n : `${rel}/${n}`)));
  };
  walk(dir.replace(/^\.\//, "").replace(/\/$/, "") || ".");
  return out;
}
