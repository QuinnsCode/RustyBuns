// Fails when a workspace's package.json asks for a version bun.lock doesn't have. `bun install --frozen-lockfile`
// (bun 1.4) lets an exact pin like "hono": "4.13.14" -> "4.13.16" through, so a PR that bumps only package.json
// (Dependabot's #4370) merges green, and then every `bun install` on the owner's Mac rewrites bun.lock and blocks
// the next `git pull`. Run by typecheck.yml on every PR.
//   bun scripts/lock-drift.ts      lists each mismatch; exit 1 if any (fix: bun install, commit bun.lock)
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { help } from "./help.ts";

const SECTIONS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;
type Deps = Partial<Record<(typeof SECTIONS)[number], Record<string, string>>>;

const isDeps = (v: unknown): v is Record<string, string> =>
  typeof v === "object" && v !== null && Object.values(v).every((s) => typeof s === "string");
const sections = (v: unknown): Deps => {
  const out: Deps = {};
  if (typeof v !== "object" || v === null) return out;
  for (const k of SECTIONS) { const d: unknown = Reflect.get(v, k); if (isDeps(d)) out[k] = d; }
  return out;
};

/** Each place under `root` where a workspace's package.json and bun.lock disagree, as "<workspace> <section> <name>: <package.json> vs <lock>". */
export async function drift(root: string): Promise<string[]> {
  const lock: unknown = (await import(join(root, "bun.lock"))).default;
  const spaces: unknown = typeof lock === "object" && lock !== null ? Reflect.get(lock, "workspaces") : undefined;
  if (typeof spaces !== "object" || spaces === null) return ["bun.lock has no workspaces"];
  const out: string[] = [];
  for (const [dir, locked] of Object.entries(spaces)) {
    const file = join(root, dir, "package.json");
    if (!existsSync(file)) { out.push(`${dir || "(root)"}: in bun.lock, but there is no package.json`); continue; }
    const want = sections(JSON.parse(readFileSync(file, "utf8"))), have = sections(locked);
    for (const k of SECTIONS) {
      const a = want[k] ?? {}, b = have[k] ?? {};
      for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (a[name] !== b[name]) out.push(`${dir || "(root)"} ${k} ${name}: ${a[name] ?? "(none)"} in package.json vs ${b[name] ?? "(none)"} in bun.lock`);
      }
    }
  }
  return out;
}

if (import.meta.main) {
  help(import.meta.path);
  const found = await drift(join(import.meta.dir, ".."));
  if (!found.length) console.log("bun.lock matches every workspace's package.json");
  else {
    console.log(found.join("\n"));
    console.log(`\n${found.length} out of step: run bun install and commit bun.lock with the package.json change`);
    process.exit(1);
  }
}
