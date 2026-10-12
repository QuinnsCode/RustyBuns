// Layout: beams: a git or codeSplitter branch's stack cleaned of noise and squashed into one commit at `refs/beams/<id>`, its page, patch and inbox
// Beam: a branch's stack of commits, cleaned up into one commit and handed to
// someone. You worked on a git branch (pushed here with the Push back remote, or
// in a worktree): a patch, its fixups, an agent's follow-ups. Or on a codeSplitter
// branch (branches.ts, `kind: "codesplitter"`): its files as they are now, laid on
// main's tip like a push upstream lays them (mirror.ts branchTree), are the stack; one stacked on
// another (#1025) is a commit per branch, in order, the rest of what follows done to each. Beaming it
//
//   1. takes what the stack changed since it left main, file by file,
//   2. leaves out the noise (a lockfile from another package manager, lockfile
//      churn with no package.json change, installed packages, build output added
//      by the branch, OS and editor leftovers, env files), each with why; `keep`
//      puts one back and `drop` leaves one more out,
//   3. lays that on top of main's tip, or, for a fork dug from GitHub, of
//      upstream's newest commit (fetched read-only; nothing is ever pushed),
//   4. and squashes it into one commit: the stack's author (or you, with the
//      others as Co-authored-by), a title, and the stack's subjects as the body.
//
// The commit is kept at refs/beams/<id> in the repo's git, its checks run like a
// pushed branch's, and the beam is a link anyone holding it can read: the message,
// the diff, what was left out and why, and a `git am`-able patch. Send it to a
// handle and it's in their inbox (GET /api/me/beams). It never writes to GitHub.
//
// On the hosted site there's no git to run, and no git branches: a codeSplitter
// branch is beamed onto main by the Worker's own git (git.ts `push`), as a commit per
// branch in its stack pushed in one pack to refs/beams/<id> on the repo's Artifacts
// remote, and the diff and patch are written in JS (patch.ts). Git branches and
// `onto: "upstream"` stay desktop only.
//
//   GET    /api/repos/:o/:r/beams               the repo's beams; for the crew, the git and codeSplitter branches there are to beam too
//                                               (and `hosted: true` on the hosted site, where only codeSplitter's go, onto main)
//   POST   /api/repos/:o/:r/beams {branch, kind?: "git" | "codesplitter" (hosted, codesplitter is the default), onto?: "main" | "upstream", title?, message?, to?, keep?, drop?}
//          (the crew) beam branch `branch`: 201 with the beam, 409 with `clash` when it
//          doesn't sit on `onto` cleanly, or when nothing is left once the noise is out
//   GET    /api/beams/:id                       the beam and its diff, for anyone with the link
//   GET    /api/beams/:id/patch                 its commits as `git format-patch` writes them, for `git am`
//   DELETE /api/beams/:id                       (whoever beamed it, or the repo's owner) withdraw it
//   GET    /api/me/beams                        beams sent to you, and the ones you sent

import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startChecks } from "./checks.ts";
import { branchNameError, json, type Env } from "./env.ts";
import { access as artifactAccess, handleFor, readTree, toFile } from "./archive.ts";
import { ancestors } from "./branches.ts";
import { blobId, GIT_EMAIL_DOMAIN, push, setRef, ZERO, type Change as GitChange } from "./git.ts";
import { text, type Doc } from "./lines.ts";
import { upstreamOf } from "./listen.ts";
import { authorEnv, branchTree, git, gitIdentity, localGit } from "./mirror.ts";
import { formatPatch, unifiedDiff, type FileDiff } from "./patch.ts";

type Access = (owner: string, repo: string) => Promise<{ read: boolean; write: boolean; exists: boolean }>;
export interface Change { path: string; status: string }
export interface Dropped { path: string; why: string }
interface Person { name: string; email: string }

/** The most of a diff a beam's page shows; past it, the patch has the rest. */
export const DIFF_BYTES = 512 * 1024;
/** Git branches a repo's beam list offers, at most. */
const BRANCHES = 50;

const LOCKFILE = /(^|\/)(bun\.lockb?|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock)$/;
const MANIFEST = /(^|\/)package\.json$/;

