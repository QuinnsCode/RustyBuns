// Which apps a change to packages/ can break: `bun scripts/ci-dependents.ts <file...>` prints them, one per line.
// A package's code changed (its docs and Markdown don't count), so every app that uses it, or uses a package that
// does, gets tested: not all 64. Using is any file that says `@rustybuns/<name>` or `packages/<name>/`, so an app
// importing by a relative path counts too. Saying it without using it only costs an extra test, never a missed one.
import { help } from "./help.ts";

/** The packages whose code a diff changed: a docs folder, Markdown and plain text are not code. */
export function changedPackages(files: string[]): Set<string> {
  const out = new Set<string>();
  for (const f of files) {
    const m = f.match(/^packages\/([^/]+)\/(.+)$/);
    if (m && !/(^|\/)docs\//.test(m[2]!) && !/\.(md|txt)$/i.test(m[2]!)) out.add(m[1]!);
  }
  return out;
}

/**
 * The apps that use any of `start`, directly or through another package. `users(names)` gives the paths of the files
 * that name any of those packages (git grep on the real tree).
 */
export async function dependents(start: Set<string>, users: (names: string[]) => Promise<string[]>): Promise<Set<string>> {
  const pkgs = new Set(start), apps = new Set<string>();
  let fresh = [...start];
  while (fresh.length) {
    const next: string[] = [];
    for (const f of await users(fresh)) {
      const [top, name] = f.split("/");
      if (top === "apps" && name) apps.add(name);
      else if (top === "packages" && name && !pkgs.has(name)) { pkgs.add(name); next.push(name); }
    }
    fresh = next;
  }
  return apps;
}

/** The files in apps/ and packages/ (not their Markdown) that name any of these packages. */
export async function gitUsers(names: string[], cwd = process.cwd()): Promise<string[]> {
  const alt = names.map((n) => n.replace(/[^a-z0-9-]/gi, "")).join("|");
  const r = Bun.spawnSync(["git", "grep", "-lE", `@rustybuns/(${alt})(["/]|$)|packages/(${alt})/`, "--", "apps/", "packages/", ":!*.md"], { cwd, stdout: "pipe" });
  // git grep exits 1 when nothing matches
  return r.exitCode > 1 ? Promise.reject(new Error(`git grep failed (${r.exitCode})`)) : r.stdout.toString().split("\n").filter(Boolean);
}

if (import.meta.main) {
  help(import.meta.path);
  for (const app of [...await dependents(changedPackages(process.argv.slice(2)), (n) => gitUsers(n))].sort()) console.log(app);
}
