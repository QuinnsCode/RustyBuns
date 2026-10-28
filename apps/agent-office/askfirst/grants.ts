// What the owner said "always" to (#2498): one row per repo, kind of write and worker ("*" is any worker), kept in
// <dataDir>/grants.json where connect/ can list it. No row, no write without asking.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isKind, type Kind } from "./kinds.ts";

export interface Grant { repo: string; kind: Kind; who: string; at: number }

const file = (dir: string) => path.join(dir, "grants.json");

/** The saved grants; a missing or damaged file is no grants (every write then asks). */
export function readGrants(dir: string): Grant[] {
  if (!existsSync(file(dir))) return [];
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(file(dir), "utf8")); } catch { return []; }
  const rows = typeof raw === "object" && raw !== null && "grants" in raw && Array.isArray(raw.grants) ? raw.grants : [];
  return rows.flatMap((r: unknown): Grant[] => {
    if (typeof r !== "object" || r === null) return [];
    const { repo, kind, who, at } = r as Record<string, unknown>;
    return typeof repo === "string" && isKind(kind) && typeof who === "string" && typeof at === "number" ? [{ repo, kind, who, at }] : [];
  });
}

const same = (a: Pick<Grant, "repo" | "kind" | "who">, b: Pick<Grant, "repo" | "kind" | "who">) => a.repo === b.repo && a.kind === b.kind && a.who === b.who;

export const granted = (grants: Grant[], repo: string, kind: Kind, who: string) =>
  grants.some((g) => g.repo === repo && g.kind === kind && (g.who === "*" || g.who === who));

export function addGrants(dir: string, add: Omit<Grant, "at">[], at = Date.now()) {
  const all = readGrants(dir);
  for (const g of add) if (!all.some((x) => same(x, g))) all.push({ ...g, at });
  writeFileSync(file(dir), JSON.stringify({ grants: all }, null, 2));
  return all;
}

export function removeGrant(dir: string, g: Omit<Grant, "at">) {
  const all = readGrants(dir).filter((x) => !same(x, g));
  writeFileSync(file(dir), JSON.stringify({ grants: all }, null, 2));
  return all;
}
