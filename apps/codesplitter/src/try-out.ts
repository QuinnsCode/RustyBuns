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
// With {save: true} a "save" step follows init: what init wrote or changed (the config,
// the deploy dependencies) goes on a branch as agent-rustybuns, for the owner to review and merge.
//
//   GET  /api/repos/:o/:r/try     the current or last run (owner only)
//   POST /api/repos/:o/:r/try     start one: {branch?} tries that branch's files, else main; {save?} commits init's work to a branch

import { access as artifactAccess, handleFor, toFile } from "./archive.ts";
import { settings } from "./deploy.ts";
import { json, readBody, type Env } from "./env.ts";
import { caller, landFix, type Edit } from "./deps.ts";
import { text, type Doc } from "./lines.ts";
import { runnerFor, type Run, type Runner } from "./preview.ts";
import { repoRow } from "./repos.ts";

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

/** Who commits init's work: its own handle, so blame says Rusty Buns did it. */
export const INIT_AGENT = "agent-rustybuns";

/** Puts init's edits on a branch as INIT_AGENT; answers the branch's name. */
export type Save = (edits: Edit[]) => Promise<string>;

export async function tryOut(runner: Runner, remote: string, run: Run, opts: { dir?: string; files?: Record<string, string>; stage?: string; save?: Save } = {}) {
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
    if (!(await go("clone", [{ cmd: ["git", "clone", "--depth", "1", "--quiet", remote, "repo"], cwd: dir }, { cmd: ["git", "-C", "repo", "rev-parse", "HEAD"], cwd: dir }]))) return skip("install", "init", "infra", "plan");
    run.commit = /\b[0-9a-f]{40}\b/.exec(step("clone").out)?.[0];
    const paths = Object.keys(opts.files ?? {});
    const outside = paths.find((p) => p.split("/").some((x) => x === ".." || x === "" || x === "."));
    if (outside) { const c = step("clone"); c.status = "failed"; c.out += `${outside} is outside the repo\n`; return skip("install", "init", "infra", "plan"); }
    for (const p of paths) { fs.mkdirSync(dirname(join(dir, "repo", p)), { recursive: true }); fs.writeFileSync(join(dir, "repo", p), opts.files![p]!); }
    if (paths.length) step("clone").out += `laid ${paths.length} changed file${paths.length === 1 ? "" : "s"} over the clone: ${paths.join(", ")}\n`;
    if (opts.dir && !fs.existsSync(app)) {
      const s = step("install"); s.status = "failed"; s.out = `this repo has no folder ${opts.dir}: fix the folder in the deploy settings\n`;
      return skip("init", "infra", "plan");
    }
    // A static site has no package.json to install; init writes one.
    const install = fs.existsSync(`${app}/package.json`) ? [{ cmd: ["bun", "install"], cwd: app }] : [];
    if (install.length) { if (!(await go("install", install))) return skip("init", "infra", "plan"); }
    else { step("install").status = "skipped"; step("install").out = "no package.json yet: init writes one\n"; }
    const rb = (...args: string[]) => ({ cmd: ["bun", "x", "rustybuns", ...args], cwd: app });
    if (fs.existsSync(`${app}/rustybuns.config.ts`)) { step("init").status = "skipped"; step("init").out = "already has a rustybuns.config.ts: init left it alone\n"; }
    else {
      if (!(await go("init", [rb("init"), { cmd: ["cat", "rustybuns.config.ts"], cwd: app }]))) {
        run.note = "init couldn't box this one: its output says what it needs (see Rusty Buns above for the fit)";
        return skip("infra", "plan");
      }
      run.note = "init wrote a rustybuns.config.ts in the clone; nothing was saved to your repo";
      if (opts.save) {
        const saved = await saveInit(runner, opts.save, `${dir}/repo`, step("save"), (x) => scrub(x));
        if (saved) run.note = `init's work is on branch ${saved} as ${INIT_AGENT}: review it and merge when it looks right`;
      }
    }
    if (opts.save && step("save").status === "waiting") { step("save").status = "skipped"; step("save").out = "the repo already has a rustybuns.config.ts: nothing for init to save\n"; }
    // The map doesn't gate the plan: a config that fails to load fails the plan with the reason.
    if (await go("infra", [rb("infra", "--json", "--stage", opts.stage ?? "prod")])) {
      const g = /^INFRA (\{.*\})$/m.exec(step("infra").out)?.[1];
      if (g) try { run.infra = JSON.parse(g); } catch { /* the log still shows it */ }
    }
    if (!(await go("plan", [rb("plan", "--offline")]))) run.note = "the plan didn't pass: the log says what to fix, and an agent can on a branch";
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    run.done = true;
  }
}

