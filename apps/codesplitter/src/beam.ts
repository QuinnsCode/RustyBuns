// Layout: beams: a git or codeSplitter branch's stack cleaned of noise and squashed into one commit at `refs/beams/<id>`, its page, patch and inbox
// Beam: a branch's stack of commits, cleaned up into one commit and handed to
// someone. You worked on a git branch (pushed here with the Push back remote, or
// in a worktree): a patch, its fixups, an agent's follow-ups. Or on a codeSplitter
// branch (branches.ts, `kind: "codesplitter"`): its files as they are now, laid on
// main's tip like a push upstream lays them (mirror.ts branchTree), are the stack. Beaming it
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
// branch is beamed onto main by the Worker's own git (git.ts `push`), as one commit
// pushed to refs/beams/<id> on the repo's Artifacts remote, and the diff and patch
// are written in JS (patch.ts). Git branches and `onto: "upstream"` stay desktop only.
//
//   GET    /api/repos/:o/:r/beams               the repo's beams; for the crew, the git and codeSplitter branches there are to beam too
//                                               (and `hosted: true` on the hosted site, where only codeSplitter's go, onto main)
//   POST   /api/repos/:o/:r/beams {branch, kind?: "git" | "codesplitter" (hosted, codesplitter is the default), onto?: "main" | "upstream", title?, message?, to?, keep?, drop?}
//          (the crew) beam branch `branch`: 201 with the beam, 409 with `clash` when it
//          doesn't sit on `onto` cleanly, or when nothing is left once the noise is out
//   GET    /api/beams/:id                       the beam and its diff, for anyone with the link
//   GET    /api/beams/:id/patch                 the commit as `git format-patch` writes it, for `git am`
//   DELETE /api/beams/:id                       (whoever beamed it, or the repo's owner) withdraw it
//   GET    /api/me/beams                        beams sent to you, and the ones you sent

import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startChecks } from "./checks.ts";
import { branchNameError, json, type Env } from "./env.ts";
import { access as artifactAccess, handleFor, readTree, toFile } from "./archive.ts";
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

type Stack = { error: Response } | { base: string; tip: string; log: { name: string; email: string; subject: string; body: string }[] };

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
  return { base, tip, log };
}

/**
 * A codeSplitter branch as a stack of one: its files as they are now over main's tip, the commit a
 * push upstream would make. Whoever opened it is a co-author, unless it's the repo's owner (as a push).
 */
