// Layout: mirrors: keeping a desktop repo in step with its upstream, through outages, with either side leading
// Mirrors: Git going when git stops going. On the desktop, a repo can be a
// mirror of the real one it was cloned from (GitHub, GitLab, any git remote
// this machine can reach). Its local git keeps working whatever upstream does,
// and the two keep each other up to date:
//
//   1. Fetch upstream's branch into refs/upstream/<branch> of the local bare repo.
//   2. If upstream has commits we don't, take them: a fast-forward, or a merge
//      commit (git merge-tree, nothing checked out). Files open here as Durable
//      Objects get upstream's changes as line edits by "upstream", merged line by
//      line into any live edits (sync.ts merge3).
//   3. If we have commits upstream doesn't, push them to its branch. Never forced.
//
// If upstream rewrote its history (a force-push), the last commit both sides
// agreed on isn't in it any more, so there's nothing to merge with: it stops at
// "rewritten" until the owner picks: re-base this copy's own commits on top of
// upstream's, or take upstream's and drop them.
//
// When upstream doesn't answer, the repo is "down" since then and everything
// else carries on: edits, commits, branches, agents. The cron tries again,
// backing off to every 15 minutes, and once upstream answers it catches up by
// itself. When both sides changed the same lines it stops at a "clash" and
// changes nothing until the owner picks a side for those files: theirs or ours.
//
// Where git truth lives (users.git_truth, PUT /api/me {git_truth}) settles those
// stops without asking: "github" takes upstream's side of a clash or a rewrite;
// "codesplitter" keeps the side here, edits and all, and re-bases this copy's
// commits on a rewritten upstream; "artifact" does the same for commits but still
// stops for edits that aren't committed yet. "ask", the default, always stops. A
// pick sent with the sync beats it. Nobody's commits are lost either way: what one
// side drops stays in its own git (this copy's, under refs/kept/<branch>/<ms>)
// and, here, every line keeps its history.
//
// Which side leads is per mirror (#464, repos.mirror_primary, POST .../mirror
// {primary}). "upstream", the default, is GitHub-first: hear from it, then push.
// "here" makes this machine's bare repo the source of truth and upstream its
// backup: a sync with commits waiting pushes them first, and only fetches and
// merges when upstream moved too (the push is turned away). A clash then still
// stops, with Keep mine as the pick the Upstream panel offers first.
//
// Commits that go upstream carry this machine's git identity (user.name and
// user.email), with a Co-authored-by trailer when a handle like agent-claude made
// them (archive.ts). A repo with private lines is "held": its git has them blank,
// so it pulls but never pushes. Unless the owner says to push the crew's copy
// (real text): then that's the git kept in step with upstream, and the repo's
// own git follows it file by file, its private-lined files left as they are, so
// none of upstream's objects (which hold the real text by then) land in it.
// Held back again after that, the crew's copy stays the one that pulls; it just
// isn't pushed.
//
// A pull-only mirror (#1009, repos.mirror_pull_only, POST .../mirror {pullOnly})
// is one-way: syncs hear from upstream and merge, but never push (a copy ahead
// of upstream settles as "held"), merged branches' upstream branches are left be,
// and the branch and tag push routes answer 409. For a mirror kept for local CI.
//
//   POST /api/mirrors {url, name?, visibility?, pullOnly?, path?, branch?}  clone any git remote as a mirror you own (desktop
//        only); with a path (or a GitHub .../tree/<branch>/<path> URL), one folder of it, as a repo of its own (folder-mirror.ts)
//   GET  /api/repos/:o/:r/mirror                 where it stands with upstream
//   POST /api/repos/:o/:r/mirror {resolve?, pushCrew?}
//        (owner) sync now; settle a clash with "mine" or "upstream", rewritten history with
//        "rebase" or "upstream"; pushCrew true sends the crew's copy upstream, false holds it;
//        primary "here" or "upstream" says which side leads; pullOnly true never pushes
//   GET|POST /api/repos/:o/:r/mirror/branches[/:b/pull|push]  branches both ways (see "Branches" below)
//   GET|POST /api/repos/:o/:r/mirror/turn       a dug fork, turned into a mirror (see the end)

import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_BYTES, MAX_LINES, materialize, toFile } from "./archive.ts";
import { fromDisk } from "./agent-run.ts";
import { GIT_BOT, GIT_EMAIL_DOMAIN } from "./git.ts";
import { branchAndPath, githubToken, parseFolder, parseRepo } from "./github.ts";
import { postOrder, startChecks, upstreamMoved, upstreamTaken } from "./checks.ts";
import { diffToOps, merge3 } from "./sync.ts";
import { branchNameError, json, NAME, type Env, readBody } from "./env.ts";
import { repoRow } from "./repos.ts";
import type { Doc } from "./lines.ts";
import { folderPath, graft, sendBranch, sourceRef, split, splitFromRef } from "./folder-mirror.ts";
import { indexFile, unindexFile } from "./search.ts";
import { byVersion, tagNameError } from "./tags.ts";

/** How often a mirror that's in step looks again, and the longest a failing one waits. */
export const EVERY = 5 * 60_000, MAX_WAIT = 15 * 60_000;

/** The desktop's Artifacts: bare repos on this machine (shell-bun's LocalArtifacts). */
interface LocalGit { path(name: string): string; remote(name: string): string; stamp(p: string, o: { description?: string; source?: string }): void; onPush?: (name: string) => unknown; importing?: Promise<unknown> }
export const localGit = (env: Env) => {
  const a = env.ARTIFACTS as unknown as Partial<LocalGit> | undefined;
  return typeof a?.path === "function" && typeof a.stamp === "function" && typeof Bun !== "undefined" ? a as LocalGit : null;
};
/** Mirrors need git on this machine to fetch and push: the desktop, not Cloudflare. */
export const mirrorsOn = (env: Env) => !!localGit(env);

type Run = { code: number; out: string; err: string };
export async function git(args: string[], cwd?: string, env: Record<string, string> = {}, timeout = 120_000): Promise<Run> {
  // A repo whose clone hasn't landed (or failed) is a failed run, not a throw: Bun
  // reports a missing cwd as ENOENT spawning git, which reads as git missing (#887).
  if (cwd && !existsSync(cwd)) return { code: 128, out: "", err: `no git at ${cwd}` };
  const p = Bun.spawn(["git", ...args], {
    cwd, stdout: "pipe", stderr: "pipe", timeout,
    // Never wait on a prompt: a remote that wants a password it doesn't have is a failed try.
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes -o ConnectTimeout=15", ...env },
  });
  const [code, out, err] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code, out, err: err.trim() };
}
async function must(args: string[], cwd?: string, env?: Record<string, string>) {
  const r = await git(args, cwd, env);
  if (r.code) throw new Error(r.err || `git ${args[0]} exited ${r.code}`);
  return r.out.trim();
}
export const isAncestor = async (dir: string, a: string, b: string) => (await git(["merge-base", "--is-ancestor", a, b], dir)).code === 0;
/** A file's text at a commit, or null when it isn't there. */
const show = async (dir: string, rev: string, path: string) => { const r = await git(["cat-file", "blob", `${rev}:${path}`], dir); return r.code ? null : r.out; };

/** A remote as it's shown: any user:password in it left out. */
export const shownUrl = (url: string) => url.replace(/^([a-z+]+:\/\/)[^@/]+@/i, "$1");

/**
 * What git needs to talk to `url`: give up on a stalled transfer instead of
 * hanging, and for GitHub the token this host has (the one digs use), passed
 * through the environment so it's never in argv or the repo's config. Other
 * remotes use this machine's own credential helper or ssh keys.
 */
async function remoteEnv(env: Env, owner: string, url: string) {
  const conf: [string, string][] = [["http.lowSpeedLimit", "1000"], ["http.lowSpeedTime", "20"]];
  if (/^https:\/\/github\.com\//i.test(url)) {
    const t = await githubToken(env, owner).catch(() => null);
    if (t) conf.push(["http.https://github.com/.extraHeader", `Authorization: Basic ${btoa(`x-access-token:${t.token}`)}`]);
  }
  return Object.fromEntries([["GIT_CONFIG_COUNT", String(conf.length)], ...conf.flatMap(([k, v], i) => [[`GIT_CONFIG_KEY_${i}`, k], [`GIT_CONFIG_VALUE_${i}`, v]])]);
}

let identity: { name: string; email: string } | null | undefined;
/** This machine's git identity (user.name and user.email), or null when it has none. */
export function gitIdentity() {
  if (identity === undefined) {
    const get = (k: string) => { try { return Bun.spawnSync(["git", "config", "--get", k], { stderr: "ignore", env: process.env }).stdout.toString().trim(); } catch { return ""; } };
    const name = get("user.name"), email = get("user.email");
    identity = name && email ? { name, email } : null;
  }
  return identity;
}
export const authorEnv = (): Record<string, string> => {
  const id = gitIdentity() ?? { name: "codesplitter", email: `${GIT_BOT}@${GIT_EMAIL_DOMAIN}` };
  return { GIT_AUTHOR_NAME: id.name, GIT_AUTHOR_EMAIL: id.email, GIT_COMMITTER_NAME: id.name, GIT_COMMITTER_EMAIL: id.email };
};

/** Who a mirror's commits are by, as git and upstream see them: this machine's git identity. Null for any other repo. */
export async function mirrorIdentity(env: Env, owner: string, repo: string) {
  if (!mirrorsOn(env)) return null;
  const r = await repoRow(env, owner, repo, "mirror_url");
  return r?.mirror_url ? gitIdentity() : null;
}

interface Row { owner: string; name: string; artifact: string; branch: string | null; crew_artifact: string | null; mirror_push_crew: number | null; mirror_primary: string | null; mirror_pull_only: number | null; mirror_path: string | null; mirror_url: string; mirror_fails: number | null; mirror_down_since: number | null; upstream_commit: string | null }
const row = (env: Env, owner: string, repo: string) =>
  repoRow(env, owner, repo, "owner, name, artifact, branch, crew_artifact, mirror_push_crew, mirror_primary, mirror_pull_only, mirror_path, mirror_url, mirror_fails, mirror_down_since, upstream_commit", { mirrored: true }) as Promise<Row | null>;

type State = "ok" | "down" | "refused" | "clash" | "held" | "rewritten";
export type Resolve = "mine" | "upstream" | "rebase";
export const PRIMARIES = ["upstream", "here"] as const;
export type Primary = typeof PRIMARIES[number];
const primaryOf = (v: unknown): Primary => v === "here" ? "here" : "upstream";
export const TRUTHS = ["ask", "codesplitter", "artifact", "github"] as const;
export type Truth = typeof TRUTHS[number];

/** Where `owner` says git truth lives (users.git_truth): whose side a sync takes when nobody picked. */
async function truthOf(env: Env, owner: string): Promise<Truth> {
  const u = await env.DB.prepare("SELECT git_truth FROM users WHERE name = ?").bind(owner).first();
  const t = u?.git_truth;
  return TRUTHS.includes(t as Truth) ? t as Truth : "ask";
}

/**
 * Whether the crew's copy is the git kept in step with upstream: when the owner
 * pushes it, and once it has gone up, while it's held back again too. Upstream
 * has private lines' real text by then (the last commit both sides agreed on
 * isn't in the repo's own git), so the repo's own git keeps following the crew's
 * copy file by file rather than merging upstream's commits, and nothing's pushed.
 */
async function crewSynced(lg: LocalGit, r: { artifact: string; crew_artifact: string | null; mirror_push_crew: number | null; upstream_commit: string | null }) {
  if (!r.crew_artifact) return false;
  if (r.mirror_push_crew) return true;
  return !!r.upstream_commit && (await git(["cat-file", "-e", `${r.upstream_commit}^{commit}`], lg.path(r.artifact))).code !== 0;
}
/** The git that's kept in step with upstream: the crew's copy (see crewSynced), else the repo's own. */
const syncedDir = async (lg: LocalGit, r: Parameters<typeof crewSynced>[1]) => lg.path(await crewSynced(lg, r) ? r.crew_artifact! : r.artifact);

/** A try that didn't work: say why, and back off (1, 2, 4… minutes, up to MAX_WAIT). */
async function failed(env: Env, r: Row, state: Exclude<State, "ok">, error: string, clash: string[] = []) {
  const fails = (r.mirror_fails ?? 0) + 1, now = Date.now();
  const downSince = state === "down" ? r.mirror_down_since ?? now : null;
  await env.DB.prepare("UPDATE repos SET mirror_state = ?, mirror_error = ?, mirror_clash = ?, mirror_down_since = ?, mirror_fails = ?, mirror_next_at = ? WHERE owner = ? AND name = ?")
    .bind(state, error.slice(0, 2000), clash.length ? JSON.stringify(clash) : null, downSince, fails, now + Math.min(MAX_WAIT, 60_000 * 2 ** (fails - 1)), r.owner, r.name).run();
  return state;
}

