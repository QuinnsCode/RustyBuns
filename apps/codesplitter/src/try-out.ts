// Layout: try Rusty Buns on a repo or an agent's branch: init, then an offline plan
// Try Rusty Buns: the end of dig -> agent edits -> boxed. Four steps the owner
// watches go green on the repo page, with nothing deployed and no login:
//
//   clone    the repo's git remote into a temp dir, and the branch's files laid over it
//   install  bun install
//   init     rustybuns init, unless the repo already has a rustybuns.config.ts; its config is printed
//   plan     rustybuns plan --offline: builds and type checks, lists the stack as creates
//
// A branch (an agent's work) isn't in git until it merges, so its changed files
// are read from the line-op log and written over the clone, as the dependency
// doctor's previews do. In a monorepo the app's folder (the deploy settings' `dir`)
// is where init and plan run. Desktop only: it runs the repo's code.
//
//   GET  /api/repos/:o/:r/try     the current or last run (owner only)
//   POST /api/repos/:o/:r/try     start one: {branch?} tries that branch's files, else main

import { access as artifactAccess, handleFor, toFile } from "./archive.ts";
import { settings } from "./deploy.ts";
import { json, readBody, type Env } from "./env.ts";
import { text, type Doc } from "./lines.ts";
import { runnerFor, type Run, type Runner } from "./preview.ts";

export const TRY_STEPS = ["clone", "install", "init", "plan"] as const;

/** One run per repo, in this process: the desktop app is one process. */
const trials = new Map<string, Run>();

const MAX_OUT = 60_000;

/** The branch's changed text files (not deleted, not binary, not merged yet), as the branch has them. */
export async function branchFiles(env: Env, owner: string, repo: string, branch: string, user: string): Promise<Record<string, string>> {
  const rows = (await env.DB.prepare("SELECT path FROM branch_files WHERE owner = ? AND repo = ? AND branch = ? AND merged = 0 AND deleted = 0 AND blob IS NULL ORDER BY path").bind(owner, repo, branch).all()).results as { path: string }[];
  const out: Record<string, string> = {};
  for (const { path } of rows) {
    const res = await toFile(env, owner, repo, path, user, "file", {}, "", branch);
    if (res.ok) out[path] = text((await res.json()) as Doc);
  }
  return out;
}

export async function tryOut(runner: Runner, remote: string, run: Run, opts: { dir?: string; files?: Record<string, string> } = {}) {
  const fs = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const dir = fs.mkdtempSync(join((await import("node:os")).tmpdir(), "codesplitter-try-"));
  const app = opts.dir ? `${dir}/repo/${opts.dir}` : `${dir}/repo`;
  const step = (k: string) => run.steps.find((s) => s.key === k)!;
  const scrub = (s: string) => s.split(remote).join("<remote>");
  const go = async (k: string, cmds: { cmd: string[]; cwd: string }[]) => {
    const s = step(k), t = Date.now();
    s.status = "running";
    const write = (x: string) => { s.out = (s.out + scrub(x)).slice(-MAX_OUT); };
    for (const { cmd, cwd } of cmds) {
      write(`$ ${cmd.join(" ")}\n`);
      const code = await runner.exec(cmd, cwd, write).catch((e: Error) => { write(e.message + "\n"); return 1; });
      if (code !== 0) { s.status = "failed"; s.ms = Date.now() - t; return false; }
    }
    s.status = "done"; s.ms = Date.now() - t;
    return true;
  };
  const skip = (...ks: string[]) => { for (const k of ks) step(k).status = "skipped"; };
  try {
    if (!(await go("clone", [{ cmd: ["git", "clone", "--depth", "1", "--quiet", remote, "repo"], cwd: dir }, { cmd: ["git", "-C", "repo", "rev-parse", "HEAD"], cwd: dir }]))) return skip("install", "init", "plan");
    run.commit = /\b[0-9a-f]{40}\b/.exec(step("clone").out)?.[0];
    const paths = Object.keys(opts.files ?? {});
    const outside = paths.find((p) => p.split("/").some((x) => x === ".." || x === "" || x === "."));
    if (outside) { const c = step("clone"); c.status = "failed"; c.out += `${outside} is outside the repo\n`; return skip("install", "init", "plan"); }
    for (const p of paths) { fs.mkdirSync(dirname(join(dir, "repo", p)), { recursive: true }); fs.writeFileSync(join(dir, "repo", p), opts.files![p]!); }
    if (paths.length) step("clone").out += `laid ${paths.length} changed file${paths.length === 1 ? "" : "s"} over the clone: ${paths.join(", ")}\n`;
    if (opts.dir && !fs.existsSync(app)) {
      const s = step("install"); s.status = "failed"; s.out = `this repo has no folder ${opts.dir}: fix the folder in the deploy settings\n`;
      return skip("init", "plan");
    }
    // A static site has no package.json to install; init writes one.
    const install = fs.existsSync(`${app}/package.json`) ? [{ cmd: ["bun", "install"], cwd: app }] : [];
    if (install.length) { if (!(await go("install", install))) return skip("init", "plan"); }
    else { step("install").status = "skipped"; step("install").out = "no package.json yet: init writes one\n"; }
    const rb = (...args: string[]) => ({ cmd: ["bun", "x", "rustybuns", ...args], cwd: app });
    if (fs.existsSync(`${app}/rustybuns.config.ts`)) { step("init").status = "skipped"; step("init").out = "already has a rustybuns.config.ts: init left it alone\n"; }
    else {
      if (!(await go("init", [rb("init"), { cmd: ["cat", "rustybuns.config.ts"], cwd: app }]))) {
        run.note = "init couldn't box this one: its output says what it needs (see Rusty Buns above for the fit)";
        return skip("plan");
      }
      run.note = "init wrote a rustybuns.config.ts in the clone; nothing was saved to your repo";
    }
    if (!(await go("plan", [rb("plan", "--offline")]))) run.note = "the plan didn't pass: the log says what to fix, and an agent can on a branch";
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    run.done = true;
  }
}

