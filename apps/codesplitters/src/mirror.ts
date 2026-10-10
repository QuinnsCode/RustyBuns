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
// Commits that go upstream carry this machine's git identity (user.name and
// user.email), with a Co-authored-by trailer when a handle like agent-claude made
// them (archive.ts). A repo with private lines is "held": its git has them blank,
// so it pulls but never pushes. Unless the owner says to push the crew's copy
// (real text): then that's the git kept in step with upstream, and the repo's
// own git follows it file by file, its private-lined files left as they are, so
// none of upstream's objects (which hold the real text by then) land in it.
//
//   POST /api/mirrors {url, name?, visibility?}  clone any git remote as a mirror you own (desktop only)
//   GET  /api/repos/:o/:r/mirror                 where it stands with upstream
//   POST /api/repos/:o/:r/mirror {resolve?, pushCrew?}
//        (owner) sync now; settle a clash with "mine" or "upstream", rewritten history with
//        "rebase" or "upstream"; pushCrew true sends the crew's copy upstream, false holds it

import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toFile } from "./archive.ts";
import { fromDisk } from "./agent-run.ts";
import { githubToken, parseRepo } from "./github.ts";
import { diffToOps, merge3 } from "./sync.ts";
import { json, NAME, type Env } from "./env.ts";
import type { Doc } from "./lines.ts";

/** How often a mirror that's in step looks again, and the longest a failing one waits. */
export const EVERY = 5 * 60_000, MAX_WAIT = 15 * 60_000;

/** The desktop's Artifacts: bare repos on this machine (shell-bun's LocalArtifacts). */
interface LocalGit { path(name: string): string; remote(name: string): string; stamp(p: string, o: { description?: string; source?: string }): void }
const localGit = (env: Env) => {
  const a = env.ARTIFACTS as unknown as Partial<LocalGit> | undefined;
  return typeof a?.path === "function" && typeof a.stamp === "function" && typeof Bun !== "undefined" ? a as LocalGit : null;
};
/** Mirrors need git on this machine to fetch and push: the desktop, not Cloudflare. */
export const mirrorsOn = (env: Env) => !!localGit(env);

