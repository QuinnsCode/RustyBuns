// Layout: try Rusty Buns on a repo or an agent's branch: init, then an offline plan
// Try Rusty Buns: the end of dig -> agent edits -> boxed. Five steps the owner
// watches go green on the repo page, with nothing deployed and no login:
//
//   clone    the repo's git remote into a temp dir, and the branch's files laid over it
//   install  bun install
//   init     rustybuns init, unless the repo already has a rustybuns.config.ts; its config is printed
//   infra    rustybuns infra --json: the stack as a graph for the repo page's map (run.infra),
//            with what protect: true keeps through destroy
//   plan     rustybuns plan --offline: builds and type checks, lists the stack as creates
//
// A branch (an agent's work) isn't in git until it merges, so its changed files
// are read from the line-op log and written over the clone, as the dependency
// doctor's previews do. In a monorepo the app's folder (the deploy settings' `dir`)
// is where init and plan run. Desktop only: it runs the repo's code.
//
//   GET  /api/repos/:o/:r/try     the current or last run (owner only)
//   POST /api/repos/:o/:r/try     start one: {branch?} tries that branch's files, else main

import { toFile } from "./archive.ts";
import { remoteFor, settings } from "./deploy.ts";
import { hostedWhy } from "./deploy-keys.ts";
import { json, readBody, type Env } from "./env.ts";
import { text, type Doc } from "./lines.ts";
import { runnerFor, type Run, type Runner } from "./preview.ts";

export const TRY_STEPS = ["clone", "install", "init", "infra", "plan"] as const;

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

export async function tryOut(runner: Runner, remote: string, run: Run, opts: { dir?: string; files?: Record<string, string>; stage?: string } = {}) {
  // A runner with a workdir is a container (deploy-runner.ts): it writes and looks through the runner.
  const fs = runner.workdir ? null : await import("node:fs");
  const { dirname, join } = await import("node:path");
  const dir = runner.workdir ?? fs!.mkdtempSync(join((await import("node:os")).tmpdir(), "codesplitter-try-"));
  const exists = async (path: string) => fs ? fs.existsSync(path) : (await runner.exec(["test", "-e", path], dir, () => {}).catch(() => 1)) === 0;
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
    if (!(await go("clone", [{ cmd: ["git", "clone", "--depth", "1", "--quiet", remote, "repo"], cwd: dir }, { cmd: ["git", "-C", "repo", "rev-parse", "HEAD"], cwd: dir }]))) return skip("install", "init", "infra", "plan");
    run.commit = /\b[0-9a-f]{40}\b/.exec(step("clone").out)?.[0];
    const paths = Object.keys(opts.files ?? {});
    const outside = paths.find((p) => p.split("/").some((x) => x === ".." || x === "" || x === "."));
    if (outside) { const c = step("clone"); c.status = "failed"; c.out += `${outside} is outside the repo\n`; return skip("install", "init", "infra", "plan"); }
    if (paths.length && !fs) {
      const wrote = await (runner.write?.(`${dir}/repo`, opts.files!) ?? Promise.reject(new Error("this runner can't lay files over its clone"))).then(() => null, (e: Error) => e.message);
      if (wrote) { const c = step("clone"); c.status = "failed"; c.out += `laying the changed files over the clone: ${wrote}\n`; return skip("install", "init", "infra", "plan"); }
    } else for (const p of paths) { fs!.mkdirSync(dirname(join(dir, "repo", p)), { recursive: true }); fs!.writeFileSync(join(dir, "repo", p), opts.files![p]!); }
    if (paths.length) step("clone").out += `laid ${paths.length} changed file${paths.length === 1 ? "" : "s"} over the clone: ${paths.join(", ")}\n`;
    if (opts.dir && !(await exists(app))) {
      const s = step("install"); s.status = "failed"; s.out = `this repo has no folder ${opts.dir}: fix the folder in the deploy settings\n`;
      return skip("init", "infra", "plan");
    }
    // A static site has no package.json to install; init writes one.
    const install = (await exists(`${app}/package.json`)) ? [{ cmd: ["bun", "install"], cwd: app }] : [];
    if (install.length) { if (!(await go("install", install))) return skip("init", "infra", "plan"); }
    else { step("install").status = "skipped"; step("install").out = "no package.json yet: init writes one\n"; }
    const rb = (...args: string[]) => ({ cmd: ["bun", "x", "rustybuns", ...args], cwd: app });
    if (await exists(`${app}/rustybuns.config.ts`)) { step("init").status = "skipped"; step("init").out = "already has a rustybuns.config.ts: init left it alone\n"; }
    else {
      if (!(await go("init", [rb("init"), { cmd: ["cat", "rustybuns.config.ts"], cwd: app }]))) {
        run.note = "init couldn't box this one: its output says what it needs (see Rusty Buns above for the fit)";
        return skip("infra", "plan");
      }
      run.note = "init wrote a rustybuns.config.ts in the clone; nothing was saved to your repo";
    }
    // The map doesn't gate the plan: a config that fails to load fails the plan with the reason.
    if (await go("infra", [rb("infra", "--json", "--stage", opts.stage ?? "prod")])) {
      const g = /^INFRA (\{.*\})$/m.exec(step("infra").out)?.[1];
      if (g) try { run.infra = JSON.parse(g); } catch { /* the log still shows it */ }
    }
    if (!(await go("plan", [rb("plan", "--offline")]))) run.note = "the plan didn't pass: the log says what to fix, and an agent can on a branch";
  } finally {
    // A container's workdir goes with the container.
    fs?.rmSync(dir, { recursive: true, force: true });
    run.done = true;
  }
}