async function linesStack(env: Env, owner: string, repo: string, dir: string, main: string, branch: string): Promise<Stack> {
  const br = await env.DB.prepare("SELECT by, status FROM branches WHERE owner = ? AND repo = ? AND name = ?").bind(owner, repo, branch).first() as { by: string; status: string } | null;
  if (!br) return { error: json({ error: `this repo has no codeSplitter branch ${branch}` }, 404) };
  if (br.status !== "open") return { error: json({ error: `${branch} is ${br.status} already: nothing to beam` }, 409) };
  const base = await must(["rev-parse", `refs/heads/${main}`], dir);
  const tree = await branchTree(env, owner, repo, branch, dir, `${base}^{tree}`);
  if (tree === await must(["rev-parse", `${base}^{tree}`], dir)) return { error: json({ error: `${main} has all of ${branch} already: nothing to beam` }, 409) };
  const subject = `${branch}, from codeSplitter`;
  const tip = await must(["commit-tree", tree, "-p", base, "-m", subject], dir, authorEnv());
  const me = authorEnv(), by = br.by === owner ? { name: me.GIT_AUTHOR_NAME!, email: me.GIT_AUTHOR_EMAIL! } : { name: br.by, email: `${br.by}@${GIT_EMAIL_DOMAIN}` };
  return { base, tip, log: [{ ...by, subject, body: "" }] };
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
  const { base, tip, log } = st;
  const mainTip = await must(["rev-parse", `refs/heads/${main}`], dir);
  const { kept, dropped } = sortOut(changesOf(await must(["diff", "--name-status", "-z", "--no-renames", base, tip], dir)), { keep: paths(body?.keep), drop: paths(body?.drop) });
  if (!kept.length) return json({ error: "everything it changes is noise, so a beam of it would be empty: `keep` the files you meant", dropped }, 409);

  // The branch's tree with the noise put back as it was where the stack began.
  const idx = join(tmpdir(), `codesplitter-beam-${crypto.randomUUID()}.index`), e = { GIT_INDEX_FILE: idx };
  let clean: string;
  try {
    await must(["read-tree", tip], dir, e);
    const back: string[] = [];
    for (const d of dropped) {
      const was = await must(["ls-tree", base, "--", d.path], dir);   // "<mode> blob <sha>\t<path>", or nothing
      if (was) back.push(was.replace(/^(\d+) \w+ ([0-9a-f]+)\t/, "$1 $2\t"));
      else back.push(`0 ${"0".repeat(40)}\t${d.path}`);              // added by the stack: a zero entry takes it out
    }
    if (back.length) await must(["update-index", "-z", "--index-info"], dir, e, back.map((l) => `${l}\0`).join(""));
    clean = await must(["write-tree"], dir, e);
  } finally { rmSync(idx, { force: true }); }

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
  let tree = clean;
  if (ontoSha !== base) {
    const stack = await must(["commit-tree", clean, "-p", base, "-m", "beam"], dir, authorEnv());
    // Where the stack began is behind `onto` (always so for main): git finds that base itself. Otherwise
    // name it, or the merge would bring along whatever main has that `onto` doesn't (git 2.40+).
    const named = await isAncestor(dir, base, ontoSha) ? [] : [`--merge-base=${base}`];
    const m = await git(["merge-tree", "--write-tree", "--name-only", "--no-messages", ...named, ontoSha, stack], dir);
    if (m.code === 1) return json({ error: `it doesn't sit cleanly on ${ontoLabel}: these files changed there too`, clash: m.out.trim().split("\n").slice(1).filter(Boolean) }, 409);
    if (m.code && /unknown option .merge-base/.test(m.err)) return json({ error: `beaming onto ${ontoLabel} from here needs git 2.40 or newer` }, 501);
    if (m.code) return json({ error: m.err.trim() || "git merge-tree failed" }, 500);
    tree = m.out.trim().split("\n")[0]!;
  }
  if (tree === await must(["rev-parse", `${ontoSha}^{tree}`], dir)) return json({ error: `${ontoLabel} has all of it already: nothing to beam` }, 409);

  // One commit: the stack's author if it had one, else whoever beams (this machine's git identity).
  const env_ = authorEnv(), me = { name: env_.GIT_AUTHOR_NAME!, email: env_.GIT_AUTHOR_EMAIL! };
  const authors = log.map((c) => ({ name: c.name, email: c.email }));
  const one = kind === "git" && new Set(authors.map((a) => a.email.toLowerCase())).size === 1 ? authors[0]! : null;
  const author = one ?? gitIdentity() ?? me;
  const message = beamMessage({ title: body?.title, message: body?.message, subjects: log.map((c) => c.subject), body: log[0]?.body, author, authors });
  const sha = await must(["commit-tree", tree, "-p", ontoSha, "-F", "-"], dir, { ...env_, GIT_AUTHOR_NAME: author.name, GIT_AUTHOR_EMAIL: author.email }, message);
  const files = changesOf(await must(["diff", "--name-status", "-z", "--no-renames", ontoSha, sha], dir));

  const id = newId();
  await must(["update-ref", `refs/beams/${id}`, sha], dir);
  return record(env, { id, owner, repo, branch, kind, user, to, message, onto: ontoSha, ontoLabel, sha, commits: kind === "git" ? log.length : 0, files, dropped });
}

const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);