/** What init left in the clone (new or changed text files), saved through `save`; the branch's name, or null with the step marked failed. */
async function saveInit(runner: Runner, save: Save, repoDir: string, s: Run["steps"][number], scrub: (x: string) => string): Promise<string | null> {
  const fs = await import("node:fs");
  const t = Date.now();
  s.status = "running";
  const grab = async (cmd: string[]) => { let o = ""; const code = await runner.exec(cmd, repoDir, (x) => { o += x; }).catch(() => 1); return { code, out: o }; };
  const fail = (why: string) => { s.status = "failed"; s.ms = Date.now() - t; s.out += scrub(why + "\n"); return null; };
  const st = await grab(["git", "status", "--porcelain", "-z", "--untracked-files=all"]);
  if (st.code) return fail("couldn't list what init changed");
  const edits: Edit[] = [];
  for (const e of st.out.split("\0").filter(Boolean)) {
    const [code, path] = [e.slice(0, 2), e.slice(3)];
    if (code.includes("D") || code.includes("R")) continue;
    const file = `${repoDir}/${path}`;
    const buf = fs.existsSync(file) ? fs.readFileSync(file) : null;
    if (!buf || buf.length > 1_000_000 || buf.includes(0)) { s.out += `left out ${path}: not a text file under 1 MB\n`; continue; }
    const before = code.trim() === "??" ? null : (await grab(["git", "show", `HEAD:${path}`])).out;
    edits.push({ path, before, after: buf.toString("utf8") });
  }
  if (!edits.length) return fail("init changed no files");
  s.out += `saving ${edits.map((x) => x.path).join(", ")} as ${INIT_AGENT}\n`;
  try {
    const branch = await save(edits);
    s.out += `branch ${branch}\n`; s.status = "done"; s.ms = Date.now() - t;
    return branch;
  } catch (e) { return fail((e as Error).message); }
}

export async function tryRoutes(req: Request, env: Env, p: string[], user: string | null, self: (r: Request) => Promise<Response>): Promise<Response | null> {
  if (!(p[1] === "repos" && p[2] && p[3] && p[4] === "try" && !p[5])) return null;
  const [owner, repo] = [p[2], p[3]], key = `${owner}/${repo}`;
  if (user !== owner) return json({ error: "only the repo's owner can try Rusty Buns on it" }, 403);
  if (!(await repoRow(env, owner, repo, "1"))) return json({ error: "not found" }, 404);
  const runner = runnerFor(env);
  if (req.method === "GET") return json({ can_run: !!runner, run: trials.get(key) ?? null });
  if (req.method !== "POST") return null;
  if (!runner || runner.workdir) return json({ error: "trying Rusty Buns runs on the desktop app" }, 400);
  if (trials.get(key) && !trials.get(key)!.done) return json({ error: "a trial is already running" }, 409);
  const body = ((await readBody(req).catch(() => null)) ?? {}) as { branch?: unknown; save?: unknown };
  const branch = typeof body.branch === "string" && body.branch ? body.branch : null;
  if (branch && !(await env.DB.prepare("SELECT 1 FROM branches WHERE owner = ? AND repo = ? AND name = ? AND status = 'open'").bind(owner, repo, branch).first())) return json({ error: `${branch} isn't an open branch` }, 404);
  const h = await handleFor(env, owner, repo, true);
  const art = h && await artifactAccess(h.handle, h.remote, "read", 3600);
  if (!art) return json({ error: "this repo has no git remote yet: commit its files first" }, 400);
  const remote = art.remote.replace("://", `://x:${art.token.split("?")[0]}@`);
  const { dir, stage } = await settings(env, owner, repo);
  const files = branch ? await branchFiles(env, owner, repo, branch, user) : undefined;
  const saving = body.save === true;
  if (saving && branch) return json({ error: "init's work is saved from main: pick main, or merge the branch first" }, 400);
  const id = crypto.randomUUID().slice(0, 8);
  const keys = saving ? [...TRY_STEPS.slice(0, 3), "save" as const, ...TRY_STEPS.slice(3)] : TRY_STEPS;
  const run: Run = { id, at: Date.now(), stage: branch ?? "main", steps: keys.map((key) => ({ key, status: "waiting", out: "" })) as Run["steps"], done: false };
  trials.set(key, run);
  const save: Save | undefined = saving ? (edits) => openBranch(self, owner, repo, edits) : undefined;
  void tryOut(runner, remote, run, { dir, files, stage, save }).catch((e: Error) => { run.note = `failed: ${e.message}`; run.done = true; });
  return json({ run }, 202);
}

/** A branch for init's work, opened and written by INIT_AGENT, named like the dependency doctor's. */
async function openBranch(self: (r: Request) => Promise<Response>, owner: string, repo: string, edits: Edit[]): Promise<string> {
  const call = caller(self, "http://codesplitter.local"), base = `/api/repos/${owner}/${repo}`;
  const added = await call(owner, `${base}/collaborators`, { method: "POST", body: JSON.stringify({ name: INIT_AGENT }) });
  if (!added.ok) throw new Error(`adding ${INIT_AGENT}: ${added.status}`);
  const day = new Date().toISOString().slice(0, 10);
  for (let n = 1; n < 20; n++) {
    const name = n === 1 ? `rustybuns-init-${day}` : `rustybuns-init-${day}-${n}`;
    const r = await call(INIT_AGENT, `${base}/branches`, { method: "POST", body: JSON.stringify({ name }) });
    if (r.status === 409) continue;
    if (!r.ok) throw new Error(`opening a branch: ${r.status} ${await r.text()}`);
    const { skipped } = await landFix(call, owner, base, name, INIT_AGENT, edits);
    if (skipped.length) throw new Error(`couldn't write ${skipped.join(", ")} to ${name}`);
    return name;
  }
  throw new Error("no free branch name today");
}
