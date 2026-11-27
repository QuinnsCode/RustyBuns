# Copy-on-write worktrees

`git worktree add` writes every tracked file again. On a copy-on-write disk (macOS APFS, Linux Btrfs or XFS) the new
worktree can share them with an existing checkout, and a file takes space only once it is changed.

Measured here (12,529 files, APFS): 0.07 MB of unshared tracked files instead of 1,202 MB, and a cleanup of 96
existing worktrees gave back 25.3 GB. Git's index and filesystem metadata still take some room.

## Use it in another repo

Copy two files, side by side, into any folder of that repo. They need [Bun](https://bun.sh) and git, nothing else.
Apache-2.0, like the rest of this repo ([LICENSE](../LICENSE)).

```sh
mkdir -p tools
for f in cow-worktree.ts cow-clone.ts; do
  curl -fsSL "https://raw.githubusercontent.com/QuinnsCode/RustyBuns/main/scripts/$f" -o "tools/$f"
done
```

Then paste this into that repo's `AGENTS.md` or `CLAUDE.md`:

```md
## Worktrees: copy-on-write

- Make a worktree with `bun tools/cow-worktree.ts add <path> <commit>`, not a bare `git worktree add`.
- `bun tools/cow-worktree.ts dedupe` shows what existing worktrees would give back and changes nothing.
  Ask before adding `--go`: it rewrites files in those worktrees.
- Don't judge the savings with `du`, which counts a clone as a full copy. Compare free space.
- Share files by cloning them, not with `git clone --shared` or alternates, where pruning one repo can break another.
- Never delete a worktree with uncommitted changes or unpushed commits without asking.
```

## What it does and doesn't do

| | macOS (APFS) | Linux (Btrfs, XFS with reflink) | NTFS, ext4 |
|---|---|---|---|
| `add` | yes | should work, not tried | refuses |
| `dedupe` | yes | refuses (it measures with APFS) | refuses |

- `add` leaves the new worktree on a detached commit, so make a branch in it before working.
- The donor is the repo's main checkout unless you pass `--from <dir>`.
- Only tracked files are cloned. Build caches are not, and Bun already clones `node_modules` from its own cache on macOS.
- Git LFS has not been tried. For LFS files alone, `git lfs dedup` is the built-in way.
- Windows block cloning (ReFS) has not been tried.
- `cp -c` and `COPYFILE_FICLONE_FORCE` really clone. Bun 1.4.4's plain `COPYFILE_FICLONE` copied small files.