/** Keep a beam that's been built, start its checks, and answer with it. */
async function record(env: Env, b: { id: string; owner: string; repo: string; branch: string; kind: string; user: string; to: string | null; message: string;
  onto: string; ontoLabel: string; sha: string; commits: number; files: Change[]; dropped: Dropped[] }) {
  const [title, ...rest] = b.message.trimEnd().split("\n");
  await env.DB.prepare("INSERT INTO beams (id, owner, repo, branch, kind, by, to_user, title, message, onto, onto_label, sha, commits, files, dropped, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(b.id, b.owner, b.repo, b.branch, b.kind, b.user, b.to, title!, rest.join("\n").trim(), b.onto, b.ontoLabel, b.sha, b.commits, JSON.stringify(b.files), JSON.stringify(b.dropped), Date.now()).run();
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
 * with the noise left as main has it, pushed by the Worker's git as one commit to refs/beams/<id>.
 * It's by whoever beams it, with whoever opened the branch as a co-author.
 */
async function hostedBeam(env: Env, owner: string, repo: string, user: string, main: string,
  o: { branch: string; to: string | null; title?: string; message?: string; keep: string[]; drop: string[] }): Promise<Response> {
  const h = await handleFor(env, owner, repo);
  if (!h) return json({ error: "this repo has no git yet" }, 409);
  const { branch } = o;
  const br = await env.DB.prepare("SELECT by, status FROM branches WHERE owner = ? AND repo = ? AND name = ?").bind(owner, repo, branch).first() as { by: string; status: string } | null;
  if (!br) return json({ error: `this repo has no codeSplitter branch ${branch}` }, 404);
  if (br.status !== "open") return json({ error: `${branch} is ${br.status} already: nothing to beam` }, 409);
  const [tip] = await h.handle.log({ ref: main, limit: 1 });
  if (!tip) return json({ error: `${main} has no commits yet: there's nothing to beam onto` }, 409);

  // What the branch changes against main's tip, file by file.
  const { results } = await env.DB.prepare("SELECT path, deleted, blob, mode FROM branch_files WHERE owner = ? AND repo = ? AND branch = ? AND merged = 0 ORDER BY path").bind(owner, repo, branch).all();
  const changes: Record<string, GitChange> = {}, list: Change[] = [];
  for (const f of results as { path: string; deleted: number; blob: string | null; mode: string | null }[]) {
    const was = await entryAt(env, h.handle, tip.treeHash, f.path);
    if (was?.type === "tree") return json({ error: `${f.path} is a folder on ${main}` }, 409);
    let next: GitChange;
    if (f.deleted) next = null;
    else if (f.blob) {
      if (was?.hash === f.blob) continue;
      const bytes = await (await h.handle.readBlob(f.blob))?.arrayBuffer();
      if (!bytes) return json({ error: `${f.path}'s bytes aren't in this repo's git` }, 409);
      next = { bytes: new Uint8Array(bytes), mode: f.mode ?? undefined };
    } else {
      const doc = (await (await toFile(env, owner, repo, f.path, "upstream", "file", {}, "", branch)).json()) as Doc;
      // As main's commits write it (archive.ts pushCatalogues): the lines, ending in one newline.
      next = (t => t.endsWith("\n") ? t : t + "\n")(text(doc));
      if (was && await blobId(new TextEncoder().encode(next)) === was.hash) continue;
    }
    if (next === null && !was) continue;
    changes[f.path] = next;
    list.push({ path: f.path, status: next === null ? "D" : was ? "M" : "A" });
  }
  if (!list.length) return json({ error: `${main} has all of ${branch} already: nothing to beam` }, 409);
  const { kept, dropped } = sortOut(list, { keep: o.keep, drop: o.drop });
  if (!kept.length) return json({ error: "everything it changes is noise, so a beam of it would be empty: `keep` the files you meant", dropped }, 409);

  const author = { name: user, email: `${user}@${GIT_EMAIL_DOMAIN}` }, by = { name: br.by, email: `${br.by}@${GIT_EMAIL_DOMAIN}` };
  const message = beamMessage({ title: o.title, message: o.message, subjects: [`${branch}, from codeSplitter`], author, authors: [by] });
  const id = newId(), a = await artifactAccess(h.handle, h.remote, "write", 300);
  const { commit } = await push(a.remote, a.token, { changes: Object.fromEntries(kept.map((c) => [c.path, changes[c.path]!])), message: message.trimEnd(),
    author: user, branch: main, base: h.handle, to: { ref: `refs/beams/${id}`, parent: tip.hash } });
  return record(env, { id, owner, repo, branch, kind: "codesplitter", user, to: o.to, message, onto: tip.hash, ontoLabel: main, sha: commit, commits: 0, files: kept, dropped });
}

/** A hosted beam's files, both sides of each, read back from the repo's Artifacts; null when its commit is gone. */
async function hostedFiles(env: Env, h: Hosted, b: BeamRow) {
  const [commit, onto] = await Promise.all([h.handle.readCommit(b.sha), h.handle.readCommit(b.onto)]);
  if (!commit || !onto) return null;
  const side = async (tree: string, path: string) => {
    const e = await entryAt(env, h.handle, tree, path);
    if (!e || e.type === "tree") return null;
    const text = await (await h.handle.readBlob(e.hash))?.text();
    return { hash: e.hash, mode: e.mode, text: text === undefined || text.includes("\0") ? null : text };
  };
  const files: FileDiff[] = await Promise.all((JSON.parse(b.files) as Change[]).map(async (c) => ({ path: c.path, before: await side(onto.treeHash, c.path), after: await side(commit.treeHash, c.path) })));
  return { files, commit };
}

interface BeamRow {
  id: string; owner: string; repo: string; branch: string; kind: string; by: string; to_user: string | null; title: string; message: string;
  onto: string; onto_label: string; sha: string; commits: number; files: string; dropped: string; status: string; created_at: number;
}
const beamRow = (env: Env, id: string) =>
  env.DB.prepare("SELECT b.* FROM beams b JOIN repos r ON r.owner = b.owner AND r.name = b.repo WHERE b.id = ? AND (r.expires_at IS NULL OR r.expires_at > ?)")
    .bind(id, Date.now()).first() as Promise<BeamRow | null>;

const view = (b: BeamRow | null) => b && ({
  id: b.id, owner: b.owner, repo: b.repo, branch: b.branch, kind: b.kind, by: b.by, to: b.to_user, title: b.title, message: b.message,
  onto: { sha: b.onto, label: b.onto_label }, sha: b.sha, commits: b.commits,
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
  const { results } = await env.DB.prepare(`SELECT b.name, b.by, COUNT(f.path) AS files FROM branches b JOIN branch_files f ON f.owner = b.owner AND f.repo = b.repo AND f.branch = b.name AND f.merged = 0
    WHERE b.owner = ? AND b.repo = ? AND b.status = 'open' GROUP BY b.name ORDER BY COALESCE(b.changed_at, b.created_at) DESC LIMIT ?`).bind(owner, repo, BRANCHES).all();
  return results as { name: string; by: string; files: number }[];
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
    const h = await handleFor(env, b.owner, b.repo), got = h && await hostedFiles(env, h, b);
    if (!got) return json({ error: "this beam's commit is gone from the repo's git" }, 410);
    const diff = unifiedDiff(got.files);
    if (p[3] === "patch") {
      const at = got.commit.authoredAt < 1e12 ? got.commit.authoredAt * 1000 : got.commit.authoredAt;
      return new Response(formatPatch({ sha: b.sha, author: got.commit.author, at, message: got.commit.message }, diff), { headers: patchHeaders(b.id) });
    }
    return json({ ...view(b), ...cut(diff) });
  }
  const g = await bareOf(env, b.owner, b.repo);
  if ("error" in g) return g.error;
  if (p[3] === "patch") {
    const r = await git(["format-patch", "-1", "--stdout", "--no-color", b.sha], g.dir);
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
