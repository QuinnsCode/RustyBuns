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
// On the desktop it runs the repo's code and deploys with the logins on this
// machine. On the site it can run hosted instead (deploy-runner.ts), with a
// deploy key the owner stores (deploy-keys.ts); that's off by default. Each
// deploy is logged in D1: who, which commit, which stage, where it ran (and
// which key), the result; each repo keeps its last 50. A stack with `adopt: true` takes over live
// resources under their real names, so it's refused unless the owner has
// said this repo is production.
//
//   GET  /api/repos/:o/:r/deploy   settings, the run going now, the last 20 deploys (owner only)
//   PUT  /api/repos/:o/:r/deploy   {stage, on_commit, production}
//   POST /api/repos/:o/:r/deploy   ship it now
//   .../deploy/key                 the stored deploy key (deploy-keys.ts)

import { access as artifactAccess, handleFor } from "./archive.ts";
import { json, type Env } from "./env.ts";
import { deployKeyRoutes, hostedWhy, keyInfo } from "./deploy-keys.ts";
import { emit } from "./hooks.ts";
import { history, logEnd, logStart, preview, runnerFor, type Run, type StepKey } from "./preview.ts";

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

/** The repo's git remote with an hour-long read token in it, or null before its first commit. */
export async function remoteFor(env: Env, owner: string, repo: string): Promise<string | null> {
  const h = await handleFor(env, owner, repo);
  const art = h && await artifactAccess(h.handle, h.remote, "read", 3600);
  return art ? art.remote.replace("://", `://x:${art.token.split("?")[0]}@`) : null;
}

/** Log a new deploy as running, and make its run. */
export async function begin(env: Env, owner: string, repo: string, by: string, trigger: "button" | "commit", runner: "desktop" | "hosted", keyLast4?: string) {
  const s = await settings(env, owner, repo);
  const id = crypto.randomUUID().slice(0, 8);
  const run: Run = { id, at: Date.now(), stage: s.stage, steps: STEPS.map((key) => ({ key, status: "waiting", out: "" })), done: false };
  await logStart(env, owner, repo, run, by, trigger, runner, keyLast4);
  return { run, production: s.production };
}

/** Log how a deploy ended. */
export async function finish(env: Env, run: Run) {
  await logEnd(env, run);
  const ok = run.steps.every((x) => x.status === "done");
  // Desktop or hosted, the repo's webhooks hear how it went.
  const d = await env.DB.prepare("SELECT owner, repo, by, trigger FROM deploys WHERE id = ?").bind(run.id).first() as { owner: string; repo: string; by: string; trigger: string } | null;
  if (d) await emit(env, d.owner, d.repo, "deploy.finished", d.by, {
    deployment: { id: run.id, sha: run.commit ?? null, environment: run.stage, task: d.trigger, creator: { login: d.by } },
    deployment_status: { state: ok ? "success" : "failure", environment: run.stage, environment_url: run.url ?? null, description: run.note ?? null },
  });
}

const hostedStub = (env: Env, owner: string, repo: string) => env.DEPLOY_RUNNER!.get(env.DEPLOY_RUNNER!.idFromName(`${owner}/${repo}`));

type Started = { run?: Run; queued?: boolean; error?: string; status?: number };

/**
 * Start a deploy, or, if one is running, ship once more when it's done. On the
 * desktop it runs here with this machine's logins; on the site it runs in its
 * own container with the repo's stored deploy key (deploy-runner.ts).
 */
async function start(env: Env, owner: string, repo: string, by: string, trigger: "button" | "commit"): Promise<Started> {
  const runner = runnerFor(env);
  if (!runner) {
    if (!env.DEPLOY_RUNNER) return { error: "deploys run on the desktop app, with your own logins", status: 400 };
    const why = hostedWhy(env, by);
    if (why) return { error: why, status: 403 };
    if (!(await keyInfo(env, owner, repo)).set) return { error: "set a deploy key first", status: 400 };
    const res = await hostedStub(env, owner, repo).fetch(new Request("http://deploy/start", { method: "POST", body: JSON.stringify({ owner, repo, by, trigger }) }));
    return (await res.json()) as Started;
  }
  const key = `${owner}/${repo}`, now = live.get(key);
  if (now && !now.run.done) {
    if (trigger === "button") return { error: "a deploy is already running", status: 409 };
    now.again = by;
    return { queued: true };
  }
  const remote = await remoteFor(env, owner, repo);
  if (!remote) return { error: "this repo has no git remote yet: commit its files first", status: 400 };
  const { run, production } = await begin(env, owner, repo, by, trigger, "desktop");
  const entry: { run: Run; again?: string } = { run };
  live.set(key, entry);
  void preview(runner, remote, run, { keep: true, allowAdopt: production })
    .catch((e: Error) => { run.note = `failed: ${e.message}`; run.done = true; })
    .then(async () => {
      await finish(env, run);
      if (entry.again) void start(env, owner, repo, entry.again, "commit");
    });
  return { run };
}

/** Called after a commit to main is pushed: the owner's own commit ships, when they turned that on. */
export async function deployOnCommit(env: Env, owner: string, repo: string, user: string | null) {
  if (!user || user !== owner || user.startsWith("agent-")) return;
  if (!(await settings(env, owner, repo)).on_commit) return;
  await start(env, owner, repo, user, "commit").catch(() => {});
}

export async function deployRoutes(req: Request, env: Env, p: string[], user: string | null): Promise<Response | null> {
  if (!(p[1] === "repos" && p[2] && p[3] && p[4] === "deploy")) return null;
  if (p[5] === "key" && !p[6]) return deployKeyRoutes(req, env, p, user);
  if (p[5]) return null;
  const [owner, repo] = [p[2], p[3]];
  // It ships with this machine's logins and shows the repo's output: the owner's alone.
  if (!user || user !== owner || user.startsWith("agent-")) return json({ error: "only the repo's owner can deploy it" }, 403);
  if (!(await env.DB.prepare("SELECT 1 FROM repos WHERE owner = ? AND name = ?").bind(owner, repo).first())) return json({ error: "not found" }, 404);

  if (req.method === "GET") {
    const desktop = !!runnerFor(env), why = desktop ? null : hostedWhy(env, user);
    const run = async () => desktop ? live.get(`${owner}/${repo}`)?.run ?? null
      : env.DEPLOY_RUNNER ? ((await (await hostedStub(env, owner, repo).fetch(new Request("http://deploy/run"))).json()) as { run: Run | null }).run : null;
    const key = await keyInfo(env, owner, repo);
    return json({ settings: await settings(env, owner, repo), can_run: desktop || (!why && key.set), hosted: !desktop && !!env.DEPLOY_RUNNER, why, key, ...(await history(env, owner, repo, false, run)) });
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
    return r.error ? json({ error: r.error }, r.status ?? (r.error.includes("already") ? 409 : 400)) : json({ run: r.run }, 202);
  }
  return null;
}
