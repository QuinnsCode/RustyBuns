// Two migrations with the same number in one app (`0004_saves.sql` and `0004_party_seats.sql`) are
// a merge conflict nobody sees: two PRs each took the next number (#3115, #3120). D1 applies files by
// name, so the old pairs below already ran and must keep their names. A new pair fails CI; name new
// migrations by timestamp (`20261103120000_name.sql`), as codeSplitter does, and two never meet.
//
//   bun scripts/migration-numbers.ts     exit 1 on a clash not in KNOWN
import { readdirSync } from "node:fs";
import { join } from "node:path";

/** Pairs that shipped before this check. Applied in D1, so renaming them would run them twice. */
export const KNOWN = new Set([
  "apps/codesplitter/migrations 0025", "apps/codesplitter/migrations 0035", "apps/codesplitter/migrations 0037",
  "apps/codesplitter/migrations 0038", "apps/codesplitter/migrations 0040", "apps/codesplitter/migrations 0041",
  "apps/codesplitter/migrations 0052", "apps/codesplitter/migrations 0056", "apps/eqosys/migrations 0004",
]);

/** The numbers that more than one file in a folder starts with. Timestamps (8+ digits) never count. */
export function clashes(files: string[]): string[] {
  const seen = new Map<string, number>();
  for (const f of files) {
    const n = /^(\d{1,7})_.*\.sql$/.exec(f)?.[1];
    if (n) seen.set(n, (seen.get(n) ?? 0) + 1);
  }
  return [...seen].filter(([, c]) => c > 1).map(([n]) => n).sort();
}

function dirs(root: string): string[] {
  const out: string[] = [];
  for (const app of readdirSync(join(root, "apps"), { withFileTypes: true })) {
    if (!app.isDirectory()) continue;
    for (const sub of ["migrations", "drizzle/migrations"]) {
      try { readdirSync(join(root, "apps", app.name, sub)); out.push(`apps/${app.name}/${sub}`); } catch {}
    }
  }
  return out;
}

if (import.meta.main) {
  const root = join(import.meta.dir, "..");
  const bad = dirs(root).flatMap((d) => clashes(readdirSync(join(root, d))).map((n) => `${d} ${n}`)).filter((k) => !KNOWN.has(k));
  for (const k of bad) {
    const [d, n] = k.split(" ");
    console.error(`${d}: two migrations are numbered ${n}. Rename yours to a timestamp (${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}_name.sql).`);
  }
  if (bad.length) process.exit(1);
  console.log("migration numbers: no new clashes");
}
