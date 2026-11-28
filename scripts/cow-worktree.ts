#!/usr/bin/env bun
// Copy-on-write worktrees: tracked files that are the same as a donor checkout's take no disk of their own (macOS, APFS).
//
//   bun scripts/cow-worktree.ts dedupe               dry run: what each worktree would give back; changes nothing
//   bun scripts/cow-worktree.ts dedupe --go          swap those files for clones of the donor's
//   bun scripts/cow-worktree.ts add <path> <commit>  a new detached worktree, filled with clones
//   bun scripts/cow-worktree.ts dedupe --under <dir>  only the worktrees inside <dir> (give it again for more)
//   --from <dir>                                     the donor checkout (default: the repo's main one)
//
// `dedupe` skips a worktree that is locked, on another volume or has a file open or a process in it. In the rest it leaves
// files with uncommitted changes alone, and replaces another only when both indexes name the same blob and the bytes
// match, by renaming a finished clone over it. It never deletes a worktree, branch or commit. The next `git status` in a
// deduped worktree is slow once.
// `add` refuses a donor with changes to tracked files, a different volume, a disk that can't clone or too little space.
// `du` can't see clones; the sizes here are APFS's own count of bytes a file shares with nothing.
// Portable: this file and `cow-clone.ts` beside it need only Bun and git, so another repo can copy the pair
// (notes/COW_WORKTREES.md). Keep them free of imports from this repo.
import { execFileSync } from "node:child_process";
import { dlopen, FFIType, ptr } from "bun:ffi";
import { chmodSync, constants, copyFileSync, existsSync, lstatSync, readFileSync, realpathSync, renameSync, rmSync, statfsSync, statSync } from "node:fs";
import path from "node:path";
import { fillWorktree } from "./cow-clone.ts";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["--no-optional-locks", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 });
const records = (s: string) => s.split("\0").filter(Boolean);

/** `path → "mode oid"` of the plain files in `dir`'s index. */
function index(dir: string) {
  return new Map(records(git(dir, "ls-files", "-s", "-z")).flatMap((e) => {
    const [mode, oid, stage] = e.slice(0, e.indexOf("\t")).split(" ");
    return mode?.startsWith("100") && stage === "0" ? [[e.slice(e.indexOf("\t") + 1), `${mode} ${oid}`] as const] : [];
  }));
}

/** Paths in `dir` with uncommitted changes. By content: a new mtime alone is not a change. */
const edited = (dir: string) => new Set(records(git(dir, "status", "--porcelain", "-z", "--no-renames")).map((e) => e.slice(3)));

/** Bytes of a file that no other file shares (APFS `ATTR_CMNEXT_PRIVATESIZE`). */
function privateSizer() {
  const { symbols } = dlopen("libSystem.B.dylib", { getattrlist: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u64, FFIType.u32], returns: FFIType.i32 } });
  const want = new Uint8Array(24), out = new Uint8Array(16);
  new DataView(want.buffer).setUint16(0, 5, true); // ATTR_BIT_MAP_COUNT
  new DataView(want.buffer).setUint32(20, 0x8, true); // forkattr: private size
  return (file: string) =>
    symbols.getattrlist(ptr(Buffer.from(`${file}\0`)), ptr(want), ptr(out), 16, 0x21) === 0 ? Number(new DataView(out.buffer).getBigInt64(4, true)) : 0;
}

/** Every path some process has open or sits in. Throws when it can't tell, so nothing is touched. */
function openPaths() {
  let out = "";
  try { out = execFileSync("lsof", ["-Fn"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024 }); }
  catch (err) { out = err instanceof Error && "stdout" in err ? String(err.stdout) : ""; } // lsof exits 1 over files it may not see
  const paths = out.split("\n").filter((l) => l.startsWith("n/")).map((l) => l.slice(1));
  if (!paths.length) throw new Error("lsof listed nothing, so which worktrees are in use is unknown");
  return paths;
}

export type Tree = { path: string; files: number; bytes: number; skipped?: string };

