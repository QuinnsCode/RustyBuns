#!/usr/bin/env bun
// gitpath's data: one file's history as a commit graph, or a repo's most-edited files, as the JSON src/gitpath/ plays back.
// Read only: it runs `git log`, `git ls-files` and `git for-each-ref` in a local clone and writes to stdout.
//
//   bun scripts/gitpath-log.ts <repo> <path>          one file's history, newest first like git:
//                                                    {repo, path, commits: [{hash, author, date, subject, added, removed, parents, refs}]}
//   bun scripts/gitpath-log.ts <repo> --top [N]       the N most-edited files (default 12): {repo, files: [{path, commits}]}
//   bun scripts/gitpath-log.ts <repo> --bundle [N]    both, for the top N: {repo, files, histories}. What the page loads.
//   add --head to read only what HEAD can reach: by default every branch counts, so the graph fans out
//   into the branches that touched the file.
//
// <repo> is any local clone, e.g. this one (.) or a clone of someone else's. Each commit's `parents` are the
// nearest earlier commits that touched the file too. Open the result in gitpath with its Open or Paste button.
import { basename, resolve } from "node:path";
import { LOG_FORMAT, keptAncestors, parseDag, parsePatchLog, simplifyParents, topFiles, type Commit } from "../src/gitpath/gitpath.ts";

async function git(repo: string, ...args: string[]): Promise<string> {
  const p = Bun.spawn(["git", "-C", repo, ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(`git ${args[0]} failed: ${err.trim() || `exit ${code}`}`);
  return out;
}

/** The repo's whole graph and where `main` is, read once per run. */
export async function graph(repo: string, scope: string[]) {
  const dag = parseDag(await git(repo, "log", ...scope, "--format=%H %P"));
  const main = (await git(repo, "for-each-ref", "--format=%(objectname) %(refname:short)", "refs/heads", "refs/remotes"))
    .split("\n").map((l) => l.trim().split(" ")).filter(([h, n]) => h && /^(origin\/)?(main|master|trunk)$/.test(n ?? ""))[0]?.[0];
  return { dag, main };
}

export async function history(repo: string, path: string, scope: string[], g?: Awaited<ReturnType<typeof graph>>): Promise<Commit[]> {
  const { dag, main } = g ?? (await graph(repo, scope));
  const commits = parsePatchLog(await git(repo, "log", ...scope, "--follow", "-p", "-U0", "--no-merges", "--no-color", "--no-ext-diff", `--format=${LOG_FORMAT}`, "--", path));
  const keep = new Set(commits.map((c) => c.hash));
  const parents = simplifyParents(dag, keep);
  // `main` often points at a commit that never touched this file: label the nearest one that did.
  const mainNote = main ? keptAncestors(dag, keep)(main)[0] : undefined;
  return commits.map((c) => ({
    ...c, parents: parents.get(c.hash) ?? [],
    ...(c.hash === mainNote && !c.refs?.includes("main") ? { refs: ["main", ...(c.refs ?? [])] } : {}),
  }));
}

export async function mostEdited(repo: string, scope: string[], limit: number) {
  const names = await git(repo, "log", ...scope, "--no-merges", "-M", "--name-status", "--format=%x1e");
  const here = new Set((await git(repo, "ls-files")).split("\n"));
  return topFiles(names, (p) => here.has(p), limit);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const scope = args.includes("--head") ? ["HEAD"] : ["--all"];
  const [repoArg, what, n] = args.filter((a) => a !== "--head");
  if (!repoArg || !what) {
    console.error("usage: bun scripts/gitpath-log.ts <repo> <path> | --top [N] | --bundle [N]  [--head]");
    process.exit(2);
  }
  try {
    const repo = resolve(repoArg);
    // The origin's name when there is one: a worktree's folder is named for its branch.
    const origin = await git(repo, "remote", "get-url", "origin").then((u) => basename(u.trim()).replace(/\.git$/, ""), () => "");
    const name = origin || basename((await git(repo, "rev-parse", "--show-toplevel")).trim());
    const limit = Number(n) > 0 ? Number(n) : 12;
    if (what === "--top") console.log(JSON.stringify({ repo: name, files: await mostEdited(repo, scope, limit) }));
    else if (what === "--bundle") {
      const files = await mostEdited(repo, scope, limit);
      const g = await graph(repo, scope);
      const histories: Record<string, Commit[]> = {};
      for (const f of files) histories[f.path] = await history(repo, f.path, scope, g);
      console.log(JSON.stringify({ repo: name, files: files.map((f) => ({ path: f.path, commits: histories[f.path]!.length })), histories }));
    } else {
      const commits = await history(repo, what, scope);
      if (!commits.length) throw new Error(`no commits touch ${what} in ${repo}`);
      console.log(JSON.stringify({ repo: name, path: what, commits }));
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
