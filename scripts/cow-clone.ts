// A worktree's checkout wrote 1.2 GB of this repo again for every hire, while `node_modules` (4 GB) cost nothing, since
// bun already clones it from its cache. So a hire adds its worktree with `--no-checkout` and fills it by cloning the
// floor checkout's files, copy-on-write (APFS, Btrfs, XFS). Git then hashes every cloned file and writes the ones that are
// missing or differ, so a floor checkout that is behind or edited, or a disk that can't clone, costs space, never
// correctness. The clone is forced: bun 1.4's plain `COPYFILE_FICLONE` copies a small file instead (under ~128 KB here,
// 260 MB of this repo).
import { execFileSync } from "node:child_process";
import { constants, copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";

/** `path → "mode oid"` for the plain files in a `-z` listing from `ls-files -s` or `ls-tree -r`. */
function blobs(listing: string) {
  const out = new Map<string, string>();
  for (const entry of listing.split("\0")) {
    const tab = entry.indexOf("\t");
    // ls-files: "mode oid stage"; ls-tree: "mode blob oid". Symlinks and submodules are left to git.
    const [mode, second, third] = entry.slice(0, tab).split(" ");
    const oid = second === "blob" ? third : third === "0" ? second : undefined;
    if (oid && mode?.startsWith("100")) out.set(entry.slice(tab + 1), `${mode} ${oid}`);
  }
  return out;
}

/**
 * Fills `tree`, a worktree added with `--no-checkout`, from the checkout at `source`. Each git call gets `ms`.
 * Returns how many files were cloned. Throws git's own error when the checkout can't be finished.
 */
export function fillWorktree(source: string, tree: string, ms = 5 * 60_000): number {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: ms, maxBuffer: 256 * 1024 * 1024 });
  const have = blobs(git(source, "ls-files", "-s", "-z"));
  const made = new Set<string>();
  let cloned = 0;
  for (const [file, blob] of blobs(git(tree, "ls-tree", "-r", "-z", "HEAD"))) {
    if (have.get(file) !== blob) continue;
    const to = path.join(tree, file), dir = path.dirname(to);
    try {
      if (!made.has(dir)) { mkdirSync(dir, { recursive: true }); made.add(dir); }
      copyFileSync(path.join(source, file), to, constants.COPYFILE_FICLONE_FORCE);
      cloned++;
    } catch {} // no cloning on this disk, or gone from the source: git writes it below
  }
  git(tree, "read-tree", "HEAD");
  git(tree, "update-index", "-q", "--refresh"); // hashes the clones, so only the wrong ones are rewritten
  git(tree, "checkout-index", "-a", "-f");
  return cloned;
}