export async function tryRoutes(req: Request, env: Env, p: string[], user: string | null): Promise<Response | null> {
  if (!(p[1] === "repos" && p[2] && p[3] && p[4] === "try" && !p[5])) return null;
  const [owner, repo] = [p[2], p[3]], key = `${owner}/${repo}`;
  if (user !== owner) return json({ error: "only the repo's owner can try Rusty Buns on it" }, 403);
  if (!(await env.DB.prepare("SELECT 1 FROM repos WHERE owner = ? AND name = ?").bind(owner, repo).first())) return json({ error: "not found" }, 404);
  const runner = runnerFor(env);
  if (req.method === "GET") return json({ can_run: !!runner, run: trials.get(key) ?? null });
  if (req.method !== "POST") return null;
  if (!runner || runner.workdir) return json({ error: "trying Rusty Buns runs on the desktop app" }, 400);
  if (trials.get(key) && !trials.get(key)!.done) return json({ error: "a trial is already running" }, 409);
  const body = ((await readBody(req).catch(() => null)) ?? {}) as { branch?: unknown };
  const branch = typeof body.branch === "string" && body.branch ? body.branch : null;
  if (branch && !(await env.DB.prepare("SELECT 1 FROM branches WHERE owner = ? AND repo = ? AND name = ? AND status = 'open'").bind(owner, repo, branch).first())) return json({ error: `${branch} isn't an open branch` }, 404);
  const h = await handleFor(env, owner, repo, true);
  const art = h && await artifactAccess(h.handle, h.remote, "read", 3600);
  if (!art) return json({ error: "this repo has no git remote yet: commit its files first" }, 400);
  const remote = art.remote.replace("://", `://x:${art.token.split("?")[0]}@`);
  const { dir } = await settings(env, owner, repo);
  const files = branch ? await branchFiles(env, owner, repo, branch, user) : undefined;
  const id = crypto.randomUUID().slice(0, 8);
  const run: Run = { id, at: Date.now(), stage: branch ?? "main", steps: TRY_STEPS.map((key) => ({ key, status: "waiting", out: "" })) as Run["steps"], done: false };
  trials.set(key, run);
  void tryOut(runner, remote, run, { dir, files }).catch((e: Error) => { run.note = `failed: ${e.message}`; run.done = true; });
  return json({ run }, 202);
}
