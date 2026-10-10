// Deploy for real: the repo's own Rusty Buns stack, shipped to the stage its
// owner picks and left up. The same steps as a preview (preview.ts) minus the
// destroy: clone, install, deploy, check.
//
// Only a person ships: the owner presses Deploy, or, when they turn it on, the
// owner's own commit to main ships it. A commit is what pushes to the git
// remote the deploy clones, so a merge ships once it's committed. Crew and
// agents (the dependency doctor too) can change code on branches and even on
// main, but nothing they do starts a deploy; their changes go out with the
// owner's next one.
//
// Desktop only, like a preview: it runs the repo's code and deploys with the
// logins on this machine. Each deploy is logged in D1: who, which commit,
// which stage, the result. A stack with `adopt: true` takes over live
// resources under their real names, so it's refused unless the owner has
// said this repo is production.
//
//   GET  /api/repos/:o/:r/deploy   settings, the run going now, the last 20 deploys (owner only)
//   PUT  /api/repos/:o/:r/deploy   {stage, on_commit, production}
//   POST /api/repos/:o/:r/deploy   ship it now

import { access as artifactAccess, handleFor } from "./archive.ts";
import { json, type Env } from "./env.ts";
import { emit } from "./hooks.ts";
import { preview, runnerFor, type Run, type StepKey } from "./preview.ts";

export interface Settings { stage: string; on_commit: boolean; production: boolean }
const DEFAULTS: Settings = { stage: "prod", on_commit: false, production: false };
const STAGE = /^[a-z0-9][a-z0-9-]{0,30}$/;
const STEPS: StepKey[] = ["clone", "install", "deploy", "check"];

/** The deploy going now per repo, and whether a commit landed while it ran. */
const live = new Map<string, { run: Run; again?: string }>();

export async function settings(env: Env, owner: string, repo: string): Promise<Settings> {
  const r = await env.DB.prepare("SELECT stage, on_commit, production FROM deploy_settings WHERE owner = ? AND repo = ?").bind(owner, repo).first();
  return r ? { stage: r.stage, on_commit: !!r.on_commit, production: !!r.production } : { ...DEFAULTS };
}

/** Start a deploy, or, if one is running, ship once more when it's done. */
async function start(env: Env, owner: string, repo: string, by: string, trigger: "button" | "commit"): Promise<{ run?: Run; queued?: boolean; error?: string }> {
  const runner = runnerFor(env);
  if (!runner) return { error: "deploys run on the desktop app, with your own logins" };
  const key = `${owner}/${repo}`, now = live.get(key);
  if (now && !now.run.done) {
    if (trigger === "button") return { error: "a deploy is already running" };
    now.again = by;
    return { queued: true };
  }
  const h = await handleFor(env, owner, repo);
  const art = h && await artifactAccess(h.handle, h.remote, "read", 3600);
  if (!art) return { error: "this repo has no git remote yet: commit its files first" };
  const remote = art.remote.replace("://", `://x:${art.token.split("?")[0]}@`);
  const s = await settings(env, owner, repo);
  const id = crypto.randomUUID().slice(0, 8);
  const run: Run = { id, at: Date.now(), stage: s.stage, steps: STEPS.map((key) => ({ key, status: "waiting", out: "" })), done: false };
  const entry: { run: Run; again?: string } = { run };
  live.set(key, entry);
  await env.DB.prepare("INSERT INTO deploys (id, owner, repo, stage, by, trigger, status, at) VALUES (?, ?, ?, ?, ?, ?, 'running', ?)")
    .bind(id, owner, repo, s.stage, by, trigger, run.at).run();
  void preview(runner, remote, run, { keep: true, allowAdopt: s.production })
    .catch((e: Error) => { run.note = `failed: ${e.message}`; run.done = true; })
    .then(async () => {
      const ok = run.steps.every((x) => x.status === "done");
      // The log keeps the end of each step's output, enough to see why one failed.
      const out = run.steps.filter((x) => x.out).map((x) => `── ${x.key} (${x.status})\n${x.out.slice(-2000)}`).join("\n").slice(-8000);
      await env.DB.prepare("UPDATE deploys SET status = ?, commit_hash = ?, url = ?, ms = ?, note = ?, out = ? WHERE id = ?")
        .bind(ok ? "done" : "failed", run.commit ?? null, run.url ?? null, Date.now() - run.at, run.note ?? null, out, id).run();
      await emit(env, owner, repo, "deploy.finished", by, {
        deployment: { id, sha: run.commit ?? null, environment: s.stage, task: trigger, creator: { login: by } },
        deployment_status: { state: ok ? "success" : "failure", environment: s.stage, environment_url: run.url ?? null, description: run.note ?? null },
      });
      if (entry.again) void start(env, owner, repo, entry.again, "commit");
    });
  return { run };
}

/** Called after a commit to main is pushed: the owner's own commit ships, when they turned that on. */
export async function deployOnCommit(env: Env, owner: string, repo: string, user: string | null) {
  if (user !== owner) return;
  if (!(await settings(env, owner, repo)).on_commit) return;
  await start(env, owner, repo, user, "commit").catch(() => {});
}

export async function deployRoutes(req: Request, env: Env, p: string[], user: string | null): Promise<Response | null> {
  if (!(p[1] === "repos" && p[2] && p[3] && p[4] === "deploy" && !p[5])) return null;
  const [owner, repo] = [p[2], p[3]];
  // It ships with this machine's logins and shows the repo's output: the owner's alone.
  if (user !== owner) return json({ error: "only the repo's owner can deploy it" }, 403);
  if (!(await env.DB.prepare("SELECT 1 FROM repos WHERE owner = ? AND name = ?").bind(owner, repo).first())) return json({ error: "not found" }, 404);

  if (req.method === "GET") {
    const { results } = await env.DB.prepare("SELECT id, stage, by, trigger, status, commit_hash, url, at, ms, note, out FROM deploys WHERE owner = ? AND repo = ? ORDER BY at DESC LIMIT 20").bind(owner, repo).all();
    const run = live.get(`${owner}/${repo}`)?.run ?? null;
    // A deploy still "running" in the log but not in this process died with an earlier one.
    const history = (results as any[]).map((d) => d.status === "running" && run?.id !== d.id ? { ...d, status: "interrupted" } : d);
    return json({ settings: await settings(env, owner, repo), can_run: !!runnerFor(env), run, history });
  }
  if (req.method === "PUT") {
    const s = { ...(await settings(env, owner, repo)), ...((await req.json()) as Partial<Settings>) };
    if (!STAGE.test(String(s.stage))) return json({ error: "stage: lowercase letters, digits and dashes" }, 400);
    if (s.stage.startsWith("preview-")) return json({ error: "preview-* stages belong to preview deploys" }, 400);
    await env.DB.prepare(`INSERT INTO deploy_settings (owner, repo, stage, on_commit, production) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (owner, repo) DO UPDATE SET stage = excluded.stage, on_commit = excluded.on_commit, production = excluded.production`)
      .bind(owner, repo, s.stage, s.on_commit ? 1 : 0, s.production ? 1 : 0).run();
    return json(await settings(env, owner, repo));
  }
  if (req.method === "POST") {
    const r = await start(env, owner, repo, user, "button");
    return r.error ? json({ error: r.error }, r.error.includes("already") ? 409 : 400) : json({ run: r.run }, 202);
  }
  return null;
}
