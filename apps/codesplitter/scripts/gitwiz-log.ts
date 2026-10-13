#!/usr/bin/env bun
// gitwiz's data: one file's history, or a repo's most-edited files, as the JSON src/gitwiz/ plays back.
// Read only: it runs `git log` and `git ls-files` in a local clone and writes to stdout.
//
//   bun scripts/gitwiz-log.ts <repo> <path>          one file's history, newest first like git:
//                                                    {repo, path, commits: [{hash, author, date, subject, added, removed, regions}]}
//   bun scripts/gitwiz-log.ts <repo> --top [N]       the N most-edited files (default 12): {repo, files: [{path, commits}]}
//   bun scripts/gitwiz-log.ts <repo> --bundle [N]    both, for the top N: {repo, files, histories}. What the page loads.
//
// <repo> is any local clone, e.g. this one (.) or a clone of someone else's. Open the result in
// gitwiz with its Open or Paste button.
import { basename, resolve } from "node:path";
import { LOG_FORMAT, parsePatchLog, topFiles, type Commit } from "../src/gitwiz/gitwiz.ts";

async function git(repo: string, ...args: string[]): Promise<string> {
  const p = Bun.spawn(["git", "-C", repo, ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(`git ${args[0]} failed: ${err.trim() || `exit ${code}`}`);
  return out;
}

export async function history(repo: string, path: string): Promise<Commit[]> {
  return parsePatchLog(await git(repo, "log", "--follow", "-p", "-U0", "--no-merges", "--no-color", "--no-ext-diff", `--format=${LOG_FORMAT}`, "--", path));
}

export async function mostEdited(repo: string, limit: number) {
  const names = await git(repo, "log", "--no-merges", "-M", "--name-status", "--format=%x1e");
  const here = new Set((await git(repo, "ls-files")).split("\n"));
  return topFiles(names, (p) => here.has(p), limit);
}

if (import.meta.main) {
  const [repoArg, what, n] = process.argv.slice(2);
  if (!repoArg || !what) {
    console.error("usage: bun scripts/gitwiz-log.ts <repo> <path> | --top [N] | --bundle [N]");
    process.exit(2);
  }
  try {
    const repo = resolve(repoArg);
    // The origin's name when there is one: a worktree's folder is named for its branch.
    const origin = await git(repo, "remote", "get-url", "origin").then((u) => basename(u.trim()).replace(/\.git$/, ""), () => "");
    const name = origin || basename((await git(repo, "rev-parse", "--show-toplevel")).trim());
    const limit = Number(n) > 0 ? Number(n) : 12;
    if (what === "--top") console.log(JSON.stringify({ repo: name, files: await mostEdited(repo, limit) }));
    else if (what === "--bundle") {
      const files = await mostEdited(repo, limit);
      const histories: Record<string, Commit[]> = {};
      for (const f of files) histories[f.path] = await history(repo, f.path);
      console.log(JSON.stringify({ repo: name, files, histories }));
    } else {
      const commits = await history(repo, what);
      if (!commits.length) throw new Error(`no commits touch ${what} in ${repo}`);
      console.log(JSON.stringify({ repo: name, path: what, commits }));
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