type Run = { code: number; out: string; err: string };
async function git(args: string[], cwd?: string, env: Record<string, string> = {}, timeout = 120_000): Promise<Run> {
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
const isAncestor = async (dir: string, a: string, b: string) => (await git(["merge-base", "--is-ancestor", a, b], dir)).code === 0;
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
const authorEnv = (): Record<string, string> => {
  const id = gitIdentity() ?? { name: "codesplitters", email: "codesplitters@codesplitters.local" };
  return { GIT_AUTHOR_NAME: id.name, GIT_AUTHOR_EMAIL: id.email, GIT_COMMITTER_NAME: id.name, GIT_COMMITTER_EMAIL: id.email };
};

/** Who a mirror's commits are by, as git and upstream see them: this machine's git identity. Null for any other repo. */
export async function mirrorIdentity(env: Env, owner: string, repo: string) {
  if (!mirrorsOn(env)) return null;
  const r = await env.DB.prepare("SELECT mirror_url FROM repos WHERE owner = ? AND name = ?").bind(owner, repo).first();
  return r?.mirror_url ? gitIdentity() : null;
}

interface Row { owner: string; name: string; artifact: string; branch: string | null; crew_artifact: string | null; mirror_push_crew: number | null; mirror_url: string; mirror_fails: number | null; mirror_down_since: number | null; upstream_commit: string | null }
const row = (env: Env, owner: string, repo: string) =>
  env.DB.prepare("SELECT owner, name, artifact, branch, crew_artifact, mirror_push_crew, mirror_url, mirror_fails, mirror_down_since, upstream_commit FROM repos WHERE owner = ? AND name = ? AND mirror_url IS NOT NULL").bind(owner, repo).first() as Promise<Row | null>;

type State = "ok" | "down" | "refused" | "clash" | "held" | "rewritten";
export type Resolve = "mine" | "upstream" | "rebase";

/** The git that's kept in step with upstream: the crew's copy when the owner pushes it, else the repo's own. */
const syncedDir = (lg: LocalGit, r: { artifact: string; crew_artifact: string | null; mirror_push_crew: number | null }) =>
  lg.path(r.crew_artifact && r.mirror_push_crew ? r.crew_artifact : r.artifact);

/** A try that didn't work: say why, and back off (1, 2, 4… minutes, up to MAX_WAIT). */
async function failed(env: Env, r: Row, state: Exclude<State, "ok">, error: string, clash: string[] = []) {
  const fails = (r.mirror_fails ?? 0) + 1, now = Date.now();
  const downSince = state === "down" ? r.mirror_down_since ?? now : null;
  await env.DB.prepare("UPDATE repos SET mirror_state = ?, mirror_error = ?, mirror_clash = ?, mirror_down_since = ?, mirror_fails = ?, mirror_next_at = ? WHERE owner = ? AND name = ?")
    .bind(state, error.slice(0, 2000), clash.length ? JSON.stringify(clash) : null, downSince, fails, now + Math.min(MAX_WAIT, 60_000 * 2 ** (fails - 1)), r.owner, r.name).run();
  return state;
}

/** In step: upstream is at `tip`, and so are we (or we're ahead and it's held). */
async function settled(env: Env, r: Row, tip: string, state: "ok" | "held" = "ok", error: string | null = null) {
  const now = Date.now();
  await env.DB.prepare("UPDATE repos SET mirror_state = ?, mirror_error = ?, mirror_clash = NULL, mirror_down_since = NULL, mirror_fails = 0, mirror_synced_at = ?, mirror_next_at = ?, upstream_commit = ? WHERE owner = ? AND name = ?")
    .bind(state, error, now, now + EVERY, tip, r.owner, r.name).run();
  return state;
}

/** Something moved under this try (a commit here, a push upstream): go again on the next tick, as things stand. */
async function again(env: Env, r: Row) {
  await env.DB.prepare("UPDATE repos SET mirror_next_at = ? WHERE owner = ? AND name = ?").bind(Date.now(), r.owner, r.name).run();
  const s = await env.DB.prepare("SELECT mirror_state FROM repos WHERE owner = ? AND name = ?").bind(r.owner, r.name).first();
  return (s?.mirror_state ?? "ok") as State;
}

/** Each repo syncs one try at a time; a second ask waits for the first. */
const running = new Map<string, Promise<unknown>>();
export function syncMirror(env: Env, owner: string, repo: string, o: { resolve?: Resolve } = {}): Promise<State | null> {
  const key = `${owner}/${repo}`;
  const next = (running.get(key) ?? Promise.resolve()).catch(() => {}).then(() => step(env, owner, repo, o));
  running.set(key, next);
  next.finally(() => { if (running.get(key) === next) running.delete(key); }).catch(() => {});
  return next;
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

async function step(env: Env, owner: string, repo: string, o: { resolve?: Resolve }): Promise<State | null> {
  const r = await row(env, owner, repo), lg = localGit(env);
  if (!r || !lg) return null;
  const crew = !!(r.crew_artifact && r.mirror_push_crew);
  const dir = syncedDir(lg, r), branch = r.branch ?? "main", heads = `refs/heads/${branch}`, up = `refs/upstream/${branch}`;
  const net = await remoteEnv(env, owner, r.mirror_url);
  try {
    // 1. Hear from upstream. Only what's newer than the last commit both sides agreed on (a week's
    // slack, for clocks): a force-pushed history shares nothing with this copy, and fetched in full
    // it's all of upstream's past, when re-basing needs only its new tip. A fast-forward stops at
    // the agreed commit all the same. Upstream wound back past that is fetched the plain way.
    const agreed = r.upstream_commit && (await git(["cat-file", "-e", `${r.upstream_commit}^{commit}`], dir)).code === 0 ? r.upstream_commit : null;
    const since = agreed && Number(await must(["log", "-1", "--format=%ct", agreed], dir)) - 7 * 86_400;
    const fetch = (limit: string[]) => git(["fetch", "--quiet", "--no-tags", ...limit, r.mirror_url, `+${heads}:${up}`], dir, net);
    let f = await fetch(since ? [`--shallow-since=${since}`] : []);
    if (since && f.code && /shallow/i.test(f.err)) f = await fetch([]);
    if (f.code) return failed(env, r, "down", f.err || "upstream didn't answer");
    let theirs = await must(["rev-parse", up], dir), ours = await must(["rev-parse", heads], dir);
    const before = ours;

    // Upstream rewrote its history when the last commit both sides agreed on isn't in it any more.
    const rewritten = !!agreed && agreed !== theirs && !(await isAncestor(dir, agreed, theirs));
    const whose = "upstream's history was rewritten (a force-push), so there's nothing to merge with";

    // 2. Take what upstream has that we don't.
    if (rewritten || (ours !== theirs && !(await isAncestor(dir, theirs, ours)))) {
      let tip = theirs, clash: string[] = [], live: "mine" | "upstream" | undefined = o.resolve === "rebase" ? undefined : o.resolve;
      if (rewritten) {
        // Re-base: this copy's own commits, replayed on upstream's. Or take upstream's and let them go.
        if (o.resolve !== "rebase" && o.resolve !== "upstream") return failed(env, r, "rewritten", whose);
        if (o.resolve === "rebase") {
          const re = await replay(dir, ours, [agreed, theirs], theirs);
          if ("clash" in re) return failed(env, r, "rewritten", `${whose}, and replaying this copy's commits on it clashed`, re.clash);
          [tip, live] = [re.tip, "mine"];
        }
      } else if (!(await isAncestor(dir, ours, theirs))) {
        const m = await git(["merge-tree", "--write-tree", "--name-only", "--no-messages", ours, theirs], dir);
        if (m.code > 1) {
          // No common history to merge on, and no agreed commit to tell which commits are ours: all that's left is upstream's.
          if (o.resolve !== "upstream") return failed(env, r, "rewritten", `${whose}: ${m.err}`);
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
      const changes = await liveChanges(env, owner, repo, dir, ours, tip, live);
      if ("clash" in changes) return failed(env, r, "clash", "edits here that aren't committed yet touch the same lines upstream changed", changes.clash);
      for (const p of changes.plans) await land(env, owner, repo, p, tip);
      // A catalogue that landed meanwhile moved the branch: take it from the top next round.
      if ((await git(["update-ref", heads, tip, ours], dir)).code) return again(env, r);
      ours = tip;
    }
    // The crew's copy moved: the repo's own git takes the same files, all but the private-lined ones.
    if (crew && ours !== before) await follow(env, r, lg, dir, before, ours);

    // 3. Hand upstream what we have that it doesn't.
    if (ours !== theirs && !(await isAncestor(dir, ours, theirs))) {
      if (r.crew_artifact && !crew) return settled(env, r, theirs, "held", "this repo has private lines, and its git holds them blank, so nothing goes upstream");
      const p = await git(["push", "--porcelain", r.mirror_url, `${heads}:${heads}`], dir, net);
      if (p.code) {
        const said = [p.err, p.out].filter(Boolean).join("\n");
        // Upstream moved since the fetch: the next round merges it in, then pushes.
        if (/\[rejected\]|non-fast-forward|fetch first/.test(said)) return again(env, r);
        const refused = /\b40[13]\b|denied|permission|not allowed|protected branch|authentication|forbidden/i.test(said);
        return failed(env, r, refused ? "refused" : "down", said || "upstream didn't take the push");
      }
      await must(["update-ref", up, ours], dir);
      theirs = ours;
    }
    return settled(env, r, theirs);
  } catch (e) {
    return failed(env, r, "clash", `sync stopped: ${String((e as Error).message ?? e)}`);
  }
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
  const tmp = join(tmpdir(), `codesplitters-replay-${crypto.randomUUID()}`), e = { GIT_INDEX_FILE: `${tmp}.index` };
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
  const idx = join(tmpdir(), `codesplitters-follow-${crypto.randomUUID()}.index`), e = { GIT_INDEX_FILE: idx };
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
  const idx = join(tmpdir(), `codesplitters-mirror-${crypto.randomUUID()}.index`), e = { GIT_INDEX_FILE: idx };
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
 * wins). `next` null means upstream deleted it.
 */
async function liveChanges(env: Env, owner: string, repo: string, dir: string, ours: string, tip: string, resolve?: "mine" | "upstream"): Promise<{ plans: Plan[] } | { clash: string[] }> {
  const paths = (await must(["diff", "--name-only", "-z", "--no-renames", ours, tip], dir)).split("\0").filter(Boolean);
  if (!paths.length) return { plans: [] };
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
  return clash.length ? { clash } : { plans };
}

/** Put a plan into the file's Durable Object as upstream's edits; a file that was clean is committed there too. */
async function land(env: Env, owner: string, repo: string, p: Plan, tip: string) {
  if (p.next === null) {
    // Upstream deleted it: the file goes here too.
    await toFile(env, owner, repo, p.path, "upstream", "wipe", { method: "POST" });
    await env.DB.batch(["files", "file_search", "git_pending"].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE owner = ? AND repo = ? AND path = ?`).bind(owner, repo, p.path)));
    return;
  }
  const ops = diffToOps(p.doc.lines, p.next);
  if (ops.length) {
    const res = await toFile(env, owner, repo, p.path, "upstream", "ops", { method: "POST", body: JSON.stringify({ ops, ifRev: p.doc.rev }) });
    if (!res.ok) throw new Error(`${p.path} was edited while syncing; trying again`);
  }
  if (!p.clean) return;
  const c = await toFile(env, owner, repo, p.path, "upstream", "commit", { method: "POST", body: JSON.stringify({ message: `upstream ${tip.slice(0, 7)}` }) });
  const { published } = (await c.json()) as { published: string };
  await env.DB.batch([
    env.DB.prepare("DELETE FROM file_search WHERE owner = ? AND repo = ? AND path = ?").bind(owner, repo, p.path),
    env.DB.prepare("INSERT INTO file_search (owner, repo, path, content) VALUES (?, ?, ?, ?)").bind(owner, repo, p.path, published),
  ]);
}

/** Where a mirror stands: its state, and how far ahead and behind it was at the last fetch. */
export async function mirrorStatus(env: Env, owner: string, repo: string) {
  const r = await env.DB.prepare("SELECT artifact, crew_artifact, mirror_push_crew, branch, mirror_url, mirror_state, mirror_error, mirror_clash, mirror_down_since, mirror_synced_at, mirror_next_at, upstream_commit FROM repos WHERE owner = ? AND name = ? AND mirror_url IS NOT NULL").bind(owner, repo).first();
  const lg = localGit(env);
  if (!r || !lg) return null;
  const branch = (r.branch ?? "main") as string;
  const counts = await git(["rev-list", "--left-right", "--count", `refs/heads/${branch}...refs/upstream/${branch}`], syncedDir(lg, r as unknown as Row));
  const [ahead, behind] = counts.code ? [0, 0] : counts.out.trim().split(/\s+/).map(Number);
  return {
    url: shownUrl(r.mirror_url as string), branch, state: (r.mirror_state ?? "ok") as State, error: r.mirror_error ?? null,
    clash: r.mirror_clash ? JSON.parse(r.mirror_clash as string) as string[] : [], downSince: r.mirror_down_since ?? null,
    syncedAt: r.mirror_synced_at ?? null, nextAt: r.mirror_next_at ?? null, upstreamCommit: r.upstream_commit ?? null,
    ahead: ahead ?? 0, behind: behind ?? 0, identity: gitIdentity(),
    // Private lines: whether it has any, and whether the crew's copy (real text) is the one that goes upstream.
    private: !!r.crew_artifact, pushCrew: !!r.mirror_push_crew,
  };
}

/** GET|POST /api/repos/:o/:r/mirror, for someone who can read the repo. */
export async function mirrorRepoRoute(req: Request, env: Env, owner: string, repo: string, user: string | null) {
  if (req.method === "POST") {
    if (user !== owner) return json({ error: "owner only" }, 403);
    const b = (await req.json().catch(() => ({}))) as { resolve?: string; pushCrew?: unknown };
    if (b.resolve !== undefined && !["mine", "upstream", "rebase"].includes(b.resolve)) return json({ error: "resolve: mine, upstream or rebase" }, 400);
    if (b.pushCrew !== undefined && typeof b.pushCrew !== "boolean") return json({ error: "pushCrew: true or false" }, 400);
    if (b.pushCrew !== undefined) await env.DB.prepare("UPDATE repos SET mirror_push_crew = ? WHERE owner = ? AND name = ? AND mirror_url IS NOT NULL").bind(b.pushCrew ? 1 : null, owner, repo).run();
    await syncMirror(env, owner, repo, { resolve: b.resolve as Resolve | undefined });
  }
  const s = await mirrorStatus(env, owner, repo);
  return s ? json(s) : json({ error: "not a mirror" }, 404);
}

/** A remote someone pasted: a GitHub repo in any of its forms, or any git URL. */
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
  const b = (await req.json().catch(() => ({}))) as { url?: string; name?: string; visibility?: string };
  const src = remoteOf(b.url ?? "");
  if (!src) return json({ error: "give a git remote: a GitHub owner/name, an https or ssh URL, or git@host:path" }, 400);
  const name = b.name || src.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!NAME.test(name)) return json({ error: "bad repo name" }, 400);
  const visibility = b.visibility ?? "public";
  if (visibility !== "public" && visibility !== "private") return json({ error: "visibility: public or private" }, 400);
  if (await env.DB.prepare("SELECT 1 FROM repos WHERE owner = ? AND name = ?").bind(user, name).first()) return json({ error: "you already have a repo with that name" }, 409);

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
  await env.DB.prepare(`INSERT INTO repos (owner, name, visibility, created_at, artifact, artifact_remote, branch, upstream, upstream_commit, mirror_url, mirror_state, mirror_synced_at, mirror_next_at, mirror_fails)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok', ?, ?, 0)`).bind(user, name, visibility, now, art, lg.remote(art), branch, src.upstream, sha, src.url, now, now + EVERY).run();
  return json({ owner: user, name, upstream: src.upstream, commit: sha, mirror: true }, 201);
}