/** Why a changed file is noise for whoever gets the beam, or null when it belongs in it. */
function noise(c: Change, manifestChanged: boolean): string | null {
  const p = c.path, added = c.status === "A";
  if (LOCKFILE.test(p)) {
    if (added) return "a lockfile this repo doesn't use";
    if (!manifestChanged) return "lockfile churn from an install: no package.json changed";
    return null;
  }
  if (/(^|\/)(node_modules|\.turbo|\.next|\.nuxt|\.svelte-kit|\.cache|coverage)\//.test(p)) return "installed packages or a tool's cache";
  if (added && /(^|\/)(dist|build|out)\//.test(p)) return "build output";
  if (/(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/.test(p)) return "OS clutter";
  if (/\.(log|swp|swo|orig|rej)$|~$/.test(p)) return "an editor, log or patch leftover";
  if (c.status !== "D" && /(^|\/)\.env(\.[^/]*)?$/.test(p) && !/\.(example|schema|sample|template)$/.test(p)) return "an env file: it may hold secrets";
  return null;
}

/** Which of a stack's changes go in the beam and which are left out, with why. `keep` and `drop` are paths that override the rules. */
export function sortOut(changes: Change[], o: { keep?: string[]; drop?: string[] } = {}) {
  const manifestChanged = changes.some((c) => MANIFEST.test(c.path));
  const kept: Change[] = [], dropped: Dropped[] = [];
  for (const c of changes) {
    const why = o.keep?.includes(c.path) ? null : o.drop?.includes(c.path) ? "you left it out" : noise(c, manifestChanged);
    if (why) dropped.push({ path: c.path, why }); else kept.push(c);
  }
  return { kept, dropped };
}

/** The squashed commit's message: a title, then a body (yours, the one commit's own, or the stack's subjects), then a Co-authored-by for each other author. */
export function beamMessage(o: { title?: string; message?: string; subjects: string[]; body?: string; author: Person; authors: Person[] }) {
  const title = (o.title?.trim() || o.subjects[0] || "A beam").split("\n")[0]!;
  const body = o.message?.trim()
    ?? (o.subjects.length > 1 ? `Squashed from ${o.subjects.length} commits:\n\n${o.subjects.map((s) => `- ${s}`).join("\n")}` : (o.body ?? "").trim());
  const others = o.authors.filter((a) => a.email.toLowerCase() !== o.author.email.toLowerCase())
    .filter((a, i, all) => all.findIndex((b) => b.email.toLowerCase() === a.email.toLowerCase()) === i);
  const trailers = others.map((a) => `Co-authored-by: ${a.name} <${a.email}>`).join("\n");
  return [title, body, trailers].filter(Boolean).join("\n\n") + "\n";
}

/** `git diff --name-status -z` as changes. */
const changesOf = (out: string): Change[] => {
  const w = out.split("\0").filter(Boolean), list: Change[] = [];
  for (let i = 0; i + 1 < w.length; i += 2) list.push({ status: w[i]!, path: w[i + 1]! });
  return list;
};

class GitError extends Error {}
async function must(args: string[], dir: string, env?: Record<string, string>, stdin?: string) {
  if (stdin !== undefined) {
    const p = Bun.spawn(["git", ...args], { cwd: dir, env: { ...process.env, ...env }, stdin: new TextEncoder().encode(stdin), stdout: "pipe", stderr: "pipe" });
    const [code, out, err] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
    if (code) throw new GitError(err.trim() || `git ${args[0]} exited ${code}`);
    return out.trim();
  }
  const r = await git(args, dir, env);
  if (r.code) throw new GitError(r.err.trim() || `git ${args[0]} exited ${r.code}`);
  return r.out.trim();
}
const isAncestor = async (dir: string, a: string, b: string) => (await git(["merge-base", "--is-ancestor", a, b], dir)).code === 0;

type RepoRow = { artifact: string | null; branch: string | null; upstream: string | null; crew_artifact: string | null };
const repoRow = (env: Env, owner: string, repo: string) =>
  env.DB.prepare("SELECT artifact, branch, upstream, crew_artifact FROM repos WHERE owner = ? AND name = ? AND (expires_at IS NULL OR expires_at > ?)")
    .bind(owner, repo, Date.now()).first() as Promise<RepoRow | null>;

/** The repo's bare git on this machine, or why there isn't one to beam from. */
async function bareOf(env: Env, owner: string, repo: string): Promise<{ error: Response } | { r: RepoRow; dir: string; main: string }> {
  const lg = localGit(env);
  if (!lg) return { error: json({ error: "beams need git on this machine: beam from the desktop app" }, 501) };
  const r = await repoRow(env, owner, repo);
  if (!r) return { error: json({ error: "no such repo" }, 404) };
  if (!r.artifact) return { error: json({ error: "this repo has no git yet" }, 409) };
  return { r, dir: lg.path(r.artifact), main: r.branch ?? "main" };
}

type Commit = { name: string; email: string; subject: string; body: string };
/**
 * What a beam is made of: where it left main, and a layer per commit it makes, the bottom one first.
 * A git branch, or a codeSplitter branch on main, is one layer; one stacked on others is one per branch.
 */
type Stack = { error: Response } | { base: string; layers: { branch: string; tip: string; log: Commit[] }[] };

/** A git branch's stack: where it left main, its tip, and its commits, oldest first. */
async function gitStack(dir: string, main: string, branch: string): Promise<Stack> {
  const tip = (await git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`], dir)).out.trim();
  if (!tip) return { error: json({ error: `this repo's git has no branch ${branch}` }, 404) };
  const mainTip = await must(["rev-parse", `refs/heads/${main}`], dir);
  const mb = await git(["merge-base", mainTip, tip], dir);
  if (mb.code) return { error: json({ error: `${branch} shares no history with ${main}` }, 409) };
  const base = mb.out.trim();
  if (await isAncestor(dir, tip, mainTip)) return { error: json({ error: `${main} has all of ${branch} already: nothing to beam` }, 409) };
  const log = (await must(["log", "--reverse", "--format=%an%x1f%ae%x1f%s%x1f%b%x1e", `${base}..${tip}`], dir)).split("\x1e").map((e) => e.trim()).filter(Boolean)
    .map((e) => { const [name, email, subject, body] = e.split("\x1f"); return { name: name!, email: email!, subject: subject!, body: body ?? "" }; });
  return { base, layers: [{ branch, tip, log }] };
}

type StackFile = { branch: string; path: string; deleted: number; blob: string | null; mode: string | null; source: string | null; by: string };

/**
 * A codeSplitter branch's stack: the branches it's stacked on, the bottom one first, then it, and every
 * one's files in path order. 404 or 409 when it isn't an open branch, or when a copy is stale (below).
 */
async function stackFiles(env: Env, owner: string, repo: string, branch: string): Promise<{ error: Response } | { by: string; chain: string[]; rows: StackFile[] }> {
  const br = await env.DB.prepare("SELECT by, status FROM branches WHERE owner = ? AND repo = ? AND name = ?").bind(owner, repo, branch).first() as { by: string; status: string } | null;
  if (!br) return { error: json({ error: `this repo has no codeSplitter branch ${branch}` }, 404) };
  if (br.status !== "open") return { error: json({ error: `${branch} is ${br.status} already: nothing to beam` }, 409) };
  const chain = [...(await ancestors(env, owner, repo, branch)).reverse(), branch];
  const marks = chain.map(() => "?").join(", ");
  const rows = (await env.DB.prepare(`SELECT f.branch, f.path, f.deleted, f.blob, f.mode, f.source, b.by FROM branch_files f JOIN branches b ON b.owner = f.owner AND b.repo = f.repo AND b.name = f.branch
    WHERE f.owner = ? AND f.repo = ? AND f.merged = 0 AND f.branch IN (${marks}) ORDER BY f.path`).bind(owner, repo, ...chain).all()).results as StackFile[];
  // A copy a branch made before the one under it touched that file has none of that one's change: laid
  // over it, it would take that change back out. Merging handles it line by line; a beam can't.
  const stale = rows.filter((f) => !f.deleted && !f.blob).filter((f) => {
    const under = chain.slice(0, chain.indexOf(f.branch)).reverse().find((u) => rows.some((x) => x.branch === u && x.path === f.path));
    const there = under && rows.find((x) => x.branch === under && x.path === f.path)!;
    return there && !there.deleted && !there.blob && f.source !== under;
  });
  if (stale.length) return { error: json({ error: `${stale.map((f) => `${f.branch}'s ${f.path}`).join(", ")} forked from main before the branch under it changed that file: a beam would take that change back out`, clash: stale.map((f) => f.path) }, 409) };
  return { by: br.by, chain, rows };
}

/**
 * A codeSplitter branch: its files as they are now over main's tip, the commit a push upstream would
 * make. One stacked on others (#1025) is a commit per branch, the bottom one on main's tip and each
 * next one's files over it. Whoever opened each is a co-author, unless it's the repo's owner (as a push).
 */
async function linesStack(env: Env, owner: string, repo: string, dir: string, main: string, branch: string): Promise<Stack> {
  const st = await stackFiles(env, owner, repo, branch);
  if ("error" in st) return st;
  const { chain, rows } = st;

  const base = await must(["rev-parse", `refs/heads/${main}`], dir), me = authorEnv();
  const layers: { branch: string; tip: string; log: Commit[] }[] = [];
  let tip = base;
  for (const name of chain) {
    const tree = await branchTree(env, owner, repo, name, dir, `${tip}^{tree}`);
    const by = rows.find((f) => f.branch === name)?.by ?? st.by, subject = `${name}, from codeSplitter`;
    tip = await must(["commit-tree", tree, "-p", tip, "-m", subject], dir, me);
    layers.push({ branch: name, tip, log: [{ ...(by === owner ? { name: me.GIT_AUTHOR_NAME!, email: me.GIT_AUTHOR_EMAIL! } : { name: by, email: `${by}@${GIT_EMAIL_DOMAIN}` }), subject, body: "" }] });
  }
  if (await must(["rev-parse", `${tip}^{tree}`], dir) === await must(["rev-parse", `${base}^{tree}`], dir)) return { error: json({ error: `${main} has all of ${branch} already: nothing to beam` }, 409) };
  return { base, layers };
}

/** Beam branch `branch` of owner/repo, a git one or (`kind: "codesplitter"`) one of ours: see the top of this file. */
export async function makeBeam(env: Env, owner: string, repo: string, user: string, body: any): Promise<Response> {
  const lg = localGit(env), r = await repoRow(env, owner, repo);
  if (!r) return json({ error: "no such repo" }, 404);
  if (!r.artifact) return json({ error: "this repo has no git yet" }, 409);
  const main = r.branch ?? "main";
  if (r.crew_artifact) return json({ error: "this repo has private lines, and its git holds them blank: a beam of it would carry the blanks" }, 409);
  const branch = String(body?.branch ?? "");
  const bad = branchNameError(branch);
  if (bad || branch === main) return json({ error: bad ?? `${main} is what a beam goes on top of: beam a branch off it` }, 400);
  const kind = body?.kind ?? (lg ? "git" : "codesplitter");
  if (kind !== "git" && kind !== "codesplitter") return json({ error: 'kind: "git" or "codesplitter"' }, 400);
  const onto = body?.onto ?? "main";
  if (onto !== "main" && onto !== "upstream") return json({ error: 'onto: "main" or "upstream"' }, 400);
  const paths = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const to = body?.to ? String(body.to) : null;
  if (to && !await env.DB.prepare("SELECT 1 FROM users WHERE name = ?").bind(to).first()) return json({ error: `nobody here goes by ${to}` }, 404);
  if (!lg) {
    if (kind === "git") return json({ error: "git branches live in the desktop app's git: beam one from there, or beam a codeSplitter branch here" }, 501);
    if (onto === "upstream") return json({ error: "beaming onto upstream fetches it with git: beam onto main here, or onto upstream from the desktop app" }, 501);
    return hostedBeam(env, owner, repo, user, main, { branch, to, title: body?.title, message: body?.message, keep: paths(body?.keep), drop: paths(body?.drop) });
  }
  const dir = lg.path(r.artifact);

  const st = kind === "git" ? await gitStack(dir, main, branch) : await linesStack(env, owner, repo, dir, main, branch);
  if ("error" in st) return st.error;
  const { base, layers } = st, top = layers.at(-1)!;
  const mainTip = await must(["rev-parse", `refs/heads/${main}`], dir);
  const { kept, dropped } = sortOut(changesOf(await must(["diff", "--name-status", "-z", "--no-renames", base, top.tip], dir)), { keep: paths(body?.keep), drop: paths(body?.drop) });
  if (!kept.length) return json({ error: "everything it changes is noise, so a beam of it would be empty: `keep` the files you meant", dropped }, 409);

  // Each layer's tree with the noise put back as it was where the stack began.
  const back: string[] = [];
  for (const d of dropped) {
    const was = await must(["ls-tree", base, "--", d.path], dir);   // "<mode> blob <sha>\t<path>", or nothing
    if (was) back.push(was.replace(/^(\d+) \w+ ([0-9a-f]+)\t/, "$1 $2\t"));
    else back.push(`0 ${"0".repeat(40)}\t${d.path}`);              // added by the stack: a zero entry takes it out
  }
  const cleaned = async (tip: string) => {
    if (!back.length) return must(["rev-parse", `${tip}^{tree}`], dir);
    const idx = join(tmpdir(), `codesplitter-beam-${crypto.randomUUID()}.index`), e = { GIT_INDEX_FILE: idx };
    try {
      await must(["read-tree", tip], dir, e);
      await must(["update-index", "-z", "--index-info"], dir, e, back.map((l) => `${l}\0`).join(""));
      return await must(["write-tree"], dir, e);
    } finally { rmSync(idx, { force: true }); }
  };

  // What it goes on top of: main's tip, or upstream's newest commit.
  let ontoSha = mainTip, ontoLabel = main;
  if (onto === "upstream") {
    const up = r.upstream ? upstreamOf(r.upstream, r.branch) : null;
    if (!up) return json({ error: "this repo wasn't dug from GitHub, so it has no upstream to beam onto: beam onto main" }, 409);
    if (up.folder) return json({ error: "a dug folder's files sit at another path upstream: beam onto main" }, 409);
    // Not shallow: only the commits since what this repo has come down, and they join its history.
    const f = await git(["fetch", "--quiet", "--no-tags", `https://github.com/${up.repo}.git`, `+refs/heads/${up.branch}:refs/beams/upstream`], dir);
    if (f.code) return json({ error: `couldn't fetch ${up.repo}@${up.branch}: ${f.err.trim() || "git fetch failed"}` }, 502);
    ontoSha = await must(["rev-parse", "refs/beams/upstream"], dir);
    ontoLabel = `upstream ${up.repo}@${up.branch}`;
  }
  // Each layer's tree as it sits on `onto`: it holds every layer under it, so each goes on by itself.
  const trees: string[] = [];
  for (const layer of layers) {
    const clean = await cleaned(layer.tip);
    if (ontoSha === base) { trees.push(clean); continue; }
    const stack = await must(["commit-tree", clean, "-p", base, "-m", "beam"], dir, authorEnv());
    // Where the stack began is behind `onto` (always so for main): git finds that base itself. Otherwise
    // name it, or the merge would bring along whatever main has that `onto` doesn't (git 2.40+).
    const named = await isAncestor(dir, base, ontoSha) ? [] : [`--merge-base=${base}`];
    const m = await git(["merge-tree", "--write-tree", "--name-only", "--no-messages", ...named, ontoSha, stack], dir);
    if (m.code === 1) return json({ error: `it doesn't sit cleanly on ${ontoLabel}: these files changed there too`, clash: m.out.trim().split("\n").slice(1).filter(Boolean) }, 409);
    if (m.code && /unknown option .merge-base/.test(m.err)) return json({ error: `beaming onto ${ontoLabel} from here needs git 2.40 or newer` }, 501);
    if (m.code) return json({ error: m.err.trim() || "git merge-tree failed" }, 500);
    trees.push(m.out.trim().split("\n")[0]!);
  }
  const ontoTree = await must(["rev-parse", `${ontoSha}^{tree}`], dir);
  if (trees.at(-1) === ontoTree) return json({ error: `${ontoLabel} has all of it already: nothing to beam` }, 409);

  // A commit per layer, each on the one before: the stack's author if it had one, else whoever beams
  // (this machine's git identity). Yours to title is the top one; a layer that adds nothing is left out.
  const env_ = authorEnv(), me = { name: env_.GIT_AUTHOR_NAME!, email: env_.GIT_AUTHOR_EMAIL! };
  const made: { branch: string; sha: string; title: string; message: string }[] = [];
  let sha = ontoSha, prev = ontoTree;
  for (const [i, layer] of layers.entries()) {
    if (trees[i] === prev) continue;
    const { log } = layer, mine = i === layers.length - 1;
    const authors = log.map((c) => ({ name: c.name, email: c.email }));
    const one = kind === "git" && new Set(authors.map((a) => a.email.toLowerCase())).size === 1 ? authors[0]! : null;
    const author = one ?? gitIdentity() ?? me;
    const message = beamMessage({ title: mine ? body?.title : undefined, message: mine ? body?.message : undefined, subjects: log.map((c) => c.subject), body: log[0]?.body, author, authors });
    sha = await must(["commit-tree", trees[i]!, "-p", sha, "-F", "-"], dir, { ...env_, GIT_AUTHOR_NAME: author.name, GIT_AUTHOR_EMAIL: author.email }, message);
    const [title, ...rest] = message.trimEnd().split("\n");
    made.push({ branch: layer.branch, sha, title: title!, message: rest.join("\n").trim() });
    prev = trees[i]!;
  }
  const files = changesOf(await must(["diff", "--name-status", "-z", "--no-renames", ontoSha, sha], dir));

  const id = newId();
  await must(["update-ref", `refs/beams/${id}`, sha], dir);
  const last = made.at(-1)!, stack = made.length > 1 ? JSON.stringify(made.map(({ branch, sha, title }) => ({ branch, sha, title }))) : null;
  return record(env, { id, owner, repo, branch, kind, user, to, title: last.title, message: last.message, onto: ontoSha, ontoLabel, sha,
    commits: kind === "git" ? top.log.length : 0, files, dropped, stack });
}

const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);

/** Keep a beam that's been built, start its checks, and answer with it. */
async function record(env: Env, b: { id: string; owner: string; repo: string; branch: string; kind: string; user: string; to: string | null; title: string; message: string;
  onto: string; ontoLabel: string; sha: string; commits: number; files: Change[]; dropped: Dropped[]; stack: string | null }) {
  await env.DB.prepare("INSERT INTO beams (id, owner, repo, branch, kind, by, to_user, title, message, onto, onto_label, sha, commits, files, dropped, stack, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(b.id, b.owner, b.repo, b.branch, b.kind, b.user, b.to, b.title, b.message, b.onto, b.ontoLabel, b.sha, b.commits, JSON.stringify(b.files), JSON.stringify(b.dropped), b.stack, Date.now()).run();
  // Checked like a branch pushed upstream would be, as that commit.
  await startChecks(env, b.owner, b.repo, `beam/${b.id}`, b.sha, b.user);
  return json(view(await beamRow(env, b.id)), 201);
}

type Hosted = NonNullable<Awaited<ReturnType<typeof handleFor>>>;

/** The entry at `path` in tree `tree`, or null. */
async function entryAt(env: Env, handle: Hosted["handle"], tree: string, path: string) {
  const parts = path.split("/");
  for (const [k, name] of parts.entries()) {
    const e = (await readTree(env, handle, tree))?.find((x) => x.name === name);
    if (!e || k === parts.length - 1) return e ?? null;
    if (e.type !== "tree") return null;
    tree = e.hash;
  }
  return null;
}

/**
 * Beam codeSplitter branch `branch` on the hosted site: its files as they are now, laid on main's tip
 * with the noise left as main has it, pushed by the Worker's git to refs/beams/<id>. One stacked on
 * others (#1025) is a commit per branch, the bottom one on main's tip and each next one's files over
 * it, all in one pack. Each is by whoever beams it, with whoever opened that branch as a co-author.
 */
async function hostedBeam(env: Env, owner: string, repo: string, user: string, main: string,
  o: { branch: string; to: string | null; title?: string; message?: string; keep: string[]; drop: string[] }): Promise<Response> {
  const h = await handleFor(env, owner, repo);
  if (!h) return json({ error: "this repo has no git yet" }, 409);
  const { branch } = o;
  const st = await stackFiles(env, owner, repo, branch);
  if ("error" in st) return st.error;
  const [tip] = await h.handle.log({ ref: main, limit: 1 });
  if (!tip) return json({ error: `${main} has no commits yet: there's nothing to beam onto` }, 409);

  // What each branch changes over the one under it, the bottom one over main's tip. `now` is each
  // path's blob as the branches so far leave it (null: gone), `onMain` what main's tip has there.
  const now = new Map<string, string | null>(), onMain = new Map<string, string | null>();
  const layers: { branch: string; by: string; changes: Record<string, GitChange> }[] = [];
  for (const name of st.chain) {
    const changes: Record<string, GitChange> = {}, mine = st.rows.filter((f) => f.branch === name);
    for (const f of mine) {
      if (!onMain.has(f.path)) {
        const was = await entryAt(env, h.handle, tip.treeHash, f.path);
        if (was?.type === "tree") return json({ error: `${f.path} is a folder on ${main}` }, 409);
        onMain.set(f.path, was?.hash ?? null);
      }
      const under = now.has(f.path) ? now.get(f.path)! : onMain.get(f.path)!;
      let next: GitChange, hash: string | null = null;
      if (f.deleted) next = null;
      else if (f.blob) {
        if (under === f.blob) continue;
        const bytes = await (await h.handle.readBlob(f.blob))?.arrayBuffer();
        if (!bytes) return json({ error: `${f.path}'s bytes aren't in this repo's git` }, 409);
        next = { bytes: new Uint8Array(bytes), mode: f.mode ?? undefined };
        hash = f.blob;
      } else {
        const doc = (await (await toFile(env, owner, repo, f.path, "upstream", "file", {}, "", name)).json()) as Doc;
        // As main's commits write it (archive.ts pushCatalogues): the lines, ending in one newline.
        next = (t => t.endsWith("\n") ? t : t + "\n")(text(doc));
        hash = await blobId(new TextEncoder().encode(next));
      }
      if (hash === under) continue;
      changes[f.path] = next;
      now.set(f.path, hash);
    }
    layers.push({ branch: name, by: mine[0]?.by ?? st.by, changes });
  }

  // What the stack changes against main's tip, file by file, and the noise in it, left as main has it in every commit.
  const list: Change[] = [...now].filter(([path, hash]) => hash !== onMain.get(path)).sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([path, hash]) => ({ path, status: hash === null ? "D" : onMain.get(path) ? "M" : "A" }));
  if (!list.length) return json({ error: `${main} has all of ${branch} already: nothing to beam` }, 409);
  const { kept, dropped } = sortOut(list, { keep: o.keep, drop: o.drop });
  if (!kept.length) return json({ error: "everything it changes is noise, so a beam of it would be empty: `keep` the files you meant", dropped }, 409);
  for (const l of layers) for (const d of dropped) delete l.changes[d.path];

  // A commit per branch that still changes something; yours to title is the top one.
  const author = { name: user, email: `${user}@${GIT_EMAIL_DOMAIN}` };
  const commits = layers.filter((l) => Object.keys(l.changes).length).map((l, i, all) => {
    const top = i === all.length - 1;
    const message = beamMessage({ title: top ? o.title : undefined, message: top ? o.message : undefined, subjects: [`${l.branch}, from codeSplitter`],
      author, authors: [{ name: l.by, email: `${l.by}@${GIT_EMAIL_DOMAIN}` }] }).trimEnd();
    return { branch: l.branch, changes: l.changes, message };
  });
  const id = newId(), a = await artifactAccess(h.handle, h.remote, "write", 300);
  const [first, ...then] = commits;
  const pushed = await push(a.remote, a.token, { changes: first!.changes, message: first!.message, then,
    author: user, branch: main, base: h.handle, to: { ref: `refs/beams/${id}`, parent: tip.hash } });
  const made = commits.map((c, i) => ({ branch: c.branch, sha: pushed.commits[i]!, title: c.message.split("\n")[0]! }));
  const [title, ...rest] = commits.at(-1)!.message.split("\n");
  return record(env, { id, owner, repo, branch, kind: "codesplitter", user, to: o.to, title: title!, message: rest.join("\n").trim(), onto: tip.hash, ontoLabel: main, sha: pushed.commit,
    commits: 0, files: kept, dropped, stack: made.length > 1 ? JSON.stringify(made) : null });
}

/** One side of a file in tree `tree`: its blob's hash, mode and text (null when binary), or null when it isn't there. */
async function sideAt(env: Env, h: Hosted, tree: string, path: string) {
  const e = await entryAt(env, h.handle, tree, path);
  if (!e || e.type === "tree") return null;
  const text = await (await h.handle.readBlob(e.hash))?.text();
  return { hash: e.hash, mode: e.mode, text: text === undefined || text.includes("\0") ? null : text };
}
const diffAt = (env: Env, h: Hosted, before: string, after: string, paths: string[]): Promise<FileDiff[]> =>
  Promise.all(paths.map(async (path) => ({ path, before: await sideAt(env, h, before, path), after: await sideAt(env, h, after, path) })));

/** The files that differ between two trees, read from the repo's Artifacts: only the subtrees that differ are walked. */
async function changedPaths(env: Env, h: Hosted, a: string | null, b: string | null, dir = ""): Promise<string[]> {
  if (a === b) return [];
  const [x, y] = await Promise.all([a ? readTree(env, h.handle, a) : [], b ? readTree(env, h.handle, b) : []]);
  const out: string[] = [];
  for (const name of new Set([...(x ?? []), ...(y ?? [])].map((e) => e.name))) {
    const ea = x?.find((e) => e.name === name), eb = y?.find((e) => e.name === name);
    if (ea?.hash === eb?.hash && ea?.mode === eb?.mode) continue;
    const ta = ea?.type === "tree" ? ea.hash : null, tb = eb?.type === "tree" ? eb.hash : null;
    if (ta || tb) out.push(...await changedPaths(env, h, ta, tb, `${dir}${name}/`));
    if ((ea && !ta) || (eb && !tb)) out.push(dir + name);
  }
  return out;
}

/** A hosted beam's files, both sides of each, read back from the repo's Artifacts; null when its commit is gone. */
async function hostedFiles(env: Env, h: Hosted, b: BeamRow) {
  const [commit, onto] = await Promise.all([h.handle.readCommit(b.sha), h.handle.readCommit(b.onto)]);
  if (!commit || !onto) return null;
  return diffAt(env, h, onto.treeHash, commit.treeHash, (JSON.parse(b.files) as Change[]).map((c) => c.path));
}

/** A hosted beam as `git format-patch` writes it: a mail per commit, the bottom one first; null when one is gone. */
async function hostedPatch(env: Env, h: Hosted, b: BeamRow) {
  const shas = view(b)!.stack.map((c) => c.sha), onto = await h.handle.readCommit(b.onto);
  if (!onto) return null;
  let under = onto.treeHash, out = "";
  for (const [i, sha] of shas.entries()) {
    const commit = await h.handle.readCommit(sha);
    if (!commit) return null;
    const diff = unifiedDiff(await diffAt(env, h, under, commit.treeHash, await changedPaths(env, h, under, commit.treeHash)));
    const at = commit.authoredAt < 1e12 ? commit.authoredAt * 1000 : commit.authoredAt;
    out += formatPatch({ sha, author: commit.author, at, message: commit.message, ...shas.length > 1 && { n: i + 1, of: shas.length } }, diff);
    under = commit.treeHash;
  }
  return out;
}

interface BeamRow {
  id: string; owner: string; repo: string; branch: string; kind: string; by: string; to_user: string | null; title: string; message: string;
  onto: string; onto_label: string; sha: string; commits: number; files: string; dropped: string; stack: string | null; status: string; created_at: number;
}
const beamRow = (env: Env, id: string) =>
  env.DB.prepare("SELECT b.* FROM beams b JOIN repos r ON r.owner = b.owner AND r.name = b.repo WHERE b.id = ? AND (r.expires_at IS NULL OR r.expires_at > ?)")
    .bind(id, Date.now()).first() as Promise<BeamRow | null>;

const view = (b: BeamRow | null) => b && ({
  id: b.id, owner: b.owner, repo: b.repo, branch: b.branch, kind: b.kind, by: b.by, to: b.to_user, title: b.title, message: b.message,
  onto: { sha: b.onto, label: b.onto_label }, sha: b.sha, commits: b.commits,
  // A stacked branch's beam: its commits, the bottom one first (#1025). One commit otherwise.
  stack: (b.stack ? JSON.parse(b.stack) : [{ branch: b.branch, sha: b.sha, title: b.title }]) as { branch: string; sha: string; title: string }[],
  files: JSON.parse(b.files) as Change[], dropped: JSON.parse(b.dropped) as Dropped[],
  status: b.status, created_at: b.created_at, page: `/#/beam/${b.id}`, patch: `/api/beams/${b.id}/patch`,
});
const summary = (b: BeamRow) => { const v = view(b)!; return { ...v, files: v.files.length, dropped: v.dropped.length }; };

/** The git branches a repo has to beam, newest first: each with how many commits it's past main. */
async function beamable(dir: string, main: string) {
  const r = await git(["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)%09%(objectname)", `--count=${BRANCHES + 1}`, "refs/heads"], dir);
  if (r.code) return [];
  const out: { name: string; sha: string; ahead: number }[] = [];
  for (const line of r.out.trim().split("\n").filter(Boolean)) {
    const [name, sha] = line.split("\t");
    if (!name || name === main) continue;
    const n = await git(["rev-list", "--count", `refs/heads/${main}..${sha}`], dir);
    out.push({ name, sha: sha!, ahead: Number(n.out.trim()) || 0 });
  }
  return out.slice(0, BRANCHES);
}

/** The repo's open codeSplitter branches with files of their own, newest first: each with how many. */
async function beamableLines(env: Env, owner: string, repo: string) {
  const { results } = await env.DB.prepare(`SELECT b.name, b.by, b.parent, COUNT(f.path) AS files FROM branches b JOIN branch_files f ON f.owner = b.owner AND f.repo = b.repo AND f.branch = b.name AND f.merged = 0
    WHERE b.owner = ? AND b.repo = ? AND b.status = 'open' GROUP BY b.name ORDER BY COALESCE(b.changed_at, b.created_at) DESC LIMIT ?`).bind(owner, repo, BRANCHES).all();
  return results as { name: string; by: string; parent: string | null; files: number }[];
}

export async function beamRoutes(req: Request, env: Env, p: string[], user: string | null, access: Access): Promise<Response | null> {
  // /api/repos/:o/:r/beams
  if (p[1] === "repos" && p[4] === "beams" && !p[5]) {
    const [owner, repo] = [p[2]!, p[3]!];
    const a = await access(owner, repo);
    if (!a.read) return json({ error: "no such repo" }, 404);
    if (req.method === "POST") {
      if (!user) return json({ error: "sign in first" }, 401);
      if (!a.write) return json({ error: "only the crew can beam from this repo" }, 403);
      return makeBeam(env, owner, repo, user, await req.json().catch(() => ({})));
    }
    if (req.method !== "GET") return null;
    const { results } = await env.DB.prepare("SELECT * FROM beams WHERE owner = ? AND repo = ? ORDER BY created_at DESC LIMIT 100").bind(owner, repo).all();
    const beams = (results as unknown as BeamRow[]).map(summary);
    if (!a.write) return json({ beams });
    const b = await bareOf(env, owner, repo);
    // Hosted, there are no git branches, and codeSplitter's are beamed by the Worker's git.
    const lines = "error" in b && localGit(env) ? [] : await beamableLines(env, owner, repo);
    return json({ beams, branches: "error" in b ? [] : await beamable(b.dir, b.main), codesplitter_branches: lines, ...!localGit(env) && { hosted: true } });
  }

  // /api/me/beams
  if (p[1] === "me" && p[2] === "beams" && !p[3] && req.method === "GET") {
    if (!user) return json({ error: "sign in first" }, 401);
    const live = "JOIN repos r ON r.owner = b.owner AND r.name = b.repo WHERE (r.expires_at IS NULL OR r.expires_at > ?)";
    const [to, from] = await Promise.all([
      env.DB.prepare(`SELECT b.* FROM beams b ${live} AND b.to_user = ? AND b.status = 'open' ORDER BY b.created_at DESC LIMIT 50`).bind(Date.now(), user).all(),
      env.DB.prepare(`SELECT b.* FROM beams b ${live} AND b.by = ? ORDER BY b.created_at DESC LIMIT 50`).bind(Date.now(), user).all(),
    ]);
    return json({ to_you: (to.results as unknown as BeamRow[]).map(summary), yours: (from.results as unknown as BeamRow[]).map(summary) });
  }

  // /api/beams/:id[/patch]
  if (p[1] !== "beams" || !p[2]) return null;
  const b = await beamRow(env, p[2]);
  if (!b) return json({ error: "no such beam" }, 404);
  if (req.method === "DELETE" && !p[3]) {
    if (user !== b.by && user !== b.owner) return json({ error: "only whoever beamed it, or the repo's owner" }, 403);
    const g = await bareOf(env, b.owner, b.repo);
    if (!("error" in g)) await git(["update-ref", "-d", `refs/beams/${b.id}`], g.dir);
    else if (!localGit(env)) {
      // Hosted: the ref goes from the repo's Artifacts remote. One that won't go only keeps a commit nobody can reach from here.
      const h = await handleFor(env, b.owner, b.repo);
      if (h) await artifactAccess(h.handle, h.remote, "write", 300).then((a) => setRef(a.remote, a.token, `refs/beams/${b.id}`, b.sha, ZERO)).catch(() => {});
    }
    await env.DB.prepare("UPDATE beams SET status = 'withdrawn' WHERE id = ?").bind(b.id).run();
    return json({ ok: true });
  }
  if (req.method !== "GET") return null;
  if (b.status !== "open") return p[3] ? json({ error: "this beam was withdrawn" }, 410) : json(view(b));
  if (p[3] && p[3] !== "patch") return null;
  if (!localGit(env)) {
    const h = await handleFor(env, b.owner, b.repo);
    if (p[3] === "patch") {
      const patch = h && await hostedPatch(env, h, b);
      return patch ? new Response(patch, { headers: patchHeaders(b.id) }) : json({ error: "this beam's commit is gone from the repo's git" }, 410);
    }
    const files = h && await hostedFiles(env, h, b);
    if (!files) return json({ error: "this beam's commit is gone from the repo's git" }, 410);
    return json({ ...view(b), ...cut(unifiedDiff(files)) });
  }
  const g = await bareOf(env, b.owner, b.repo);
  if ("error" in g) return g.error;
  if (p[3] === "patch") {
    const r = await git(["format-patch", "--stdout", "--no-color", `${b.onto}..${b.sha}`], g.dir);
    if (r.code) return json({ error: "this beam's commit is gone from the repo's git" }, 410);
    return new Response(r.out, { headers: patchHeaders(b.id) });
  }
  const d = await git(["diff", "--no-color", b.onto, b.sha], g.dir);
  return json({ ...view(b), ...cut(d.out) });
}

const patchHeaders = (id: string) => ({ "content-type": "text/plain; charset=utf-8", "content-disposition": `attachment; filename="beam-${id}.patch"` });

/** A diff for the beam's page: up to DIFF_BYTES of it, and whether there was more. */
function cut(diff: string) {
  const bytes = new TextEncoder().encode(diff), over = bytes.length > DIFF_BYTES;
  return { diff: over ? new TextDecoder().decode(bytes.slice(0, DIFF_BYTES)) : diff, diff_truncated: over };
}