/** In step: upstream is at `tip`, and so are we (or we're ahead and it's held). `took`: main here took upstream's commits on the way. */
async function settled(env: Env, r: Row, tip: string, state: "ok" | "held" = "ok", error: string | null = null, took = false) {
  const now = Date.now();
  await env.DB.prepare("UPDATE repos SET mirror_state = ?, mirror_error = ?, mirror_clash = NULL, mirror_down_since = NULL, mirror_fails = 0, mirror_synced_at = ?, mirror_next_at = ?, upstream_commit = ? WHERE owner = ? AND name = ?")
    .bind(state, error, now, now + EVERY, tip, r.owner, r.name).run();
  // GitHub runs its Actions on upstream's new tip: watch for the results (checks.ts).
  if (tip !== r.upstream_commit) await upstreamMoved(env, r.owner, r.name, "main", tip);
  // Upstream's code is on main here now, untested here: our own checks run on main as the repo's own git has it.
  if (took) {
    const lg = localGit(env), main = lg && await git(["rev-parse", `refs/heads/${r.branch ?? "main"}`], lg.path(r.artifact));
    if (main && !main.code) await upstreamTaken(env, r.owner, r.name, "main", main.out.trim());
  }
  return state;
}

/** Something moved under this try (a commit here, a push upstream): go again on the next tick, as things stand. */
async function again(env: Env, r: Row) {
  await env.DB.prepare("UPDATE repos SET mirror_next_at = ? WHERE owner = ? AND name = ?").bind(Date.now(), r.owner, r.name).run();
  const s = await repoRow(env, r.owner, r.name, "mirror_state");
  return (s?.mirror_state ?? "ok") as State;
}

/** Each repo syncs (or moves a branch) one try at a time; a second ask waits for the first. */
const running = new Map<string, Promise<unknown>>();
function serial<T>(owner: string, repo: string, run: () => Promise<T>): Promise<T> {
  const key = `${owner}/${repo}`;
  const next = (running.get(key) ?? Promise.resolve()).catch(() => {}).then(run);
  running.set(key, next);
  next.finally(() => { if (running.get(key) === next) running.delete(key); }).catch(() => {});
  return next;
}
/** One sync: the default branch (step), then the branches that follow upstream ones. */
export function syncMirror(env: Env, owner: string, repo: string, o: { resolve?: Resolve; ask?: boolean } = {}): Promise<State | null> {
  return serial(owner, repo, async () => {
    const state = await step(env, owner, repo, o);
    if (state === "ok" || state === "held") await followBranches(env, owner, repo).catch(() => {});
    const { pruneWorktrees } = await import("./worktrees.ts");
    await pruneWorktrees(env, owner, repo).catch(() => {});
    return state;
  });
}

/** After a commit: try to hand it upstream now, without making the caller wait. */
export async function kickMirror(env: Env, owner: string, repo: string) {
  if (mirrorsOn(env) && await row(env, owner, repo)) syncMirror(env, owner, repo).catch(() => {});
}

/** The cron: every mirror whose turn has come, one after another. */
export async function syncDue(env: Env, now = Date.now()) {
  if (!mirrorsOn(env)) return;
  const { results } = await env.DB.prepare("SELECT owner, name FROM repos WHERE mirror_url IS NOT NULL AND (mirror_next_at IS NULL OR mirror_next_at <= ?)").bind(now).all();
  for (const { owner, name } of results as { owner: string; name: string }[]) await syncMirror(env, owner, name).catch(() => null);
}

async function step(env: Env, owner: string, repo: string, o: { resolve?: Resolve; ask?: boolean }): Promise<State | null> {
  const r = await row(env, owner, repo), lg = localGit(env);
  if (!r || !lg) return null;
  const crew = await crewSynced(lg, r), held = !!r.crew_artifact && !r.mirror_push_crew;
  const dir = lg.path(crew ? r.crew_artifact! : r.artifact), branch = r.branch ?? "main", heads = `refs/heads/${branch}`, up = `refs/upstream/${branch}`;
  const net = await remoteEnv(env, owner, r.mirror_url);
  /** Push our branch upstream, never forced: null when it went, "moved" when upstream has commits we don't, else why not. */
  const push = async (from = heads) => {
    const p = await git(["push", "--porcelain", r.mirror_url, `${from}:${heads}`], dir, net);
    if (!p.code) return null;
    const said = [p.err, p.out].filter(Boolean).join("\n");
    if (/\[rejected\]|non-fast-forward|fetch first/.test(said)) return "moved" as const;
    const refused = /\b40[13]\b|denied|permission|not allowed|protected branch|authentication|forbidden/i.test(said);
    return { state: refused ? "refused" as const : "down" as const, said: said || "upstream didn't take the push" };
  };
  try {
    // Commits pushed to this git from outside reach the files open here first (#773).
    if (!crew) await landPushes(env, owner, repo);
    // This copy leads: commits waiting on top of what upstream last had go up before anything's fetched.
    // Upstream moved meanwhile? The push is turned away, and the usual fetch, merge and push follow.
    if (primaryOf(r.mirror_primary) === "here" && !held && !crew && !r.mirror_pull_only && !r.mirror_path) {
      const known = await git(["rev-parse", "--verify", "--quiet", up], dir), tip = await must(["rev-parse", heads], dir), last = known.out.trim();
      if (!known.code && last !== tip && await isAncestor(dir, last, tip)) {
        const p = await push(tip);
        if (!p) { await must(["update-ref", up, tip], dir); return settled(env, r, tip); }
        if (p !== "moved") return failed(env, r, p.state, p.said);
      }
    }
    // The crew's copy was forked from the repo's own git, which may have synced upstream since: fetch that agreed commit from it.
    const has = async (c: string) => (await git(["cat-file", "-e", `${c}^{commit}`], dir)).code === 0;
    if (crew && r.upstream_commit && !(await has(r.upstream_commit))) await git(["fetch", "--quiet", "--no-tags", lg.path(r.artifact), r.upstream_commit], dir);
    const agreed = r.upstream_commit && await has(r.upstream_commit) ? r.upstream_commit : null;

    // 1. Hear from upstream. Only what's newer than the last commit both sides agreed on (a week's
    // slack, for clocks): a force-pushed history shares nothing with this copy, and fetched in full
    // it's all of upstream's past, when re-basing needs only its new tip. A fast-forward stops at
    // the agreed commit all the same. Upstream wound back past that is fetched the plain way.
    const since = agreed && Number(await must(["log", "-1", "--format=%ct", agreed], dir)) - 7 * 86_400;
    // A folder mirror fetches upstream's whole branch beside it, and splits the folder's commits out of it (folder-mirror.ts).
    const into = r.mirror_path ? sourceRef(branch) : up;
    const fetch = (limit: string[]) => git(["fetch", "--quiet", "--no-tags", ...limit, r.mirror_url, `+${heads}:${into}`], dir, net);
    let f = await fetch(since ? [`--shallow-since=${since}`] : []);
    if (since && f.code && /shallow/i.test(f.err)) f = await fetch([]);
    if (f.code) return failed(env, r, "down", f.err || "upstream didn't answer");
    if (r.mirror_path) {
      const source = await must(["rev-parse", into], dir), last = (await git(["rev-parse", "--verify", "--quiet", splitFromRef(branch)], dir)).out.trim();
      if (last !== source) {
        // Upstream rewrote its history past the last commit split: start the folder's over, and the sync sees it as rewritten.
        const from = last && await isAncestor(dir, last, source) ? last : null;
        const tip = await split(git, dir, r.mirror_path, from, source, from ? await must(["rev-parse", up], dir) : null);
        if (!tip) return failed(env, r, "clash", `upstream's ${branch} has no ${r.mirror_path} any more`);
        await must(["update-ref", up, tip], dir);
        await must(["update-ref", splitFromRef(branch), source], dir);
      }
    }
    let theirs = await must(["rev-parse", up], dir), ours = await must(["rev-parse", heads], dir);
    const before = ours;

    // Upstream rewrote its history when the last commit both sides agreed on isn't in it any more.
    const rewritten = !!agreed && agreed !== theirs && !(await isAncestor(dir, agreed, theirs));
    const whose = "upstream's history was rewritten (a force-push), so there's nothing to merge with";

    // 2. Take what upstream has that we don't.
    if (rewritten || (ours !== theirs && !(await isAncestor(dir, theirs, ours)))) {
      // Nobody picked a side for this sync: the owner's standing one, where they said git truth lives.
      // Unless it's asked to ask (a fork's first sync as a mirror): then a clash or a rewrite stops.
      const truth = o.resolve || o.ask ? "ask" : await truthOf(env, owner);
      const resolve: Resolve | undefined = o.resolve ?? (truth === "github" ? "upstream" : truth === "ask" ? undefined : rewritten ? "rebase" : "mine");
      let tip = theirs, clash: string[] = [], live: "mine" | "upstream" | undefined = resolve === "rebase" ? undefined : resolve;
      if (rewritten) {
        // Re-base: this copy's own commits, replayed on upstream's. Or take upstream's and let them go.
        if (resolve !== "rebase" && resolve !== "upstream") return failed(env, r, "rewritten", whose);
        if (resolve === "rebase") {
          const re = await replay(dir, ours, [agreed, theirs], theirs);
          if ("clash" in re) return failed(env, r, "rewritten", `${whose}, and replaying this copy's commits on it clashed`, re.clash);
          [tip, live] = [re.tip, "mine"];
        }
      } else if (!(await isAncestor(dir, ours, theirs))) {
        const m = await git(["merge-tree", "--write-tree", "--name-only", "--no-messages", ours, theirs], dir);
        if (m.code > 1) {
          // No common history to merge on, and no agreed commit to tell which commits are ours: all that's left is upstream's.
          if (resolve !== "upstream") return failed(env, r, "rewritten", `${whose}: ${m.err}`);
        } else {
          const [tree, ...files] = m.out.trim().split("\n");
          let merged = tree!;
          if (m.code === 1) {
            clash = [...new Set(files.filter(Boolean))];
            if (live !== "mine" && live !== "upstream") return failed(env, r, "clash", "upstream and this copy changed the same lines", clash);
            merged = await pick(dir, merged, clash, live === "mine" ? ours : theirs);
          }
          tip = await must(["commit-tree", merged, "-p", ours, "-p", theirs, "-m", `Merge ${shownUrl(r.mirror_url)} ${branch}`], dir, authorEnv());
        }
      }
      // Files open here get upstream's changes as line edits, before git moves, so a catalogue never undoes them.
      // Git truth in the artifact speaks for commits only: edits not committed yet still ask.
      const changes = await liveChanges(env, owner, repo, dir, ours, tip, truth === "artifact" && !rewritten ? undefined : live);
      if (changes.clash.length) return failed(env, r, "clash", "edits here that aren't committed yet touch the same lines upstream changed", changes.clash);
      for (const p of changes.plans) await land(env, owner, repo, p, tip);
      // Taking upstream's history drops this copy's commits from the branch, not from git: a ref keeps them.
      const dropped = !(await isAncestor(dir, ours, tip));
      // A catalogue that landed meanwhile moved the branch: take it from the top next round.
      if ((await git(["update-ref", heads, tip, ours], dir)).code) return again(env, r);
      if (!crew) await env.DB.prepare("UPDATE repos SET git_seen = ? WHERE owner = ? AND name = ? AND git_seen = ?").bind(tip, owner, repo, ours).run();
      if (dropped) await git(["update-ref", `refs/kept/${branch}/${Date.now()}`, ours], dir);
      ours = tip;
    }
    // The crew's copy moved: the repo's own git takes the same files, all but the private-lined ones.
    if (crew && ours !== before) await follow(env, r, lg, dir, before, ours);

    // 3. Hand upstream what we have that it doesn't.
    if (ours !== theirs && !(await isAncestor(dir, ours, theirs))) {
      if (held) return settled(env, r, theirs, "held", "this repo has private lines, and its git holds them blank, so nothing goes upstream", ours !== before);
      if (r.mirror_pull_only) return settled(env, r, theirs, "held", "this mirror is pull-only, so nothing goes upstream", ours !== before);
      if (r.mirror_path) return send(env, r, dir, net, theirs, ours, ours !== before);
      const p = await push(ours);
      // Upstream moved since the fetch: the next round merges it in, then pushes.
      if (p === "moved") return again(env, r);
      if (p) return failed(env, r, p.state, p.said);
      await must(["update-ref", up, ours], dir);
      theirs = ours;
    }
    return settled(env, r, theirs, "ok", null, ours !== before);
  } catch (e) {
    return failed(env, r, "clash", `sync stopped: ${String((e as Error).message ?? e)}`);
  }
}

/**
 * A folder mirror's work, sent up (folder-mirror.ts): this copy's tree under the folder's path on upstream's tip, as one
 * commit on its own branch for a pull request. Upstream's main never takes it from here. Held until upstream merges it;
 * when upstream's folder already reads as this copy's, there's nothing to send and it's in step.
 */
