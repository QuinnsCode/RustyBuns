// One place that decides where the app source is: config.source wins,
// inference fills the rest. Used by init, add desktop, build desktop.
import type { RustyBunsConfig } from "../config.ts";
import { infer, type Inferred } from "./infer.ts";

export interface SourceLayout { dir: string; aliases: Record<string, string>; ignore: RegExp[]; from: string; inf: Inferred }

export function sourceLayout(root: string, cfg?: Partial<RustyBunsConfig>): SourceLayout {
  const inf = infer(root);
  const dir = cfg?.source?.dir ?? inf.srcDir;
  const aliases = { "@": dir, ...inf.aliases, ...(cfg?.source?.aliases ?? {}) };
  const ignore = [/node_modules/, /\.test\.[tj]sx?$/, /\.d\.ts$/, /\/scripts\//, ...(cfg?.source?.ignore ?? []).map((g) => new RegExp(g))];
  return { dir, aliases, ignore, from: cfg?.source?.dir ? "config" : inf.srcDirSource, inf };
}