/** What swapping each worktree's copies for clones of `donor`'s gives back; with `go`, does it. */
export function dedupe(donor: string, go = false, inUse: () => string[] = openPaths, under: string[] = []): Tree[] {
  if (process.platform !== "darwin") throw new Error("dedupe measures with APFS, so it runs on macOS only");
  donor = realpathSync(donor);
  const privateSize = privateSizer();
  const changed = edited(donor);
  const have = [...index(donor)].filter(([file]) => !changed.has(file));
  const trees = git(donor, "worktree", "list", "--porcelain").split("\n\n").filter(Boolean).map((block) => ({
    path: block.split("\n")[0]!.slice("worktree ".length), locked: /^(locked|prunable|bare)/m.test(block),
  }));
  // listing every open file takes seconds, so one listing serves the worktrees reached in the next 30 s
  let seen: string[] = [], at = 0;
  const used = () => {
    if (Date.now() - at > 30_000) { seen = inUse(); at = Date.now(); }
    return seen;
  };
  const chosen = (tree: string) => !under.length || under.some((u) => tree.startsWith(`${path.resolve(u)}/`));
  return trees.filter((t) => t.path !== donor && chosen(t.path)).map(({ path: tree, locked }): Tree => {
    const skip = (skipped: string) => ({ path: tree, files: 0, bytes: 0, skipped });
    if (locked || !existsSync(tree)) return skip("locked or missing");
    if (statSync(tree).dev !== statSync(donor).dev) return skip("another volume");
    // a worktree nested in this one is its own entry, so a process there doesn't count as being in this one
    const inner = trees.filter((t) => t.path.startsWith(`${tree}/`)).map((t) => `${t.path}/`);
    if (used().some((p) => (p === tree || p.startsWith(`${tree}/`)) && !inner.some((i) => `${p}/`.startsWith(i)))) return skip("in use");
    const mine = index(tree);
    const theirs = edited(tree);
    let files = 0, bytes = 0;
    for (const [file, blob] of have) {
      if (mine.get(file) !== blob || theirs.has(file)) continue;
      const from = path.join(donor, file), to = path.join(tree, file), tmp = `${to}.cow-${process.pid}`;
      const stat = lstatSync(to, { throwIfNoEntry: false });
      const own = stat?.isFile() ? privateSize(to) : 0;
      if (!stat || !own) continue; // already shared
      if (go) {
        try {
          copyFileSync(from, tmp, constants.COPYFILE_FICLONE_FORCE);
          if (!readFileSync(tmp).equals(readFileSync(to))) continue;
          chmodSync(tmp, stat.mode);
          renameSync(tmp, to);
        } finally { rmSync(tmp, { force: true }); }
      }
      files++;
      bytes += own;
    }
    return { path: tree, files, bytes };
  });
}

/** `git worktree add --no-checkout --detach`, filled from `donor`. Returns the files cloned. */
export function add(donor: string, to: string, commit: string): number {
  donor = realpathSync(donor);
  to = path.resolve(to);
  const parent = path.dirname(to);
  if (existsSync(to)) throw new Error(`${to} already exists`);
  if (git(donor, "status", "--porcelain", "--untracked-files=no")) throw new Error(`donor ${donor} has uncommitted changes`);
  if (statSync(donor).dev !== statSync(parent).dev) throw new Error(`${parent} is on another volume than the donor, so nothing can be shared`);
  const files = [...index(donor).keys()];
  // room for a whole ordinary checkout, which is what git writes if the clones come to nothing
  const need = files.reduce((n, f) => n + (lstatSync(path.join(donor, f), { throwIfNoEntry: false })?.size ?? 0), 0) + 1024 ** 3;
  const disk = statfsSync(parent);
  if (disk.bavail * disk.bsize < need) throw new Error(`need ${(need / 1024 ** 3).toFixed(1)} GB free at ${parent}`);
  const probe = path.join(parent, `.cow-probe-${process.pid}`);
  try { copyFileSync(path.join(donor, files[0] ?? ""), probe, constants.COPYFILE_FICLONE_FORCE); }
  catch { throw new Error(`${parent} can't make copy-on-write clones`); }
  finally { rmSync(probe, { force: true }); }
  git(donor, "worktree", "add", "--no-checkout", "--detach", to, commit);
  const cloned = fillWorktree(donor, to);
  const dirty = git(to, "status", "--porcelain");
  if (dirty) throw new Error(`${to} is not clean after the fill; it was left as it is:\n${dirty.slice(0, 500)}`);
  return cloned;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(readFileSync(import.meta.path, "utf8").split("\nimport ")[0]!.replace(/^#!.*\n/, "").replace(/^\/\/ ?/gm, ""));
    process.exit(0);
  }
  const at = args.indexOf("--from");
  const from = at >= 0 ? args.splice(at, 2)[1] : undefined;
  const donor = from ?? git(process.cwd(), "worktree", "list", "--porcelain").split("\n")[0]!.slice("worktree ".length);
  const under: string[] = [];
  for (let i = args.indexOf("--under"); i >= 0; i = args.indexOf("--under")) {
    const dir = args.splice(i, 2)[1];
    if (!dir) throw new Error("--under needs a folder"); // never fall back to every worktree
    under.push(dir);
  }
  const [command, to, commit] = args;
  if (command === "add" && to && commit) console.log(`${path.resolve(to)}: ${add(donor, to, commit)} files cloned from ${donor}`);
  else if (command === "dedupe") {
    const go = args.includes("--go");
    const free = () => { const d = statfsSync(donor); return `${((d.bavail * d.bsize) / 1024 ** 3).toFixed(1)} GB free`; };
    console.log(`donor ${donor} · ${free()}`);
    const trees = dedupe(donor, go, openPaths, under);
    for (const t of trees.filter((x) => x.files)) console.log(`  ${(t.bytes / 1024 ** 2).toFixed(0).padStart(6)} MB  ${t.files} files  ${t.path}`);
    for (const why of new Set(trees.flatMap((t) => t.skipped ?? []))) {
      const these = trees.filter((t) => t.skipped === why);
      console.log(`skipped, ${why} (${these.length}): ${these.map((t) => path.basename(t.path)).join(" ")}`);
    }
    const total = trees.reduce((n, t) => n + t.bytes, 0) / 1024 ** 3;
    console.log(`${go ? "gave back" : "dry run: would give back"} ${total.toFixed(1)} GB in ${trees.filter((t) => t.files).length} worktrees · ${free()}`);
  } else {
    console.error("usage: bun scripts/cow-worktree.ts dedupe [--go] | add <path> <commit> [--from <dir>]  (--help)");
    process.exit(2);
  }
}