async function send(env: Env, r: Row, dir: string, net: Record<string, string>, theirs: string, ours: string, took: boolean) {
  const branch = r.branch ?? "main", source = await must(["rev-parse", sourceRef(branch)], dir);
  const tree = await graft(git, dir, r.mirror_path!, source, ours);
  if (!tree) return settled(env, r, theirs, "ok", null, took);
  const subjects = (await must(["log", "--format=- %s", `${theirs}..${ours}`, "--no-merges"], dir)).split("\n").filter(Boolean).slice(0, 50);
  const c = await must(["commit-tree", tree, "-p", source, "-m", `${r.name}: ${r.mirror_path} from codeSplitter\n\n${subjects.join("\n")}`], dir, authorEnv());
  const to = sendBranch(r.name);
  // The branch is this copy's own proposal: a new send replaces it. Upstream's main is never pushed.
  const p = await git(["push", "--porcelain", r.mirror_url, `+${c}:refs/heads/${to}`], dir, net);
  if (p.code) {
    const said = [p.err, p.out].filter(Boolean).join("\n") || "upstream didn't take the push";
    return failed(env, r, /\b40[13]\b|denied|permission|not allowed|protected branch|authentication|forbidden/i.test(said) ? "refused" : "down", said);
  }
  const gh = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(r.mirror_url)?.[1];
  return settled(env, r, theirs, "held", `sent up as branch ${to}${gh ? `: open a pull request at https://github.com/${gh}/compare/${branch}...${to}` : ", for a pull request"}`, took);
}

/**
 * Replay the commits in `ours` that aren't in any of `not`, oldest first, on
 * top of `onto`: each one's diff applied three ways in a throwaway index, kept
 * with its author and message. Merges are skipped (what they brought in is
 * upstream's), and so is a commit upstream already has. A diff that won't apply
 * is a clash, in that commit's files.
 */
async function replay(dir: string, ours: string, not: (string | null)[], onto: string): Promise<{ tip: string } | { clash: string[] }> {
  const commits = (await must(["rev-list", "--reverse", "--no-merges", ours, ...not.filter(Boolean).map((c) => `^${c}`)], dir)).split("\n").filter(Boolean);
  const tmp = join(tmpdir(), `codesplitter-replay-${crypto.randomUUID()}`), e = { GIT_INDEX_FILE: `${tmp}.index` };
  let tip = onto;
  try {
    for (const c of commits) {
      await Bun.write(`${tmp}.patch`, (await git(["diff-tree", "-p", "--binary", "--full-index", "--root", c], dir)).out.replace(/^[0-9a-f]{40}\n/, ""));
      await must(["read-tree", tip], dir, e);
      if ((await git(["apply", "--cached", "--3way", `${tmp}.patch`], dir, e)).code) return { clash: (await must(["diff-tree", "--no-commit-id", "--name-only", "-r", "--root", c], dir)).split("\n").filter(Boolean) };
      const tree = await must(["write-tree"], dir, e);
      if (tree === await must(["rev-parse", `${tip}^{tree}`], dir)) continue;
      const [name, email, date, message] = (await must(["log", "-1", "--format=%an%x00%ae%x00%aI%x00%B", c], dir)).split("\0");
      const by = { ...authorEnv(), GIT_AUTHOR_NAME: name!, GIT_AUTHOR_EMAIL: email!, GIT_AUTHOR_DATE: date! };
      tip = await must(["commit-tree", tree, "-p", tip, "-m", message!.trim() || "(no message)"], dir, by);
    }
    return { tip };
  } finally { rmSync(`${tmp}.index`, { force: true }); rmSync(`${tmp}.patch`, { force: true }); }
}

/** The open files with private lines: their text in the repo's own git is blank where the crew's has it. */
async function privatePaths(env: Env, owner: string, repo: string) {
  const { results } = await env.DB.prepare("SELECT path FROM files WHERE owner = ? AND repo = ?").bind(owner, repo).all();
  const out = new Set<string>();
  for (const { path } of results as { path: string }[]) {
    if (((await (await toFile(env, owner, repo, path, "upstream", "private")).json()) as string[]).length) out.add(path);
  }
  return out;
}

/**
 * The crew's copy went from `from` to `to`: give the repo's own git the same
 * files as one commit of its own, blob by blob, so none of upstream's history
 * (which holds private lines' real text, now the crew's copy goes up) lands
 * in it. Files with private lines stay as its git has them, blank lines and all,
 * until they're next committed here. A catalogue that lands meanwhile: build on it.
 */
async function follow(env: Env, r: Row, lg: LocalGit, crewDir: string, from: string, to: string) {
  const pub = lg.path(r.artifact), heads = `refs/heads/${r.branch ?? "main"}`, secret = await privatePaths(env, r.owner, r.name);
  const paths = (await must(["diff", "--name-only", "-z", "--no-renames", from, to], crewDir)).split("\0").filter((p) => p && !secret.has(p));
  if (!paths.length) return;
  const files: { path: string; mode: string; hash: string }[] = [], gone: string[] = [];
  for (const path of paths) {
    const ls = await must(["ls-tree", to, "--", path], crewDir);
    if (!ls) { gone.push(path); continue; }
    const [mode, type, hash] = ls.split("\t")[0]!.split(" ");
    if (type !== "blob") continue;
    // The blob, copied across as bytes.
    const cat = Bun.spawn(["git", "cat-file", "blob", hash!], { cwd: crewDir, stdout: "pipe", stderr: "ignore" });
    const put = Bun.spawn(["git", "hash-object", "-w", "--stdin"], { cwd: pub, stdin: cat.stdout, stdout: "pipe", stderr: "pipe" });
    const [, made] = await Promise.all([put.exited, new Response(put.stdout).text()]);
    if (made.trim() !== hash) throw new Error(`couldn't copy ${path} into the repo's own git`);
    files.push({ path, mode: mode!, hash: hash! });
  }
  const idx = join(tmpdir(), `codesplitter-follow-${crypto.randomUUID()}.index`), e = { GIT_INDEX_FILE: idx };
  try {
    for (let tries = 0; tries < 3; tries++) {
      const base = await must(["rev-parse", heads], pub);
      await must(["read-tree", base], pub, e);
      for (const f of files) await must(["update-index", "--add", "--cacheinfo", `${f.mode},${f.hash},${f.path}`], pub, e);
      for (const path of gone) await must(["update-index", "--force-remove", "--", path], pub, e);
      const tree = await must(["write-tree"], pub, e);
      if (tree === await must(["rev-parse", `${base}^{tree}`], pub)) return;
      const c = await must(["commit-tree", tree, "-p", base, "-m", `upstream ${to.slice(0, 7)}, from ${shownUrl(r.mirror_url)}`], pub, authorEnv());
      if ((await git(["update-ref", heads, c, base], pub)).code === 0) return;
    }
  } finally { rmSync(idx, { force: true }); }
}

/** `tree` with each of `paths` as `side` has it (gone if it isn't there), through a throwaway index. */
async function pick(dir: string, tree: string, paths: string[], side: string) {
  const idx = join(tmpdir(), `codesplitter-mirror-${crypto.randomUUID()}.index`), e = { GIT_INDEX_FILE: idx };
  try {
    await must(["read-tree", tree], dir, e);
    for (const path of paths) {
      const ls = await must(["ls-tree", side, "--", path], dir);
      if (ls) {
        const [mode, , hash] = ls.split("\t")[0]!.split(" ");
        await must(["update-index", "--add", "--cacheinfo", `${mode},${hash},${path}`], dir, e);
      } else await must(["update-index", "--force-remove", "--", path], dir, e);
    }
    return await must(["write-tree"], dir, e);
  } finally { rmSync(idx, { force: true }); }
}

interface Plan { path: string; doc: Doc; next: string[] | null; clean: boolean }

/**
 * For each file open here that git changes going from `ours` to `tip`: the
 * lines it should have. One with no edits since its last commit just takes
 * upstream's; one with live edits gets upstream's changes merged into them,
 * unless they touch the same lines, which is a clash (or `resolve` says whose
 * wins). `next` null means upstream deleted it. Plans are for the files that
 * don't clash: a sync lands none of them while any do.
 */
async function liveChanges(env: Env, owner: string, repo: string, dir: string, ours: string, tip: string, resolve?: "mine" | "upstream"): Promise<{ plans: Plan[]; clash: string[] }> {
  const paths = (await must(["diff", "--name-only", "-z", "--no-renames", ours, tip], dir)).split("\0").filter(Boolean);
  if (!paths.length) return { plans: [], clash: [] };
  const { results } = await env.DB.prepare("SELECT path FROM files WHERE owner = ? AND repo = ?").bind(owner, repo).all();
  const open = new Set((results as { path: string }[]).map((f) => f.path));
  const plans: Plan[] = [], clash: string[] = [];
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((l, i) => l === b[i]);
  for (const path of paths.filter((p) => open.has(p))) {
    const doc = (await (await toFile(env, owner, repo, path, "upstream", "file")).json()) as Doc;
    const lines = doc.lines.map((l) => l.text), was = fromDisk((await show(dir, ours, path)) ?? "");
    const after = await show(dir, tip, path), now = after === null ? null : fromDisk(after);
    if (now && same(lines, now)) continue;
    const clean = same(lines, was);
    if (clean || resolve === "upstream") { plans.push({ path, doc, next: now, clean }); continue; }
    const merged = now && merge3(was, lines, now);
    if (merged) plans.push({ path, doc, next: merged, clean: false });
    else if (resolve !== "mine") clash.push(path);
  }
  return { plans, clash };
}

/** Put a plan into the file's Durable Object as `by`'s edits (upstream's); a file that was clean is committed there too. */
async function land(env: Env, owner: string, repo: string, p: Plan, tip: string, by = "upstream", message = `upstream ${tip.slice(0, 7)}`) {
  if (p.next === null) {
    // Upstream deleted it: the file goes here too.
    await toFile(env, owner, repo, p.path, by, "wipe", { method: "POST" });
    await env.DB.batch(["files", "git_pending"].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE owner = ? AND repo = ? AND path = ?`).bind(owner, repo, p.path)));
    await unindexFile(env, owner, repo, p.path);
    return;
  }
  const ops = diffToOps(p.doc.lines, p.next);
  if (ops.length) {
    const res = await toFile(env, owner, repo, p.path, by, "ops", { method: "POST", body: JSON.stringify({ ops, ifRev: p.doc.rev }) });
    if (!res.ok) throw new Error(`${p.path} was edited while syncing; trying again`);
  }
  if (!p.clean) return;
  const c = await toFile(env, owner, repo, p.path, by, "commit", { method: "POST", body: JSON.stringify({ message }) });
  const { published } = (await c.json()) as { published: string };
  await indexFile(env, owner, repo, p.path, published);
}

/**
 * Pushes to a desktop repo's own git (#773). Its bare repo is a remote for the
 * owner's tools (Push back), and a push there moves main without the files open
 * here hearing of it, so their next commit here would write their old lines
 * back over it. repos.git_seen is main's tip as the app last knew it (set when
 * the repo's made, see seeGit; its own commits move it, see archive.ts, and so
 * do syncs and this): the commits since came in from outside, and land in open
 * files as line edits by the owner (only the owner gets a remote that writes),
 * merged into any live edits. Where those touch the same lines (or lines right
 * beside them) it's a clash (#788): the edits here stay as they are, the file
 * goes in repos.git_clash with the pushed commit, and its commit here waits for
 * the owner to pick a side (settlePush). A git that started over (a fresh start)
 * shares nothing with what was seen: the tip becomes the new baseline. "" is an
 * empty git's baseline. Not for a repo with private lines: no push back is offered there.
 */
export function landPushes(env: Env, owner: string, repo: string): Promise<void> {
  // One landing at a time per repo: a push heard as it arrives and a commit here both look.
  const key = `${owner}/${repo}`, next = (landing.get(key) ?? Promise.resolve()).catch(() => {}).then(() => landNow(env, owner, repo));
  landing.set(key, next);
  next.finally(() => { if (landing.get(key) === next) landing.delete(key); }).catch(() => {});
  return next;
}
const landing = new Map<string, Promise<void>>();
async function landNow(env: Env, owner: string, repo: string) {
  const lg = localGit(env);
  if (!lg) return;
  const r = await repoRow(env, owner, repo, "artifact, branch, crew_artifact, git_seen, git_clash") as { artifact: string | null; branch: string | null; crew_artifact: string | null; git_seen: string | null; git_clash: string | null } | null;
  if (!r?.artifact || r.crew_artifact) return;
  const dir = lg.path(r.artifact), t = await git(["rev-parse", "--verify", "--quiet", `refs/heads/${r.branch ?? "main"}`], dir), tip = t.out.trim();
  if (t.code || !tip || tip === r.git_seen) return;
  const seen = r.git_seen === "" ? EMPTY_TREE
    : r.git_seen && (await git(["cat-file", "-e", `${r.git_seen}^{commit}`], dir)).code === 0 && await isAncestor(dir, r.git_seen, tip) ? r.git_seen : null;
  const clashes = clashesOf(r.git_clash);
  if (seen) {
    const changes = await liveChanges(env, owner, repo, dir, seen, tip);
    const message = (await must(["log", "-1", "--format=%s", tip], dir)) || `pushed ${tip.slice(0, 7)}`;
    for (const p of changes.plans) {
      await land(env, owner, repo, p, tip, owner, message);
      // A file that clashed before takes this push's lines when that side is picked.
      if (clashes[p.path]) clashes[p.path] = tip;
    }
    for (const path of changes.clash) clashes[path] = tip;
  }
  // Someone else landed it, or the app committed, meanwhile: theirs stands.
  const set = await env.DB.prepare("UPDATE repos SET git_seen = ?, git_clash = ? WHERE owner = ? AND name = ? AND git_seen IS ?")
    .bind(tip, Object.keys(clashes).length ? JSON.stringify(clashes) : null, owner, repo, r.git_seen).run();
  // Pages open on a newly clashed file show it now, not on their next load.
  const was = clashesOf(r.git_clash);
  if (set.meta?.changes) for (const path of Object.keys(clashes)) if (!was[path]) await pingClash(env, owner, repo, path);
}

const pingClash = (env: Env, owner: string, repo: string, path: string) =>
  toFile(env, owner, repo, path, owner, "pushclash", { method: "POST" }).catch(() => null);

/**
 * On the desktop, a push lands in the files open here as it arrives (#788), so
 * a page left open sees the pushed lines live (the file's socket hears the edits)
 * and a clash shows at once. Wired on the first request, once.
 */
export function hearPushes(env: Env) {
  const lg = localGit(env);
  if (!lg || lg.onPush) return;
  lg.onPush = async (name) => {
    const r = await env.DB.prepare("SELECT owner, name FROM repos WHERE artifact = ?").bind(name).first() as { owner: string; name: string } | null;
    if (r) await landPushes(env, r.owner, r.name);
  };
}

/** git's empty tree: what an empty repo's git had, to diff its first push against. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const clashesOf = (v: unknown): Record<string, string> => { try { return v ? JSON.parse(v as string) : {}; } catch { return {}; } };

/** A desktop repo's baseline for landPushes: main's tip as it is when the repo's made or dug up ("" for an empty git). */
export async function seeGit(env: Env, owner: string, repo: string) {
  const lg = localGit(env);
  const r = lg && await repoRow(env, owner, repo, "artifact, branch") as { artifact: string | null; branch: string | null } | null;
  if (!lg || !r?.artifact) return;
  // A dig answers while its clone is still running in the background: look once it lands.
  // No git there means the clone failed, and Bun would throw spawning in a missing cwd.
  await lg.importing?.catch(() => {});
  if (!existsSync(lg.path(r.artifact))) return;
  const t = await git(["rev-parse", "--verify", "--quiet", `refs/heads/${r.branch ?? "main"}`], lg.path(r.artifact));
  await env.DB.prepare("UPDATE repos SET git_seen = ? WHERE owner = ? AND name = ? AND git_seen IS NULL").bind(t.code ? "" : t.out.trim(), owner, repo).run();
}

/** The files a push clashed with (#788), each with its pushed commit. */
export async function pushClashes(env: Env, owner: string, repo: string) {
  const r = await repoRow(env, owner, repo, "artifact, git_clash");
  return { artifact: r?.artifact as string | undefined, clashes: clashesOf(r?.git_clash) };
}

/** The pushed lines a clash is with, or null if the push deleted the file. */
async function pushedLines(env: Env, owner: string, repo: string, path: string) {
  const { artifact, clashes } = await pushClashes(env, owner, repo), lg = localGit(env), commit = clashes[path];
  if (!commit || !lg || !artifact) return undefined;
  const text = await show(lg.path(artifact), commit, path);
  return { commit, lines: text === null ? null : fromDisk(text) };
}

async function unclash(env: Env, owner: string, repo: string, path: string) {
  // Read and written in one statement, so a push landing meanwhile keeps its own.
  await env.DB.prepare("UPDATE repos SET git_clash = NULLIF(json_remove(git_clash, '$.' || json_quote(?)), '{}') WHERE owner = ? AND name = ? AND git_clash IS NOT NULL").bind(path, owner, repo).run();
  await pingClash(env, owner, repo, path);
}

/**
 * Is `path`'s commit here held by a push it clashed with (#788)? Not once its
 * lines are the pushed ones (somebody settled it by hand): that clears it.
 */
export async function pushHolds(env: Env, owner: string, repo: string, path: string) {
  const pushed = await pushedLines(env, owner, repo, path);
  if (!pushed) return false;
  const doc = (await (await toFile(env, owner, repo, path, owner, "file")).json()) as Doc;
  if (pushed.lines && doc.lines.length === pushed.lines.length && doc.lines.every((l, i) => l.text === pushed.lines![i])) {
    await unclash(env, owner, repo, path);
    return false;
  }
  return true;
}

/**
 * Settle a push's clash with a file (#788): "mine" keeps the edits here (its
 * next commit writes them over what was pushed), "pushed" puts the pushed lines
 * in their place as the owner's edits (a push that deleted the file deletes it here).
 */
export async function settlePush(env: Env, owner: string, repo: string, path: string, take: "mine" | "pushed") {
  const pushed = await pushedLines(env, owner, repo, path);
  if (!pushed) return false;
  if (take === "pushed") {
    const doc = (await (await toFile(env, owner, repo, path, owner, "file")).json()) as Doc;
    await land(env, owner, repo, { path, doc, next: pushed.lines, clean: false }, pushed.commit, owner);
  }
  await unclash(env, owner, repo, path);
  return true;
}

/** Where a mirror stands: its state, and how far ahead and behind it was at the last fetch. */
export async function mirrorStatus(env: Env, owner: string, repo: string) {
  const r = await repoRow(env, owner, repo, "artifact, crew_artifact, mirror_push_crew, mirror_primary, mirror_pull_only, mirror_path, branch, mirror_url, mirror_state, mirror_error, mirror_clash, mirror_down_since, mirror_synced_at, mirror_next_at, upstream_commit", { mirrored: true });
  const lg = localGit(env);
  if (!r || !lg) return null;
  const branch = (r.branch ?? "main") as string;
  const counts = await git(["rev-list", "--left-right", "--count", `refs/heads/${branch}...refs/upstream/${branch}`], await syncedDir(lg, r as unknown as Row));
  const [ahead, behind] = counts.code ? [0, 0] : counts.out.trim().split(/\s+/).map(Number);
  return {
    url: shownUrl(r.mirror_url as string), branch, state: (r.mirror_state ?? "ok") as State, error: r.mirror_error ?? null,
    clash: r.mirror_clash ? JSON.parse(r.mirror_clash as string) as string[] : [], downSince: r.mirror_down_since ?? null,
    syncedAt: r.mirror_synced_at ?? null, nextAt: r.mirror_next_at ?? null, upstreamCommit: r.upstream_commit ?? null,
    ahead: ahead ?? 0, behind: behind ?? 0, identity: gitIdentity(), truth: await truthOf(env, owner),
    // Private lines: whether it has any, and whether the crew's copy (real text) is the one that goes upstream.
    private: !!r.crew_artifact, pushCrew: !!r.mirror_push_crew,
    // Which side leads (#464). With "here", ahead is how far behind upstream (the backup) is, as of syncedAt.
    primary: primaryOf(r.mirror_primary),
    // One-way (#1009): it pulls, and nothing it does pushes.
    pullOnly: !!r.mirror_pull_only,
    // A folder mirror (folder-mirror.ts): the folder of upstream it mirrors, and the branch its work goes up as.
    path: (r.mirror_path ?? null) as string | null, sends: r.mirror_path ? sendBranch(repo) : null,
  };
}

/** GET|POST /api/repos/:o/:r/mirror, for someone who can read the repo. */
export async function mirrorRepoRoute(req: Request, env: Env, owner: string, repo: string, user: string | null) {
  if (req.method === "POST") {
    if (user !== owner) return json({ error: "owner only" }, 403);
    const b = await readBody<"resolve" | "pushCrew" | "primary" | "pullOnly">(req);
    const resolve = (["mine", "upstream", "rebase"] as const).find((r) => r === b.resolve);
    if (b.resolve !== undefined && !resolve) return json({ error: "resolve: mine, upstream or rebase" }, 400);
    if (b.pushCrew !== undefined && typeof b.pushCrew !== "boolean") return json({ error: "pushCrew: true or false" }, 400);
    if (b.pullOnly !== undefined && typeof b.pullOnly !== "boolean") return json({ error: "pullOnly: true or false" }, 400);
    if (b.primary !== undefined && !PRIMARIES.includes(b.primary as Primary)) return json({ error: "primary: here or upstream" }, 400);
    if (b.primary === "here" && await folderOf(env, owner, repo)) return json({ error: "a folder mirror can't lead: upstream's main takes its work through a pull request" }, 409);
    if (b.primary !== undefined) await env.DB.prepare("UPDATE repos SET mirror_primary = ? WHERE owner = ? AND name = ? AND mirror_url IS NOT NULL").bind(b.primary === "here" ? "here" : null, owner, repo).run();
    if (b.pullOnly !== undefined) await env.DB.prepare("UPDATE repos SET mirror_pull_only = ? WHERE owner = ? AND name = ? AND mirror_url IS NOT NULL").bind(b.pullOnly ? 1 : null, owner, repo).run();
    if (b.pushCrew !== undefined) await env.DB.prepare("UPDATE repos SET mirror_push_crew = ? WHERE owner = ? AND name = ? AND mirror_url IS NOT NULL").bind(b.pushCrew ? 1 : null, owner, repo).run();
    await syncMirror(env, owner, repo, { resolve });
  }
  const s = await mirrorStatus(env, owner, repo);
  return s ? json(s) : json({ error: "not a mirror" }, 404);
}

// Branches. The sync above keeps the default branch in step; codeSplitter
// branches (agents', cuts, deps-*) aren't git branches but Durable Object copies
// of the files they touch (branches.ts), so they go both ways:
//
//   GET  /api/repos/:o/:r/mirror/branches            upstream's other branches, and which are open here
//   POST /api/repos/:o/:r/mirror/branches {ref, name?}
//        (owner) open upstream's branch `ref` here: a branch whose files are what `ref` changed
//   POST /api/repos/:o/:r/mirror/branches/:b/pull
//        (owner) branch :b takes what its upstream branch got since it last did
//   POST /api/repos/:o/:r/mirror/branches/:b/push
//        (owner) push branch :b upstream as a real git branch: one commit on main's tip with its
//        files as they are now, on top of what went up last time. Never forced.
//
// Pushing is on asking. Every sync of the mirror (the cron's too) follows the
// branches that came from or went to upstream: an open one takes its upstream
// branch's new commits, and a merged one's upstream branch is deleted once
// upstream's main holds all of it and nobody added to it since.
//
// refs/upstream-branches/<ref> is the commit of upstream's branch that the
// branch here has taken in (or pushed): where the next pull diffs from. It's
// out of the default branch's way (refs/upstream/main and refs/upstream/main/x can't both be).

const tracking = (ref: string) => `refs/upstream-branches/${ref}`;
/** A ref that keeps a branch's binary file (a blob) from a gc while the branch is open (#446). */
const pinned = (blob: string) => `refs/branch-blobs/${blob}`;
/** The blob at `rev:path`, or null. */
const blobAt = async (dir: string, rev: string, path: string) => { const r = await git(["rev-parse", "--verify", "--quiet", `${rev}:${path}`], dir); return r.code ? null : r.out.trim(); };

/** A branch's binary file's bytes, from the mirror's git (#446): null if it isn't a mirror or git lost it. */
export async function blobBytes(env: Env, owner: string, repo: string, blob: string): Promise<Uint8Array | null> {
  const r = await row(env, owner, repo), lg = localGit(env);
  if (!r || !lg || !/^[0-9a-f]{40,64}$/.test(blob)) return null;
  const p = Bun.spawn(["git", "cat-file", "blob", blob], { cwd: await syncedDir(lg, r), stdout: "pipe", stderr: "ignore" });
  const [code, bytes] = await Promise.all([p.exited, new Response(p.stdout).arrayBuffer()]);
  return code ? null : new Uint8Array(bytes);
}
const isText = (s: string) => !s.includes("\0");
/** Whether a text file fits as lines (archive.ts readText's limits). */
const fitsLines = (s: string) => new TextEncoder().encode(s).length <= MAX_BYTES && s.split("\n").length <= MAX_LINES;
type Setup = { r: Row; dir: string; main: string; net: Record<string, string> };
type BranchRow = { name: string; by: string; status: string; upstream_ref: string | null };
/** A failure with the status it goes back as. */
const refused = (error: string, status: number) => Object.assign(new Error(error), { status });

/** The repo, its synced git and how to reach upstream, or an error to send back. */
async function branchSetup(env: Env, owner: string, repo: string) {
  const r = await row(env, owner, repo), lg = localGit(env);
  if (!r || !lg) return { error: json({ error: "not a mirror" }, 404) } as const;
  return { r, dir: await syncedDir(lg, r), main: r.branch ?? "main", net: await remoteEnv(env, owner, r.mirror_url) } as const;
}
const branchRow = (env: Env, owner: string, repo: string, name: string) =>
  env.DB.prepare("SELECT name, by, status, upstream_ref FROM branches WHERE owner = ? AND repo = ? AND name = ?").bind(owner, repo, name).first() as Promise<BranchRow | null>;

/** Upstream's branch `ref`, fetched: its tip, or null when upstream has no branch of that name. */
async function fetchBranch(s: Setup, ref: string) {
  const f = await git(["fetch", "--quiet", "--no-tags", s.r.mirror_url, `refs/heads/${ref}`], s.dir, s.net);
  if (f.code) {
    if (/couldn't find remote ref/i.test(f.err)) return null;
    throw refused(`upstream didn't answer: ${f.err}`, 502);
  }
  return must(["rev-parse", "FETCH_HEAD"], s.dir);
}
/** The commit of upstream's `ref` the branch here last took in or pushed, if this git has it. */
async function taken(s: Setup, ref: string) {
  const t = await git(["rev-parse", "--verify", "--quiet", `${tracking(ref)}^{commit}`], s.dir);
  return t.code ? null : t.out.trim();
}
/**
 * Where upstream's commit `c` left main; a shallow clone may not reach that far, and then it's main as it is.
 * One stacked on a branch main has since taken in as a squash left it at that branch's last head (#1200).
 */
async function forkPoint(s: Setup, c: string) {
  const ours = await must(["rev-parse", `refs/heads/${s.main}`], s.dir), mb = await mergeBase(s, c);
  return mb === ours ? ours : await squashedUnder(s.dir, mb, ours, c) ?? mb;
}
/** Git's own merge base of main and `c`, or main as it is when the clone doesn't reach that far. */
async function mergeBase(s: Setup, c: string) {
  const ours = `refs/heads/${s.main}`, mb = await git(["merge-base", ours, c], s.dir);
  return mb.code ? await must(["rev-parse", ours], s.dir) : mb.out.trim();
}

/** How many commits squashedUnder looks through on each side, newest first. */
const SQUASH_LOOK = 50;
/**
 * The newest commit on `c`'s side of `base` whose changes main held at one of its commits since, or null (#1200):
 * the head of a parent branch that was squash-merged onto main, so git's merge base would replay its commits as
 * `c`'s own. Main's commit holds a file's changes when it has the same text, or its other changes since `base`,
 * laid on the commit's copy, give its text (sync.ts merge3). Main may change the file again after the squash.
 */
async function squashedUnder(dir: string, base: string, main: string, c: string) {
  if (base === main || base === c) return null;
  const changed = async (to: string) => (await must(["diff", "--name-only", "--no-renames", base, to], dir)).split("\n").filter(Boolean);
  const list = async (...args: string[]) => (await must(["rev-list", `--max-count=${SQUASH_LOOK}`, ...args, `^${base}`], dir)).split("\n").filter(Boolean);
  const mains = await Promise.all((await list("--first-parent", main)).map(async (m) => ({ m, files: new Set(await changed(m)) })));
  const texts = new Map<string, Promise<string | null>>();
  const at = (rev: string, path: string) => texts.get(`${rev}:${path}`) ?? texts.set(`${rev}:${path}`, show(dir, rev, path)).get(`${rev}:${path}`)!;
  const holds = async (rev: string, m: string, path: string) => {
    const [was, now, mine] = await Promise.all([at(base, path), at(m, path), at(rev, path)]);
    if (mine === now) return true;
    if (was === null || now === null || mine === null) return false;
    // Main's changes past this commit's, laid on base, then this commit's on top: main's text only if it held them.
    const others = merge3(fromDisk(mine), fromDisk(was), fromDisk(now));
    const both = others && merge3(fromDisk(was), others, fromDisk(mine));
    return !!both && both.join("\n") === fromDisk(now).join("\n");
  };
  for (const rev of await list("--topo-order", c)) {
    const files = await changed(rev);
    if (!files.length) continue;
    for (const { m, files: on } of mains) {
      if (files.every((f) => on.has(f)) && (await Promise.all(files.map((f) => holds(rev, m, f)))).every(Boolean)) return rev;
    }
  }
  return null;
}

/** Upstream's branches other than the default, newest commit first, each with its tip and the branch here that follows it, if any. */
export async function upstreamBranches(env: Env, owner: string, repo: string) {
  const s = await branchSetup(env, owner, repo);
  if ("error" in s) return s.error;
  const ls = await git(["ls-remote", "--heads", s.r.mirror_url], s.dir, s.net);
  if (ls.code) return json({ error: `upstream didn't answer: ${ls.err}` }, 502);
  const { results } = await env.DB.prepare("SELECT name, upstream_ref, status FROM branches WHERE owner = ? AND repo = ?").bind(owner, repo).all();
  const here = new Map((results as { name: string; upstream_ref: string | null; status: string }[]).filter((b) => b.upstream_ref).map((b) => [b.upstream_ref!, b]));
  const list = heads(ls.out).filter(([ref]) => ref !== s.main);
  const at = await tipDates(s, list);
  return json(list.map(([ref, commit]) => {
    const b = here.get(ref);
    return { ref, commit, at: at.get(commit) ?? null, branch: b?.name ?? null, status: b?.status ?? null };
  }).sort((a, b) => (b.at ?? 0) - (a.at ?? 0)));
}
/**
 * When each tip was committed, in ms. Tips this git doesn't have yet are fetched
 * (only their commits past what it has); no ref keeps them, so a gc may take them
 * back and the next list fetches them again. A tip that won't come is left undated.
 */
async function tipDates(s: Setup, tips: (readonly [string, string])[]) {
  const dated = async () => new Map((await git(["log", "--no-walk", "--ignore-missing", "--format=%H %ct", ...tips.map(([, c]) => c)], s.dir)).out
    .split("\n").filter(Boolean).map((l) => { const [c, t] = l.split(" "); return [c!, Number(t) * 1000] as const; }));
  if (!tips.length) return new Map<string, number>();
  const at = await dated();
  const missing = tips.filter(([, c]) => !at.has(c));
  if (!missing.length) return at;
  for (let i = 0; i < missing.length; i += 50) {
    const r = await git(["fetch", "--quiet", "--no-tags", s.r.mirror_url, ...missing.slice(i, i + 50).map(([ref]) => `refs/heads/${ref}`)], s.dir, s.net);
    if (r.code) break;
  }
  return dated();
}
const heads = (lsRemote: string) => lsRemote.trim().split("\n").filter(Boolean).map((l) => {
  const [commit, full] = l.split("\t") as [string, string];
  return [full.replace(/^refs\/heads\//, ""), commit] as const;
});

/**
 * Bring upstream's changes `from`..`to` into branch `b` here: each file they
 * changed gets a copy on the branch with its text, merged into the copy's live
 * lines (main's, for a file the branch hadn't touched) where those moved on too
 * (sync.ts merge3; where they touch the same lines, upstream wins). New files
 * are new on the branch. A file the branch hasn't touched that's already as
 * main has it stays main's. A file upstream deleted is deleted on the branch
 * (one only the branch had just goes). A binary one, or one too big to dig, comes over as its git blob
 * (#446), pinned so a gc keeps it until the branch merges or goes up.
 */
async function take(env: Env, owner: string, repo: string, s: Setup, b: string, from: string, to: string) {
  const { materializeOn, createOn, deleteOn } = await import("./branches.ts");
  const { results } = await env.DB.prepare("SELECT path, deleted, blob FROM branch_files WHERE owner = ? AND repo = ? AND branch = ?").bind(owner, repo, b).all();
  const rows = new Map((results as { path: string; deleted: number; blob: string | null }[]).map((f) => [f.path, f]));
  const onBranch = new Map([...rows].map(([p, f]) => [p, !!f.deleted]));
  const files: string[] = [], deleted: string[] = [], skipped: string[] = [];
  const changed = (await must(["diff", "--name-status", "-z", "--no-renames", from, to], s.dir)).split("\0").filter(Boolean);
  const onMain = (path: string) => git(["cat-file", "-e", `refs/heads/${s.main}:${path}`], s.dir).then((r) => !r.code);
  for (let i = 0; i < changed.length; i += 2) {
    const [kind, path] = [changed[i]!, changed[i + 1]!];
    if (kind === "D") {
      // Gone upstream: gone here too, unless it's gone already (from the branch, or main).
      if (onBranch.get(path) || (!onBranch.has(path) && !await onMain(path))) continue;
      ((await deleteOn(env, owner, repo, b, path)).ok ? deleted : skipped).push(path);
      continue;
    }
    const text = await show(s.dir, to, path);
    if (text === null) { skipped.push(path); continue; }
    // Too big to dig (a lockfile, say) is carried as its blob too, not skipped: a skip dropped it from the merge.
    if (!isText(text) || !fitsLines(text)) {
      const [mode, , blob] = (await must(["ls-tree", to, "--", path], s.dir)).split(/\s+/) as [string, string, string];
      if (!onBranch.has(path) && blob === await blobAt(s.dir, `refs/heads/${s.main}`, path)) continue;
      await must(["update-ref", pinned(blob), blob], s.dir);
      const was = rows.get(path);
      if (was && !was.deleted && !was.blob) await toFile(env, owner, repo, path, "upstream", "wipe", { method: "POST" }, "", b);
      await env.DB.prepare(`INSERT INTO branch_files (owner, repo, branch, path, blob, mode) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (owner, repo, branch, path) DO UPDATE SET blob = excluded.blob, mode = excluded.mode, deleted = 0, merged = 0`).bind(owner, repo, b, path, blob, mode).run();
      files.push(path);
      continue;
    }
    if (!onBranch.has(path) && text === await show(s.dir, `refs/heads/${s.main}`, path)) continue;
    if (rows.get(path)?.blob) {
      // Binary on the branch, text now: its copy starts over as lines.
      ((await createOn(env, owner, repo, b, path, text.replace(/\n$/, ""), "upstream")).ok ? files : skipped).push(path);
      continue;
    }
    const next = fromDisk(text);
    const m = await materializeOn(env, owner, repo, b, path);
    if ("error" in m) {
      if (m.status !== 404) { skipped.push(path); continue; }
      const made = await createOn(env, owner, repo, b, path, text.replace(/\n$/, ""), "upstream");
      (made.ok ? files : skipped).push(path);
      continue;
    }
    const doc = (await (await toFile(env, owner, repo, path, "upstream", "file", {}, "", b)).json()) as Doc;
    const was = fromDisk((await show(s.dir, from, path)) ?? ""), lines = doc.lines.map((l) => l.text);
    const ops = diffToOps(doc.lines, merge3(was, lines, next) ?? next);
    if (ops.length) await toFile(env, owner, repo, path, "upstream", "ops", { method: "POST", body: JSON.stringify({ ops, ifRev: doc.rev }) }, "", b);
    files.push(path);
  }
  return { files, deleted, skipped };
}

/**
 * Whether main's git changed `path` since branch `name`'s upstream branch left it, to something
 * other than the branch's `blob`: merging the blob in whole would drop main's change.
 */
export async function blobMovedOnMain(env: Env, owner: string, repo: string, name: string, path: string, blob: string) {
  const s = await branchSetup(env, owner, repo), br = await branchRow(env, owner, repo, name);
  if ("error" in s || !br?.upstream_ref) return false;
  const tip = await taken(s, br.upstream_ref);
  if (!tip) return false;
  const main = await blobAt(s.dir, `refs/heads/${s.main}`, path);
  return main !== blob && main !== await blobAt(s.dir, await forkPoint(s, tip), path);
}

/** Branch `name` takes upstream's `ref` up to `theirs`: what it got since the branch here last took it in or pushed. */
async function catchUp(env: Env, owner: string, repo: string, s: Setup, name: string, ref: string, theirs: string) {
  const had = await taken(s, ref);
  if (had) await ontoSquash(env, owner, repo, s, name, ref, had);
  const from = had ?? await forkPoint(s, theirs);
  const got = from === theirs ? { files: [], deleted: [], skipped: [] } : await take(env, owner, repo, s, name, from, theirs);
  await must(["update-ref", tracking(ref), theirs], s.dir);
  return got;
}

/** The head of the squash-merged branch a branch's copies were last re-based on (ontoSquash). */
const squashRef = (ref: string) => `refs/upstream-squashed/${ref}`;
/**
 * Branch `name`, at upstream's `had`, was stacked on a branch main has since taken in as a squash (#1200):
 * its copies move onto main's files, so it merges only what's its own. A file only the parent changed goes
 * back to main's; one it changed too starts again from main's copy with its own changes on top (sync.ts merge3).
 * A copy edited here since it came from upstream is left as it is. Once per squash.
 */
async function ontoSquash(env: Env, owner: string, repo: string, s: Setup, name: string, ref: string, had: string) {
  const under = await forkPoint(s, had);
  if (under === await mergeBase(s, had)) return;
  const done = await git(["rev-parse", "--verify", "--quiet", squashRef(ref)], s.dir);
  if (!done.code && done.out.trim() === under) return;
  const mine = new Set((await must(["diff", "--name-only", "--no-renames", under, had], s.dir)).split("\n").filter(Boolean));
  const { results } = await env.DB.prepare("SELECT path, deleted, blob FROM branch_files WHERE owner = ? AND repo = ? AND branch = ? AND merged = 0 AND source IS NULL").bind(owner, repo, name).all();
  const drop = (path: string) => env.DB.prepare("DELETE FROM branch_files WHERE owner = ? AND repo = ? AND branch = ? AND path = ?").bind(owner, repo, name, path).run();
  for (const f of results as { path: string; deleted: number; blob: string | null }[]) {
    if (f.deleted || f.blob) { if (!mine.has(f.path)) await drop(f.path); continue; }
    const read = async (op: string, on?: string) => (await toFile(env, owner, repo, f.path, "upstream", op, {}, "", on)).json() as Promise<Doc>;
    const [base, copy] = await Promise.all([read("base", name), read("file", name)]);
    // Lines written here, not taken in from upstream: somebody's edit, which a re-base would lose.
    const was = new Map(base.lines.map((l) => [l.id, l.rev]));
    if (copy.lines.some((l) => was.get(l.id) !== l.rev && l.by !== "upstream")) continue;
    // Main has no copy to start from: the branch's stays.
    const next = await show(s.dir, had, f.path);
    if ("error" in await materialize(env, owner, repo, f.path) || (mine.has(f.path) && next === null)) continue;
    await toFile(env, owner, repo, f.path, "upstream", "wipe", { method: "POST" }, "", name);
    if (!mine.has(f.path)) { await drop(f.path); continue; }
    const doc = await read("file");
    await toFile(env, owner, repo, f.path, "upstream", "fork", { method: "POST", body: JSON.stringify({ doc }) }, "", name);
    const lines = doc.lines.map((l) => l.text), theirs = fromDisk(next!);
    const ops = diffToOps(doc.lines, merge3(fromDisk((await show(s.dir, under, f.path)) ?? ""), lines, theirs) ?? theirs);
    if (ops.length) await toFile(env, owner, repo, f.path, "upstream", "ops", { method: "POST", body: JSON.stringify({ ops }) }, "", name);
  }
  await must(["update-ref", squashRef(ref), under], s.dir);
}

/**
 * Why upstream's branch `ref` changed `path`: its commit messages since it left main, newest first,
 * up to the commit the branch here last took in or pushed. Read from this git, no fetch; the
 * commits this copy pushed up ("…, from codeSplitter") and merges are left out (#990).
 */
export async function upstreamMessages(env: Env, owner: string, repo: string, ref: string, path: string, n = 10) {
  const s = await branchSetup(env, owner, repo);
  if ("error" in s) return [];
  const tip = await taken(s, ref);
  if (!tip) return [];
  const log = await git(["log", "--no-merges", "--format=%s", `${await forkPoint(s, tip)}..${tip}`, "--", path], s.dir);
  return log.code ? [] : log.out.split("\n").filter((m) => m && !m.endsWith(", from codeSplitter")).slice(0, n);
}

/** Open upstream's branch `ref` here as a codeSplitter branch of what it changed since it left main (see take). */
export async function openUpstreamBranch(env: Env, owner: string, repo: string, ref: string, user: string, name?: string) {
  const s = await branchSetup(env, owner, repo);
  if ("error" in s) return s.error;
  if (!ref || ref === s.main || (await git(["check-ref-format", "--branch", ref])).code) return json({ error: "bad upstream branch" }, 400);
  // It keeps upstream's name: git took it, so we do too.
  const b = name ?? ref, bad = branchNameError(b);
  if (bad) return json({ error: `bad branch name: ${bad}${name ? "" : "; give one with name"}` }, 400);
  const theirs = await fetchBranch(s, ref);
  if (!theirs) return json({ error: `upstream has no branch ${ref}` }, 404);
  const base = await forkPoint(s, theirs);

  const claim = await env.DB.prepare("INSERT OR IGNORE INTO branches (owner, repo, name, by, status, created_at, upstream_ref) VALUES (?, ?, ?, ?, 'open', ?, ?)").bind(owner, repo, b, user, Date.now(), ref).run();
  if (!claim.meta?.changes) return json({ error: "branch exists" }, 409);
  const got = await take(env, owner, repo, s, b, base, theirs);
  await must(["update-ref", tracking(ref), theirs], s.dir);
  // Taken in from a squashed parent's head already: nothing to re-base.
  if (base !== await mergeBase(s, theirs)) await must(["update-ref", squashRef(ref), base], s.dir);
  const { emit } = await import("./hooks.ts");
  await emit(env, owner, repo, "branch.opened", user, { ref: b, ref_type: "branch", master_branch: "main" });
  await startChecks(env, owner, repo, b, theirs, user);
  return json({ name: b, ref, commit: theirs, ...got }, 201);
}

/** Branch `name` takes what its upstream branch got since it last did. */
export async function pullBranch(env: Env, owner: string, repo: string, name: string) {
  const s = await branchSetup(env, owner, repo);
  if ("error" in s) return s.error;
  const br = await branchRow(env, owner, repo, name);
  if (!br) return json({ error: "no such branch" }, 404);
  if (br.status !== "open") return json({ error: `branch is ${br.status}` }, 409);
  if (!br.upstream_ref) return json({ error: "it hasn't been upstream: push it first" }, 409);
  const theirs = await fetchBranch(s, br.upstream_ref);
  if (!theirs) return json({ error: `upstream has no branch ${br.upstream_ref} any more` }, 404);
  const got = await catchUp(env, owner, repo, s, name, br.upstream_ref, theirs);
  // What it took is upstream's commit, which GitHub may be checking already.
  if (got.files.length) await startChecks(env, owner, repo, name, theirs, br.by);
  return json({ ref: br.upstream_ref, commit: theirs, ...got });
}

/**
 * Branch `name`'s files, as they are now, laid over `baseTree` in the git at `dir`: the
 * tree a push upstream commits, and a beam of a codeSplitter branch (beam.ts) starts from.
 */
export async function branchTree(env: Env, owner: string, repo: string, name: string, dir: string, baseTree: string) {
  const { results } = await env.DB.prepare("SELECT path, deleted, blob, mode FROM branch_files WHERE owner = ? AND repo = ? AND branch = ? AND merged = 0 ORDER BY path").bind(owner, repo, name).all();
  const idx = join(tmpdir(), `codesplitter-branch-${crypto.randomUUID()}.index`), e = { GIT_INDEX_FILE: idx };
  try {
    await must(["read-tree", baseTree], dir, e);
    const gone: string[] = [];
    for (const { path, deleted, blob, mode: binMode } of results as { path: string; deleted: number; blob: string | null; mode: string | null }[]) {
      if (deleted) { gone.push(path); continue; }
      // A binary file is a blob this git has already.
      if (blob) { await must(["update-index", "--add", "--cacheinfo", `${binMode ?? "100644"},${blob},${path}`], dir, e); continue; }
      const doc = (await (await toFile(env, owner, repo, path, "upstream", "file", {}, "", name)).json()) as Doc;
      // As main's commits write it (archive.ts pushCatalogues): the lines, ending in one newline (#1041).
      const text = (t => t.endsWith("\n") ? t : t + "\n")(doc.lines.map((l) => l.text).join("\n"));
      const put = Bun.spawn(["git", "hash-object", "-w", "--stdin"], { cwd: dir, stdin: new TextEncoder().encode(text), stdout: "pipe", stderr: "pipe" });
      const [, hash] = await Promise.all([put.exited, new Response(put.stdout).text()]);
      const mode = (await must(["ls-tree", baseTree, "--", path], dir)).split(" ")[0] || "100644";
      await must(["update-index", "--add", "--cacheinfo", `${mode},${hash.trim()},${path}`], dir, e);
    }
    // The ones it deleted: a zero entry takes each out (a bare repo has no work tree for --force-remove).
    if (gone.length) {
      const rm = Bun.spawn(["git", "update-index", "-z", "--index-info"], { cwd: dir, env: { ...process.env, ...e }, stdin: new TextEncoder().encode(gone.map((p) => `0 ${"0".repeat(40)}\t${p}\0`).join("")), stdout: "ignore", stderr: "pipe" });
      if (await rm.exited) throw new Error(await new Response(rm.stderr).text() || "git update-index exited");
    }
    return await must(["write-tree"], dir, e);
  } finally { rmSync(idx, { force: true }); }
}

/**
 * Push branch `name` upstream, to the git branch it came from (or one of its
 * own name): main's tip with the branch's files as they are now, as one commit.
 * Upstream's branch moved since? The branch takes that in first, so nothing up
 * there is written over. After the first push it builds on what's up there,
 * merging main in when main moved, so upstream only ever fast-forwards. A repo
 * whose git holds private lines blank (held) doesn't push branches either: their
 * copies have the real text.
 */
export async function pushBranch(env: Env, owner: string, repo: string, name: string, o: { tookMain?: boolean } = {}) {
  const s = await branchSetup(env, owner, repo);
  if ("error" in s) return s.error;
  const { r, dir, main, net } = s;
  if (r.mirror_pull_only) return json({ error: "this mirror is pull-only, so nothing goes upstream" }, 409);
  if (r.crew_artifact && !r.mirror_push_crew) return json({ error: "this repo has private lines, and nothing goes upstream until you push the crew's copy" }, 409);
  const br = await branchRow(env, owner, repo, name);
  if (!br) return json({ error: "no such branch" }, 404);
  if (br.status !== "open") return json({ error: `branch is ${br.status}` }, 409);
  const ref = br.upstream_ref ?? br.name, track = tracking(ref), heads = `refs/heads/${ref}`;
  if (ref === main) return json({ error: "that's the branch the mirror keeps in step" }, 409);

  // What's up there now, if anything, taken in first.
  const prev = await fetchBranch(s, ref);
  const took = prev ? (await catchUp(env, owner, repo, s, name, ref, prev)).files : [];
  if (!prev) await git(["update-ref", "-d", track], dir);
  const tip = await must(["rev-parse", `refs/heads/${main}`], dir);
  let parents = [tip], baseTree = `${tip}^{tree}`;
  if (prev && await isAncestor(dir, tip, prev)) [parents, baseTree] = [[prev], `${prev}^{tree}`];
  else if (prev) {
    const m = await git(["merge-tree", "--write-tree", "--name-only", "--no-messages", prev, tip], dir);
    const clash = m.code === 1 ? m.out.trim().split("\n").slice(1).filter(Boolean) : [];
    // Git clashes, but the branch just took main in by line id (branches.ts takeMain, #1162): its copies of
    // those files are the settled ones, so the merge commit is main's tree with them on top.
    if (clash.length && o.tookMain && await allText(env, owner, repo, name, clash)) [parents, baseTree] = [[prev, tip], `${tip}^{tree}`];
    // Git replays a squash-merged parent's commits as clashes (#1200): the files only the parent changed are
    // main's, and the branch's own are its copies, already re-based on main's (ontoSquash).
    else if (clash.length && await onSquash(env, owner, repo, s, name, prev, clash)) [parents, baseTree] = [[prev, tip], `${tip}^{tree}`];
    else if (m.code) return json({ error: `upstream's ${ref} and main ${m.code === 1 ? "changed the same lines" : "share no history"}: settle it upstream, then push again`, clash }, 409);
    else [parents, baseTree] = [[prev, tip], m.out.trim().split("\n")[0]!];
  }

  const tree = await branchTree(env, owner, repo, name, dir, baseTree);
  if (parents.length === 1 && parents[0] === prev && tree === await must(["rev-parse", `${prev}^{tree}`], dir)) return json({ ref, commit: prev, pushed: false, took });

  const message = `${name}, from codeSplitter${br.by === owner ? "" : `\n\nCo-authored-by: ${br.by} <${br.by}@${GIT_EMAIL_DOMAIN}>`}`;
  const c = await must(["commit-tree", tree, ...parents.flatMap((p) => ["-p", p]), "-m", message], dir, authorEnv());
  const p = await git(["push", "--porcelain", r.mirror_url, `${c}:${heads}`], dir, net);
  if (p.code) {
    const said = [p.err, p.out].filter(Boolean).join("\n");
    if (/\[rejected\]|non-fast-forward|fetch first/.test(said)) return json({ error: `upstream's ${ref} moved while pushing: push again` }, 409);
    return json({ error: said || "upstream didn't take the push" }, /\b40[13]\b|denied|permission|not allowed|protected branch|authentication|forbidden/i.test(said) ? 403 : 502);
  }
  await must(["update-ref", track, c], dir);
  if (!br.upstream_ref) await env.DB.prepare("UPDATE branches SET upstream_ref = ? WHERE owner = ? AND repo = ? AND name = ?").bind(ref, owner, repo, name).run();
  // A branch pushed upstream gets checked, here and on GitHub, as that commit.
  await startChecks(env, owner, repo, name, c, br.by);
  return json({ ref, commit: c, pushed: true, took });
}

/** Whether upstream's `prev` is stacked on a squash-merged parent, and `name` has a copy of each file it changed past it (one with lines where git clashes). */
async function onSquash(env: Env, owner: string, repo: string, s: Setup, name: string, prev: string, clash: string[]) {
  const under = await forkPoint(s, prev);
  if (under === await mergeBase(s, prev)) return false;
  const mine = new Set((await must(["diff", "--name-only", "--no-renames", under, prev], s.dir)).split("\n").filter(Boolean));
  const own = clash.filter((p) => mine.has(p));
  if (own.length && !await allText(env, owner, repo, name, own)) return false;
  // The tree starts from main's, so every file the branch changed must be one of its copies.
  const { results } = await env.DB.prepare("SELECT path FROM branch_files WHERE owner = ? AND repo = ? AND branch = ? AND merged = 0").bind(owner, repo, name).all();
  const kept = new Set((results as { path: string }[]).map((r) => r.path));
  return [...mine].every((p) => kept.has(p));
}

/** Whether `name` has a copy of its own, with lines, of each of `paths`. */
async function allText(env: Env, owner: string, repo: string, name: string, paths: string[]) {
  const { results } = await env.DB.prepare(`SELECT path FROM branch_files WHERE owner = ? AND repo = ? AND branch = ? AND merged = 0 AND deleted = 0 AND blob IS NULL AND path IN (${paths.map(() => "?").join(", ")})`).bind(owner, repo, name, ...paths).all();
  return results.length === new Set(paths).size;
}

/**
 * After a sync, the branches that follow upstream ones. An open one takes what
 * its upstream branch got since. A merged one's upstream branch is deleted once
 * upstream's main holds all of it (the merge here was committed and went up)
 * and nobody added to it since we last saw it; one somebody did add to is left be.
 */
async function followBranches(env: Env, owner: string, repo: string) {
  const { results } = await env.DB.prepare("SELECT name, by, status, upstream_ref FROM branches WHERE owner = ? AND repo = ? AND upstream_ref IS NOT NULL AND status IN ('open', 'merged')").bind(owner, repo).all();
  if (!results.length) return;
  const s = await branchSetup(env, owner, repo);
  if ("error" in s) return;
  const ls = await git(["ls-remote", "--heads", s.r.mirror_url], s.dir, s.net);
  if (ls.code) return;
  const tips = new Map(heads(ls.out)), up = `refs/upstream/${s.main}`;
  const forget = (name: string) => env.DB.prepare("UPDATE branches SET upstream_ref = NULL WHERE owner = ? AND repo = ? AND name = ?").bind(owner, repo, name).run();
  for (const br of results as (BranchRow & { upstream_ref: string })[]) {
    try {
      const ref = br.upstream_ref, tip = tips.get(ref), had = await taken(s, ref);
      if (!tip) { if (br.status === "merged") await forget(br.name); continue; }
      if (br.status === "open") {
        // Main may have taken in a branch this one's stacked on (ontoSquash), even when this one didn't move.
        const theirs = tip === had ? tip : await fetchBranch(s, ref);
        if (theirs) {
          await catchUp(env, owner, repo, s, br.name, ref, theirs);
          await clashOnlyInGit(env, owner, repo, s, br.name, theirs);
          // Its place in the merge plan, as a status GitHub's merge-when-ready can wait on (#1219).
          await postOrder(env, owner, repo, br.name, theirs).catch(() => null);
        }
        continue;
      }
      // Deleting a merged branch upstream is a push too: a pull-only mirror leaves it be.
      if (tip !== had || s.r.mirror_pull_only) continue;
      const m = await git(["merge-tree", "--write-tree", up, tip], s.dir);
      if (m.code || m.out.trim().split("\n")[0] !== await must(["rev-parse", `${up}^{tree}`], s.dir)) continue;
      const d = await git(["push", "--porcelain", `--force-with-lease=refs/heads/${ref}:${tip}`, s.r.mirror_url, `:refs/heads/${ref}`], s.dir, s.net);
      if (d.code) continue;
      await git(["update-ref", "-d", tracking(ref)], s.dir);
      await git(["update-ref", "-d", squashRef(ref)], s.dir);
      await forget(br.name);
    } catch { /* that branch tries again next sync */ }
  }
}

/** Each open branch's upstream tip and main's, as clashOnlyInGit last looked at them: it looks at each pair once. */
const lookedAt = new Map<string, string>();

/**
 * Upstream's tip `theirs` of open branch `name`, and main's tip, clash in git (#1190): GitHub's pull request
 * shows a conflict until main comes in. When the line-id merge settles it, the branch takes main in and
 * pushes that (branches.ts takeMainUpstream). Main's git holds a merge from its next commit, which a sync
 * follows, so this runs here and not in the merge. A mirror that pushes no branches leaves it be.
 */
async function clashOnlyInGit(env: Env, owner: string, repo: string, s: Setup, name: string, theirs: string) {
  if (s.r.mirror_pull_only || (s.r.crew_artifact && !s.r.mirror_push_crew)) return;
  const tip = await must(["rev-parse", `refs/heads/${s.main}`], s.dir), key = `${s.dir}\n${name}`, pair = `${theirs} ${tip}`;
  if (lookedAt.get(key) === pair) return;
  lookedAt.set(key, pair);
  if ((await git(["merge-tree", "--write-tree", "--name-only", "--no-messages", theirs, tip], s.dir)).code !== 1) return;
  const { takeMainUpstream } = await import("./branches.ts");
  await takeMainUpstream(env, owner, repo, name);
}

/** /api/repos/:o/:r/mirror/branches[/:b/pull|push]: reading is for anyone who can read the repo, the rest for its owner. */
/** A folder mirror's folder, or null for a whole-repo mirror or any other repo. */
const folderOf = async (env: Env, owner: string, repo: string) =>
  ((await env.DB.prepare("SELECT mirror_path FROM repos WHERE owner = ? AND name = ? AND mirror_url IS NOT NULL").bind(owner, repo).first())?.mirror_path ?? null) as string | null;
const FOLDER_ONLY = "a folder mirror sends its work up as one branch of its own, so upstream's branches and tags stay upstream";

export async function mirrorBranchRoute(req: Request, env: Env, p: string[], owner: string, repo: string, user: string | null) {
  if (p[5] !== "branches") return null;
  if (await folderOf(env, owner, repo)) return json({ error: FOLDER_ONLY }, 409);
  if (!p[6] && req.method === "GET") return upstreamBranches(env, owner, repo);
  if (req.method !== "POST") return null;
  if (user !== owner) return json({ error: "owner only" }, 403);
  let run: () => Promise<Response | undefined>;
  if (!p[6]) {
    const b = await readBody<"ref" | "name">(req);
    if (typeof b.ref !== "string" || (b.name !== undefined && typeof b.name !== "string")) return json({ error: "give the upstream branch as ref" }, 400);
    run = () => openUpstreamBranch(env, owner, repo, b.ref as string, user, b.name as string | undefined);
  } else if (p[7] === "push" && !p[8]) run = () => pushBranch(env, owner, repo, p[6]!);
  else if (p[7] === "pull" && !p[8]) run = () => pullBranch(env, owner, repo, p[6]!);
  else return null;
  // One at a time with the repo's syncs, which follow these branches too.
  return serial(owner, repo, run).catch((e: Error & { status?: number }) => json({ error: e.message }, e.status ?? 500));
}

// Tags (#879). Syncs fetch with --no-tags; a mirror's tags come and go on asking:
//
//   GET  /api/repos/:o/:r/mirror/tags                upstream's tags, each here (same commit), differs, or not here
//   POST /api/repos/:o/:r/mirror/tags {names?}        (owner) fetch upstream's tags that aren't here (all, or these)
//   POST /api/repos/:o/:r/mirror/tags/:name/push      (owner) push the tag here upstream, never forced
//
// They're the repo's own git's tags (tags.ts makes and lists them), so a repo
// with private lines, whose own git isn't upstream's history, has none to trade.

type UpTag = { name: string; commit: string; here: "same" | "differs" | null };
/** Tags from `git ls-remote` or `for-each-ref` lines (a hash, then a ref), peeled to the commit. */
const tagsOf = (out: string) => {
  const m = new Map<string, string>();
  for (const l of out.split("\n")) {
    const [hash, ref] = l.trim().split(/\s+/);
    if (!hash || !ref?.startsWith("refs/tags/")) continue;
    if (ref.endsWith("^{}")) m.set(ref.slice(10, -3), hash);
    else if (!m.has(ref.slice(10))) m.set(ref.slice(10), hash);
  }
  return m;
};
/** The repo's own git and how to reach upstream, or why its tags can't go between them. */
async function tagSetup(env: Env, owner: string, repo: string) {
  const r = await row(env, owner, repo), lg = localGit(env);
  if (!r || !lg) throw refused("not a mirror", 404);
  if (r.crew_artifact) throw refused("this repo has private lines, so its git isn't upstream's history: its tags stay here", 409);
  return { r, dir: lg.path(r.artifact), net: await remoteEnv(env, owner, r.mirror_url) };
}
const hereTags = async (dir: string) => tagsOf(await must(["for-each-ref", "--format=%(objectname) %(refname)%0a%(*objectname) %(refname)^{}", "refs/tags"], dir));

/** Upstream's tags, highest version first, each with whether this repo has it. */
export async function upstreamTags(env: Env, owner: string, repo: string, s?: Awaited<ReturnType<typeof tagSetup>>): Promise<UpTag[]> {
  s ??= await tagSetup(env, owner, repo);
  const ls = await git(["ls-remote", "--tags", s.r.mirror_url], s.dir, s.net);
  if (ls.code) throw refused(`upstream didn't answer: ${ls.err}`, 502);
  const ours = await hereTags(s.dir);
  return [...tagsOf(ls.out)].map(([name, commit]) => ({ name, commit, here: ours.has(name) ? ours.get(name) === commit ? "same" as const : "differs" as const : null })).sort(byVersion);
}

/**
 * Fetch upstream's tags that this repo doesn't have (all, or those in `names`),
 * with the commits they name. A tag here already is left as it is, even where
 * upstream's names another commit. A mirror is a shallow clone, so the commits
 * come shallow too, not all the history behind them.
 */
export async function fetchTags(env: Env, owner: string, repo: string, names?: string[]) {
  const s = await tagSetup(env, owner, repo), up = await upstreamTags(env, owner, repo, s);
  const want = up.filter((t) => !t.here && (!names || names.includes(t.name)));
  const missing = names?.filter((n) => !up.some((t) => t.name === n)) ?? [];
  if (want.length) {
    const shallow = (await must(["rev-parse", "--is-shallow-repository"], s.dir)) === "true";
    for (let i = 0; i < want.length; i += 50) {
      const f = await git(["fetch", "--quiet", "--no-tags", ...(shallow ? ["--depth=1"] : []), s.r.mirror_url, ...want.slice(i, i + 50).map((t) => `refs/tags/${t.name}:refs/tags/${t.name}`)], s.dir, s.net, 10 * 60_000);
      if (f.code) throw refused(`upstream didn't send them: ${f.err}`, 502);
    }
  }
  return { fetched: want.map((t) => t.name), kept: up.filter((t) => t.here === "differs" && (!names || names.includes(t.name))).map((t) => t.name), missing };
}

/** Push this repo's tag `name` upstream. Never forced: upstream's own tag of that name stays. */
export async function pushTag(env: Env, owner: string, repo: string, name: string) {
  const s = await tagSetup(env, owner, repo), ours = (await hereTags(s.dir)).get(name);
  if (s.r.mirror_pull_only) throw refused("this mirror is pull-only, so nothing goes upstream", 409);
  if (!ours) throw refused(`no tag ${name} here`, 404);
  const p = await git(["push", "--porcelain", s.r.mirror_url, `refs/tags/${name}:refs/tags/${name}`], s.dir, s.net);
  const said = [p.err, p.out].filter(Boolean).join("\n");
  if (/\[up to date\]/.test(said)) return { pushed: false, name, commit: ours };
  if (p.code) throw refused(/\[rejected\]|already exists/.test(said) ? `upstream already has a tag ${name} on another commit` : `upstream didn't take it: ${said}`, /\[rejected\]|already exists/.test(said) ? 409 : 502);
  return { pushed: true, name, commit: ours };
}

/** /api/repos/:o/:r/mirror/tags[/:name/push]: reading is for anyone who can read the repo, the rest for its owner. */
export async function mirrorTagRoute(req: Request, env: Env, p: string[], owner: string, repo: string, user: string | null) {
  if (p[5] !== "tags") return null;
  if (await folderOf(env, owner, repo)) return json({ error: FOLDER_ONLY }, 409);
  let run: () => Promise<unknown>;
  if (!p[6] && req.method === "GET") run = () => upstreamTags(env, owner, repo);
  else if (req.method !== "POST") return null;
  else if (user !== owner) return json({ error: "owner only" }, 403);
  else if (!p[6]) {
    const b = (await req.json().catch(() => ({}))) as { names?: unknown };
    if (b.names !== undefined && !(Array.isArray(b.names) && b.names.every((n) => typeof n === "string" && !tagNameError(n)))) return json({ error: "names: a list of tag names" }, 400);
    run = () => fetchTags(env, owner, repo, b.names as string[] | undefined);
  } else if (p.at(-1) === "push" && p.length > 7) {
    const name = p.slice(6, -1).join("/"), bad = tagNameError(name);
    if (bad) return json({ error: bad }, 400);
    run = () => pushTag(env, owner, repo, name);
  }
  else return null;
  // One at a time with the repo's syncs.
  return serial(owner, repo, run).then((v) => json(v), (e: Error & { status?: number }) => json({ error: e.message }, e.status ?? 500));
}

/** A remote someone pasted:a GitHub repo in any of its forms, or any git URL. */
function remoteOf(s: string): { url: string; upstream: string; name: string } | null {
  const v = s.trim().replace(/^git\s+clone\s+/, "").split(/\s+/).find((w) => !w.startsWith("-")) ?? "";
  const anyGit = /^(?:https?|ssh|git|file):\/\//i.test(v) || /^[^\s@/]+@[^\s:/]+:/.test(v) || v.startsWith("/");
  const gh = !anyGit || /github\.com[:/]/i.test(v) ? parseRepo(s) : null;
  if (gh) return { url: `https://github.com/${gh}.git`, upstream: `github:${gh}`, name: gh.split("/")[1]! };
  if (!anyGit) return null;
  const last = v.replace(/\/+$/, "").split(/[/:]/).pop()!.replace(/\.git$/, "");
  return { url: v, upstream: shownUrl(v), name: last };
}

/** POST /api/mirrors {url, name?, visibility?}: clone any git remote into a repo you own that keeps in step with it. */
export async function mirrorRoutes(req: Request, env: Env, p: string[], user: string | null): Promise<Response | null> {
  if (p[1] !== "mirrors" || p[2] || req.method !== "POST") return null;
  if (!user) return json({ error: "sign in first" }, 401);
  const lg = localGit(env);
  if (!lg) return json({ error: "mirrors need git on your machine: dig it up in the desktop app" }, 501);
  const b = await readBody<"url" | "name" | "visibility" | "pullOnly" | "path" | "branch">(req);
  const src = typeof b.url === "string" ? remoteOf(b.url) : null;
  if (!src) return json({ error: "give a git remote: a GitHub owner/name, an https or ssh URL, or git@host:path" }, 400);
  if (b.name !== undefined && typeof b.name !== "string") return json({ error: "bad repo name" }, 400);
  // One folder of it (folder-mirror.ts): {path}, or a GitHub folder URL (.../tree/<branch>/<path>).
  let path: string | null = null, want: string | null = null;
  const folder = typeof b.url === "string" ? parseFolder(b.url) : null;
  if (folder) ({ branch: want, path } = await branchAndPath(src.upstream.replace(/^github:/, ""), folder));
  if (b.path !== undefined) path = b.path as string;
  if (b.branch !== undefined) want = typeof b.branch === "string" && !branchNameError(b.branch) ? b.branch : "";
  if (want === "") return json({ error: "bad branch name" }, 400);
  if (path !== null && !(path = folderPath(path))) return json({ error: "path: a folder of the repo, like apps/web" }, 400);
  if (path) return folderMirror(env, lg, user, src, path, want, b);
  const name = b.name || src.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!NAME.test(name)) return json({ error: "bad repo name" }, 400);
  const visibility = b.visibility ?? "public";
  if (visibility !== "public" && visibility !== "private") return json({ error: "visibility: public or private" }, 400);
  if (b.pullOnly !== undefined && typeof b.pullOnly !== "boolean") return json({ error: "pullOnly: true or false" }, 400);
  if (await repoRow(env, user, name, "1")) return json({ error: "you already have a repo with that name" }, 409);

  // Shallow, like a dig: upstream's history stays upstream, and our commits build on its tip.
  const art = `${user}--${name}`, dir = lg.path(art);
  rmSync(dir, { recursive: true, force: true });   // no row owns this name, so anything here is an orphan
  const c = await git(["clone", "--bare", "--quiet", "--single-branch", "--depth", "1", src.url, dir], undefined, await remoteEnv(env, user, src.url), 30 * 60_000);
  if (c.code) {
    rmSync(dir, { recursive: true, force: true });
    return json({ error: `couldn't clone ${shownUrl(src.url)}: ${c.err}` }, 502);
  }
  lg.stamp(dir, { description: `${user}'s mirror of ${src.upstream}`, source: src.upstream });
  const branch = await must(["symbolic-ref", "--short", "HEAD"], dir), sha = await must(["rev-parse", "HEAD"], dir);
  await must(["update-ref", `refs/upstream/${branch}`, sha], dir);
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO repos (owner, name, visibility, created_at, artifact, artifact_remote, branch, upstream, upstream_commit, mirror_url, mirror_pull_only, mirror_state, mirror_synced_at, mirror_next_at, mirror_fails, git_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok', ?, ?, 0, ?)`).bind(user, name, visibility, now, art, lg.remote(art), branch, src.upstream, sha, src.url, b.pullOnly ? 1 : null, now, now + EVERY, sha).run();
  return json({ owner: user, name, upstream: src.upstream, commit: sha, mirror: true, pullOnly: !!b.pullOnly }, 201);
}

/** POST /api/mirrors with a folder: a repo of upstream's folder alone, its history split out from here on. */
async function folderMirror(env: Env, lg: LocalGit, user: string, src: { url: string; upstream: string; name: string }, path: string, want: string | null, b: Record<string, unknown>) {
  const name = (b.name as string) || path.split("/").pop()!.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!NAME.test(name)) return json({ error: "bad repo name" }, 400);
  const visibility = b.visibility ?? "public";
  if (visibility !== "public" && visibility !== "private") return json({ error: "visibility: public or private" }, 400);
  if (b.pullOnly !== undefined && typeof b.pullOnly !== "boolean") return json({ error: "pullOnly: true or false" }, 400);
  if (await env.DB.prepare("SELECT 1 FROM repos WHERE owner = ? AND name = ?").bind(user, name).first()) return json({ error: "you already have a repo with that name" }, 409);
  const art = `${user}--${name}`, dir = lg.path(art), net = await remoteEnv(env, user, src.url);
  rmSync(dir, { recursive: true, force: true });   // no row owns this name, so anything here is an orphan
  const fail = (status: number, error: string) => { rmSync(dir, { recursive: true, force: true }); return json({ error }, status); };
  // Upstream's default branch, unless one was named: what its HEAD points at.
  let branch = want;
  if (!branch) {
    const ls = await git(["ls-remote", "--symref", src.url, "HEAD"], undefined, net, 60_000);
    branch = /^ref: refs\/heads\/(\S+)\s+HEAD/m.exec(ls.out)?.[1] ?? null;
    if (!branch) return fail(502, `couldn't reach ${shownUrl(src.url)}: ${ls.err || "no default branch"}`);
  }
  if ((await git(["init", "--quiet", "--bare", dir])).code) return fail(500, "couldn't make its git");
  const f = await git(["fetch", "--quiet", "--no-tags", "--depth", "1", src.url, `+refs/heads/${branch}:${sourceRef(branch)}`], dir, net, 30 * 60_000);
  if (f.code) return fail(502, `couldn't fetch ${shownUrl(src.url)} ${branch}: ${f.err}`);
  const source = await must(["rev-parse", sourceRef(branch)], dir);
  const tip = await split(git, dir, path, null, source, null);
  if (!tip) return fail(404, `${branch} has no folder ${path}`);
  for (const [ref, sha] of [[`refs/heads/${branch}`, tip], [`refs/upstream/${branch}`, tip], [splitFromRef(branch), source]]) await must(["update-ref", ref!, sha!], dir);
  await must(["symbolic-ref", "HEAD", `refs/heads/${branch}`], dir);
  const upstream = `${src.upstream}/tree/${branch}/${path}`;
  lg.stamp(dir, { description: `${user}'s mirror of ${upstream}`, source: upstream });
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO repos (owner, name, visibility, created_at, artifact, artifact_remote, branch, upstream, upstream_commit, mirror_url, mirror_pull_only, mirror_path, mirror_state, mirror_synced_at, mirror_next_at, mirror_fails, git_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok', ?, ?, 0, ?)`).bind(user, name, visibility, now, art, lg.remote(art), branch, upstream, tip, src.url, b.pullOnly ? 1 : null, path, now, now + EVERY, tip).run();
  return json({ owner: user, name, upstream, commit: tip, mirror: true, pullOnly: !!b.pullOnly, path, sends: sendBranch(name) }, 201);
}

// A dug fork, turned into a mirror (#875). A dig on the desktop is a shallow clone of upstream, so its git
// already holds the commit it was dug at (upstream_commit): that's the commit both sides agree on, and from
// there the usual sync takes over. Its own commits since the dig are ahead of upstream, so the first sync
// pushes them; the page says so, and asks first. Two sides that never synced shouldn't lose a line on it:
//
//   - the POST names how many commits it means to send up ({ahead}, as GET said), so nothing blind
//     (an agent, a stale page) pushes more than the owner saw, and
//   - the first sync asks whatever git_truth says: a clash or a rewritten upstream stops there, with
//     both sides as they were, for the owner to settle in the Upstream panel.
//
//   GET  /api/repos/:o/:r/mirror/turn  (owner) whether it can be turned, and what the first sync would send up
//   POST /api/repos/:o/:r/mirror/turn  (owner) turn it: a mirror from now on, synced at once

/** Where a fork's `upstream` can be fetched from and pushed to: a whole GitHub repo, or a git URL. Not a folder of one. */
export function upstreamRemote(upstream: string | null | undefined) {
  if (!upstream) return null;
  const gh = /^github:([\w.-]+\/[\w.-]+)$/.exec(upstream);
  if (gh) return `https://github.com/${gh[1]}.git`;
  return /^(?:https?|ssh|git|file):\/\//i.test(upstream) ? upstream : null;
}

type Turn = { artifact: string; url: string; branch: string; commit: string; ahead: number };
/** What turning `owner/repo` into a mirror would do, or why it can't be. */
async function turnable(env: Env, owner: string, repo: string): Promise<Turn | { error: string; status: number }> {
  const lg = localGit(env);
  if (!lg) return { error: "mirrors need git on your machine: turn it into one in the desktop app", status: 501 };
  const r = await repoRow(env, owner, repo, "artifact, branch, upstream, upstream_commit, mirror_url") as
    { artifact: string; branch: string | null; upstream: string | null; upstream_commit: string | null; mirror_url: string | null } | null;
  if (!r) return { error: "not found", status: 404 };
  if (r.mirror_url) return { error: "it's a mirror already", status: 409 };
  const url = upstreamRemote(r.upstream);
  if (!url) return { error: r.upstream ? "only a whole repo can be a mirror, not one folder of it" : "it isn't a fork of anything", status: 409 };
  const dir = lg.path(r.artifact), branch = r.branch ?? "main";
  // A dig too big to clone came from a tarball, as one commit of its own: nothing upstream would know.
  if (!r.upstream_commit || (await git(["cat-file", "-e", `${r.upstream_commit}^{commit}`], dir)).code)
    return { error: "its git doesn't have the commit it was dug at, so there's nothing to sync from: make a new mirror of upstream instead", status: 409 };
  // Its git started over since (a fresh start pushed to it): none of its commits build on upstream's.
  if (!(await isAncestor(dir, r.upstream_commit, `refs/heads/${branch}`)))
    return { error: "its history doesn't build on the commit it was dug at any more, so there's nothing to sync from: make a new mirror of upstream instead", status: 409 };
  const n = await git(["rev-list", "--count", `${r.upstream_commit}..refs/heads/${branch}`], dir);
  return { artifact: r.artifact, url, branch, commit: r.upstream_commit, ahead: n.code ? 0 : Number(n.out.trim()) };
}

/** GET|POST /api/repos/:o/:r/mirror/turn, for the owner. */
export async function turnRoute(req: Request, env: Env, owner: string, repo: string, user: string | null) {
  if (user !== owner) return json({ error: "owner only" }, 403);
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "GET or POST" }, 405);
  const b = req.method === "POST" ? (await req.json().catch(() => ({}))) as { ahead?: unknown } : {};
  const turned = await serial(owner, repo, async () => {
    const t = await turnable(env, owner, repo);
    if ("error" in t) return json({ error: t.error }, t.status);
    if (req.method === "GET") return json({ url: shownUrl(t.url), branch: t.branch, commit: t.commit, ahead: t.ahead });
    // What goes up is what the owner was shown: a commit made since (or a POST that never looked) asks again.
    if (b.ahead !== t.ahead) return json({ error: `${t.ahead} commit${t.ahead === 1 ? "" : "s"} made here would go up: say {ahead: ${t.ahead}} to send ${t.ahead === 1 ? "it" : "them"}`, ahead: t.ahead }, 409);
    // The agreed commit is upstream's tip as far as this copy knows; a mirror stays, with no dig's time limit.
    await must(["update-ref", `refs/upstream/${t.branch}`, t.commit], localGit(env)!.path(t.artifact));
    await env.DB.prepare("UPDATE repos SET mirror_url = ?, mirror_state = 'ok', mirror_error = NULL, mirror_clash = NULL, mirror_fails = 0, mirror_down_since = NULL, mirror_next_at = ?, expires_at = NULL WHERE owner = ? AND name = ? AND mirror_url IS NULL")
      .bind(t.url, Date.now(), owner, repo).run();
    return null;
  });
  if (turned) return turned;
  // Its first sync, now: upstream's news comes in, and this copy's commits since the dig go up. It asks before taking a side.
  await syncMirror(env, owner, repo, { ask: true });
  return json(await mirrorStatus(env, owner, repo), 201);
}
