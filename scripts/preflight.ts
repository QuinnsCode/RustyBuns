// Before you open a PR: which other open PRs change the same files as this branch? (#3118)
// Cheap and fast (one `gh pr list`, one `git diff`): the file overlap that Mervin's board would
// turn into merge cards. A shared file is a reason to look, not a verdict: for the per-file
// verdict run what it prints last, `bun apps/codesplitter/scripts/mervin-board.ts <PR numbers>`.
//
//   bun scripts/preflight.ts [--base origin/main] [--json]
//
// Exits 1 when another open PR shares a file you changed (so a hook can stop and ask), 0 otherwise.
// Generated and lock files are listed apart: they are expected to clash and are regenerated.

export interface OpenPr { number: number; title: string; headRefName: string; files: { path: string }[] }
export interface Overlap { pr: number; title: string; files: string[] }

/** Files that every PR may touch and that are rebuilt, not merged by hand. */
export const GENERATED = [/(^|\/)bun\.lock$/, /(^|\/)package-lock\.json$/, /(^|\/)REFERENCE\.md$/, /^README\.md$/];

/** The open PRs sharing at least one non-generated file with `mine`, most shared first; `branch` is skipped (your own PR). */
export function overlaps(mine: string[], prs: OpenPr[], branch = ""): { clash: Overlap[]; generated: Overlap[] } {
  const own = new Set(mine);
  const clash: Overlap[] = [], generated: Overlap[] = [];
  for (const p of prs) {
    if (p.headRefName === branch) continue;
    const shared = p.files.map((f) => f.path).filter((f) => own.has(f));
    const real = shared.filter((f) => !GENERATED.some((g) => g.test(f)));
    if (real.length) clash.push({ pr: p.number, title: p.title, files: real });
    else if (shared.length) generated.push({ pr: p.number, title: p.title, files: shared });
  }
  clash.sort((a, b) => b.files.length - a.files.length);
  return { clash, generated };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const base = args.includes("--base") ? args[args.indexOf("--base") + 1]! : "origin/main";
  const run = (cmd: string[]) => {
    const r = Bun.spawnSync(cmd, { stderr: "pipe" });
    if (r.exitCode !== 0) { console.error(`${cmd.join(" ")}: ${r.stderr.toString().trim()}`); process.exit(2); }
    return r.stdout.toString();
  };
  const mine = run(["git", "diff", "--name-only", `${base}...HEAD`]).split("\n").filter(Boolean);
  const branch = run(["git", "rev-parse", "--abbrev-ref", "HEAD"]).trim();
  const prs = JSON.parse(run(["gh", "pr", "list", "--state", "open", "--limit", "100", "--json", "number,title,headRefName,files"])) as OpenPr[];
  const { clash, generated } = overlaps(mine, prs, branch);
  if (args.includes("--json")) console.log(JSON.stringify({ clash, generated }, null, 2));
  else {
    for (const o of clash) console.log(`#${o.pr} ${o.title}\n  also changes: ${o.files.slice(0, 8).join(", ")}${o.files.length > 8 ? ` (+${o.files.length - 8})` : ""}`);
    for (const o of generated) console.log(`#${o.pr} shares only generated files (${o.files.join(", ")}): regenerate after merging main`);
    if (clash.length) console.log(`\nWait for them to merge, or check the files: bun apps/codesplitter/scripts/mervin-board.ts ${clash.map((o) => o.pr).join(" ")}`);
    else console.log("no other open PR changes your files");
  }
  process.exit(clash.length ? 1 : 0);
}
