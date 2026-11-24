// Start CI on a PR whose head got no checks: `bun run kick <n>` puts one empty commit on top of the PR's branch and
// pushes it. The after workflow (scripts/after.ts) pushes its merge of main with the workflow's own token, which starts
// no workflows (.github/workflows/after.yml, #5733, QuinnsCode/rustybuns-manual#120); `bun run pr <n>` says when a head
// is that bot's. This is the owner's one-liner for it.
//
// It never touches the working tree or checks anything out: it fetches the branch into a private ref
// (refs/rustybuns-kick/<n>), builds the commit with `git commit-tree` on that tree, pushes it as a plain fast-forward
// (never a force), and deletes the ref. Open PRs from this repo only; a fork's branch isn't ours to push.
//
//   bun run kick 5840            push the empty commit, print its sha
//   bun run kick 5840 --dry-run  say what it would push, push nothing
import { KICK_MESSAGE, sh } from "./after.ts";
import { help } from "./help.ts";
import { bool, check, obj, oneOf, str } from "../packages/util/src/guard.ts";

const View = obj({ headRefName: str(200), state: oneOf(["OPEN", "CLOSED", "MERGED"]), isCrossRepository: bool(false) });

/** `<n> [--dry-run]`, or why not. */
export function parseArgs(argv: string[]): { pr: number; dry: boolean } | { error: string } {
  const dry = argv.includes("--dry-run");
  const rest = argv.filter((a) => a !== "--dry-run");
  const unknown = rest.find((a) => a.startsWith("-"));
  if (unknown) return { error: `unknown flag ${unknown}` };
  if (rest.length !== 1 || !/^#?\d+$/.test(rest[0])) return { error: "usage: bun run kick <pr> [--dry-run]" };
  return { pr: Number(rest[0].replace("#", "")), dry };
}

function run(cmd: string[]): string {
  const r = sh(cmd);
  if (r.code !== 0) throw new Error(`${cmd.slice(0, 3).join(" ")}: ${r.out.trim()}`);
  return r.out.trim();
}

export function kick(pr: number, dry: boolean): string {
  const view = check(View, JSON.parse(run(["gh", "pr", "view", String(pr), "--json", "headRefName,state,isCrossRepository"])));
  if (!view) throw new Error(`gh pr view ${pr}: not the shape expected`);
  if (view.state !== "OPEN") throw new Error(`#${pr} is ${view.state.toLowerCase()}, not open`);
  if (view.isCrossRepository) throw new Error(`#${pr} comes from a fork; its branch isn't ours to push`);
  if (view.headRefName === "main") throw new Error(`#${pr}'s head is main`);
  const branch = view.headRefName, ref = `refs/rustybuns-kick/${pr}`;
  run(["git", "fetch", "-q", "--no-tags", "origin", `+refs/heads/${branch}:${ref}`]);
  try {
    const head = run(["git", "rev-parse", ref]);
    const sha = run(["git", "commit-tree", `${ref}^{tree}`, "-p", ref, "-m", KICK_MESSAGE]);
    if (dry) return `would push ${sha.slice(0, 9)} on ${branch} (head ${head.slice(0, 9)}); nothing pushed`;
    run(["git", "push", "-q", "origin", `${sha}:refs/heads/${branch}`]);
    return `pushed ${sha.slice(0, 9)} on ${branch}; checks: bun run pr ${pr}`;
  } finally {
    sh(["git", "update-ref", "-d", ref]);
  }
}

if (import.meta.main) {
  help(import.meta.path);
  const args = parseArgs(process.argv.slice(2));
  if ("error" in args) { console.error(args.error); process.exit(2); }
  try { console.log(kick(args.pr, args.dry)); }
  catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); }
}