export async function tryRoutes(req: Request, env: Env, p: string[], user: string | null): Promise<Response | null> {
  if (!(p[1] === "repos" && p[2] && p[3] && p[4] === "try" && !p[5])) return null;
  const [owner, repo] = [p[2], p[3]], key = `${owner}/${repo}`;
  if (user !== owner) return json({ error: "only the repo's owner can try Rusty Buns on it" }, 403);
  if (!(await env.DB.prepare("SELECT 1 FROM repos WHERE owner = ? AND name = ?").bind(owner, repo).first())) return json({ error: "not found" }, 404);
  const runner = runnerFor(env);
  // On the site, the plan runs in the repo's deploy container with no key in it (deploy-runner.ts, #1400).
  const hosted = !runner && env.DEPLOY_RUNNER ? env.DEPLOY_RUNNER.get(env.DEPLOY_RUNNER.idFromName(key)) : null;
  const why = hosted ? hostedWhy(env, user, false) : null;
  if (req.method === "GET") {
    if (!hosted) return json({ can_run: !!runner, run: trials.get(key) ?? null });
    const run = why ? null : ((await (await hosted.fetch(new Request("http://deploy/plan"))).json()) as { run: Run | null }).run;
    return json({ can_run: !why, hosted: true, ...(why && { why }), run });
  }
  if (req.method !== "POST") return null;
  if (runner?.workdir || (!runner && (!hosted || why))) return json({ error: why ?? "trying Rusty Buns runs on the desktop app" }, 400);
  if (runner && trials.get(key) && !trials.get(key)!.done) return json({ error: "a trial is already running" }, 409);
  const body = ((await readBody(req).catch(() => null)) ?? {}) as { branch?: unknown };
  const branch = typeof body.branch === "string" && body.branch ? body.branch : null;
  if (branch && !(await env.DB.prepare("SELECT 1 FROM branches WHERE owner = ? AND repo = ? AND name = ? AND status = 'open'").bind(owner, repo, branch).first())) return json({ error: `${branch} isn't an open branch` }, 404);
  const { dir, stage } = await settings(env, owner, repo);
  const files = branch ? await branchFiles(env, owner, repo, branch, user) : undefined;
  if (hosted) {
    const res = await hosted.fetch(new Request("http://deploy/plan", { method: "POST", body: JSON.stringify({ owner, repo, branch, dir, stage, files }) }));
    const out = (await res.json()) as { error?: string; status?: number };
    return json(out, out.error ? out.status ?? 400 : 202);
  }
  const remote = await remoteFor(env, owner, repo);
  if (!remote) return json({ error: "this repo has no git remote yet: commit its files first" }, 400);
  const id = crypto.randomUUID().slice(0, 8);
  const run: Run = { id, at: Date.now(), stage: branch ?? "main", steps: TRY_STEPS.map((key) => ({ key, status: "waiting", out: "" })) as Run["steps"], done: false };
  trials.set(key, run);
  void tryOut(runner!, remote, run, { dir, files, stage }).catch((e: Error) => { run.note = `failed: ${e.message}`; run.done = true; });
  return json({ run }, 202);
}
