// A preview deploy: the repo's own Rusty Buns stack, stood up on its targets
// and torn down again, five steps the owner watches go green on the repo page.
//
//   clone    the repo's git remote into a temp dir
//   install  bun install, then read rustybuns.config.ts
//   deploy   rustybuns deploy --yes --stage preview-<id>: a stack of its own
//   check    the deployed URL answers without a 5xx
//   destroy  rustybuns destroy on that stage, then the clone is deleted
//
// Desktop only: it runs the repo's code and deploys with the logins on this
// machine (rustybuns login cloudflare, railway login, ...). A stack with
// `adopt: true` is refused, since adopting takes the real resources' names and
// destroy would then delete production. Once deploy has started, destroy always
// runs; if it fails, the clone (and its Alchemy state) is kept so it can be
// finished by hand. Each run is logged in D1 beside the real deploys.
//
//   GET  /api/repos/:o/:r/preview     the current or last run, and the last 20 logged (owner only)
//   POST /api/repos/:o/:r/preview     start one

import { access as artifactAccess, handleFor } from "./archive.ts";
import { json, type Env } from "./env.ts";

export type StepKey = "clone" | "install" | "deploy" | "check" | "destroy";
export interface Step { key: StepKey; status: "waiting" | "running" | "done" | "failed" | "skipped"; out: string; ms?: number }
export interface Run { id: string; at: number; stage: string; steps: Step[]; url?: string; done: boolean; kept?: string; note?: string; commit?: string }

/** Run a command, streaming its output; resolves to the exit code. */
export type Exec = (cmd: string[], cwd: string, out: (s: string) => void) => Promise<number>;
/**
 * Where a run's commands go. `workdir`: a fresh directory the runner owns and cleans up (a deploy container's), used in place of a temp dir here.
 * `state`: for a runner whose machine forgets, put the app's Alchemy state back before deploy and keep it after, so the next deploy updates the same stack.
 */
export interface Runner {
  exec: Exec; fetch: (url: string) => Promise<{ status: number }>; workdir?: string;
  state?: { restore(app: string): Promise<void>; keep(app: string): Promise<void> };
}

/**
 * Runner state for the desktop: a deploy's clone is a temp dir, so its Alchemy
 * state is copied out to `dir` after the deploy and back in before the next one.
 * It holds the app's secrets, as rustybuns' own state does, so `dir` is the
 * owner's alone (0700).
 */
export const dirState = (dir: string): NonNullable<Runner["state"]> => ({
  async restore(app) {
    const fs = await import("node:fs");
    if (fs.existsSync(dir)) fs.cpSync(dir, `${app}/.alchemy/state`, { recursive: true });
  },
  async keep(app) {
    const fs = await import("node:fs");
    const from = `${app}/.alchemy/state`;
    if (!fs.existsSync(from)) return;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.cpSync(fs.realpathSync(from), dir, { recursive: true });   // through rustybuns' shared-state symlink
  },
});

export const STEPS: StepKey[] = ["clone", "install", "deploy", "check", "destroy"];
const MAX_OUT = 60_000;

export const spawnExec = (timeoutMs = 15 * 60_000): Exec => async (cmd, cwd, out) => {
  const p = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe", timeout: timeoutMs, env: { ...process.env, CI: "1" } });
  const pump = async (s: ReadableStream<Uint8Array>) => { const d = new TextDecoder(); for await (const c of s) out(d.decode(c, { stream: true })); };
  await Promise.all([pump(p.stdout), pump(p.stderr)]);
  return await p.exited;
};

export const runnerFor = (env: Env): Runner | null => {
  const fake = env.PREVIEW_RUNNER as Runner | undefined;
  if (fake) return fake;
  return typeof Bun !== "undefined" && !env.BETTER_AUTH_SECRET ? { exec: spawnExec(), fetch: (u) => fetch(u, { redirect: "manual" }) } : null;
};

/** One run per repo, in this process: the desktop app is one process. */
const runs = new Map<string, Run>();

// ---- the log: deploys and previews alike, in D1's `deploys` table ------------

export type Trigger = "button" | "commit" | "preview";

/** How many logged runs each repo keeps, previews and deploys counted apart. */
export const KEEP = 50;

/** Log a run as it starts, and let the oldest go past KEEP. */
export async function logStart(env: Env, owner: string, repo: string, run: Run, by: string, trigger: Trigger, runner: "desktop" | "hosted" = "desktop", keyLast4?: string) {
  const kind = trigger === "preview" ? "= 'preview'" : "!= 'preview'";
  await env.DB.batch([
    env.DB.prepare("INSERT INTO deploys (id, owner, repo, stage, by, trigger, status, at, runner, key_last4) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)")
      .bind(run.id, owner, repo, run.stage, by, trigger, run.at, runner, keyLast4 ?? null),
    env.DB.prepare(`DELETE FROM deploys WHERE owner = ? AND repo = ? AND trigger ${kind} AND id NOT IN
      (SELECT id FROM deploys WHERE owner = ? AND repo = ? AND trigger ${kind} ORDER BY at DESC LIMIT ?)`).bind(owner, repo, owner, repo, KEEP),
  ]);
}

/** Log how a run ended. The log keeps the end of each step's output, enough to see why one failed. */
export async function logEnd(env: Env, run: Run) {
  const ok = run.steps.every((x) => x.status === "done");
  const out = run.steps.filter((x) => x.out).map((x) => `── ${x.key} (${x.status})\n${x.out.slice(-2000)}`).join("\n").slice(-8000);
  await env.DB.prepare("UPDATE deploys SET status = ?, commit_hash = ?, url = ?, ms = ?, note = ?, out = ? WHERE id = ?")
    .bind(ok ? "done" : "failed", run.commit ?? null, run.url ?? null, Date.now() - run.at, run.note ?? null, out, run.id).run();
}

/**
 * The last 20 logged runs of one kind, and the run going now. One still "running" but not in this
 * process died with an earlier one. `live` is read after the query: a run that started while it
 * ran is already in the log, and isn't one that died.
 */
export async function history(env: Env, owner: string, repo: string, previews: boolean, live: () => Run | null | Promise<Run | null>) {
  const { results } = await env.DB.prepare(`SELECT id, stage, by, trigger, status, commit_hash, url, at, ms, note, out, runner, key_last4 FROM deploys
    WHERE owner = ? AND repo = ? AND trigger ${previews ? "= 'preview'" : "!= 'preview'"} ORDER BY at DESC LIMIT 20`).bind(owner, repo).all();
  const run = await live();
  return { run, history: (results as any[]).map((d) => d.status === "running" && run?.id !== d.id ? { ...d, status: "interrupted" } : d) };
}

/** The deployed URL from Alchemy's printed outputs: `url: "https://..."`, else the last workers.dev or railway one. */
export function urlIn(out: string): string | undefined {
  const named = [...out.matchAll(/\b(?:url|box)\s*:\s*["']?(https?:\/\/[^\s"',}]+)/g)].pop();
  if (named) return named[1];
  return [...out.matchAll(/https:\/\/[^\s"',}]+\.(?:workers\.dev|up\.railway\.app)[^\s"',}]*/g)].pop()?.[0];
}

const LOGIN_HINT = /unauthori[sz]ed|authentication|not logged in|no credentials|api token|CLOUDFLARE_API_TOKEN|RAILWAY_TOKEN|HCLOUD_TOKEN|profile/i;

/**
 * Clone, install, deploy and check `run.stage`; then destroy it, unless this is
 * a real deploy (`keep`, see deploy.ts), whose run has no destroy step. A real
 * deploy may take over live resources (`adopt`) when the owner said so.
 */
export async function preview(runner: Runner, remote: string, run: Run, opts: { keep?: boolean; allowAdopt?: boolean } = {}) {
  const fs = runner.workdir ? null : await import("node:fs");
  const dir = runner.workdir ?? fs!.mkdtempSync((await import("node:path")).join((await import("node:os")).tmpdir(), "codesplitters-preview-"));
  const app = `${dir}/repo`;
  const step = (k: StepKey) => run.steps.find((s) => s.key === k)!;
  const scrub = (s: string) => s.split(remote).join("<remote>");
  /** Run one step's commands; false when one fails. */
  const go = async (k: StepKey, cmds: { cmd: string[]; cwd: string }[]) => {
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
  // A real deploy's run has no destroy step.
  const skip = (...ks: StepKey[]) => { for (const k of ks) { const s = run.steps.find((x) => x.key === k); if (s) s.status = "skipped"; } };
  let deployed = false;
  try {
    if (!(await go("clone", [{ cmd: ["git", "clone", "--depth", "1", "--quiet", remote, "repo"], cwd: dir }, { cmd: ["git", "-C", "repo", "rev-parse", "HEAD"], cwd: dir }]))) return skip("install", "deploy", "check", "destroy");
    run.commit = /\b[0-9a-f]{40}\b/.exec(step("clone").out)?.[0];
    // Read the config with the repo's own @rustybuns/cli, so it is what deploy will see.
    const read = `const c = (await import("./rustybuns.config.ts")).default; console.log("RB " + JSON.stringify({ adopt: !!c.targets?.edge?.adopt, edge: !!c.targets?.edge, box: !!c.targets?.box }))`;
    if (!(await go("install", [{ cmd: ["bun", "install"], cwd: app }, { cmd: ["bun", "-e", read], cwd: app }]))) {
      if (/rustybuns\.config\.ts/.test(step("install").out)) run.note = "this repo has no rustybuns.config.ts: run `rustybuns init` in it first";
      return skip("deploy", "check", "destroy");
    }
    const cfg = JSON.parse(/RB (\{.*\})/.exec(step("install").out)?.[1] ?? "{}");
    if (!cfg.edge && !cfg.box) { run.note = "no edge or box target to deploy to"; return skip("deploy", "check", "destroy"); }
    if (cfg.adopt && !opts.allowAdopt) {
      const d = step("deploy");
      d.status = "failed";
      d.out = opts.keep
        ? "refused: targets.edge.adopt is on, so this deploy would take over the live Worker and its data under their real names.\nIf this repo is production, say so in the deploy settings.\n"
        : "refused: targets.edge.adopt is on, so this stack would take over the live Worker and its data under their real names, and destroy would delete them.\nTurn adopt off on a branch to preview it.\n";
      return skip("check", "destroy");
    }
    deployed = true;   // from here a half-made stack may exist, so destroy always runs
    const rb = (sub: string) => ({ cmd: ["bun", "x", "rustybuns", sub, "--yes", "--stage", run.stage], cwd: app });
    await runner.state?.restore(app);
    const ok = await go("deploy", [rb("deploy")]);
    // Kept even when the deploy failed: a half-made stack is in it too.
    await runner.state?.keep(app).catch((e: Error) => { step("deploy").out += `\ncouldn't keep the Alchemy state: ${e.message}\n`; });
    run.url = urlIn(step("deploy").out);
    if (!ok && LOGIN_HINT.test(step("deploy").out)) run.note = "the deploy wasn't logged in: run `rustybuns login cloudflare` (or railway, hetzner) on this machine";
    if (!ok) skip("check");
    else if (!run.url) { const c = step("check"); c.status = "failed"; c.out = "no URL in the deploy's outputs\n"; }
    else {
      const c = step("check"), t = Date.now(), url = run.url;
      c.status = "running";
      // A new Worker or service can take a little while to answer.
      let last = "";
      for (let i = 0; i < 30; i++) {
        last = await runner.fetch(url).then((r) => String(r.status), (e: Error) => e.message);
        c.out += `GET ${url} → ${last}\n`;
        if (+last > 0 && +last < 500) break;
        await (typeof Bun !== "undefined" ? Bun.sleep(2000) : new Promise((r) => setTimeout(r, 2000)));   // a hosted deploy runs in a Worker
      }
      c.status = +last > 0 && +last < 500 ? "done" : "failed";
      c.ms = Date.now() - t;
    }
    if (opts.keep) return;
    if (!(await go("destroy", [rb("destroy")]))) {
      run.kept = app;
      run.note = `destroy failed; the clone and its Alchemy state are kept in ${app}. Finish with: cd ${app} && bun x rustybuns destroy --yes --stage ${run.stage}`;
    }
  } finally {
    if (fs && !(deployed && run.kept)) fs.rmSync(dir, { recursive: true, force: true });
    run.done = true;
  }
}

export async function previewRoutes(req: Request, env: Env, p: string[], user: string | null): Promise<Response | null> {
  if (!(p[1] === "repos" && p[2] && p[3] && p[4] === "preview" && !p[5])) return null;
  const [owner, repo] = [p[2], p[3]], key = `${owner}/${repo}`;
  // It deploys with this machine's logins and shows the repo's output: the owner's alone.
  if (user !== owner) return json({ error: "only the repo's owner can run a preview deploy" }, 403);
  if (!(await env.DB.prepare("SELECT 1 FROM repos WHERE owner = ? AND name = ?").bind(owner, repo).first())) return json({ error: "not found" }, 404);
  const runner = runnerFor(env);
  if (req.method === "GET") {
    return json({ can_run: !!runner, ...(await history(env, owner, repo, true, () => runs.get(key) ?? null)) });
  }
  if (req.method !== "POST") return null;
  if (!runner) return json({ error: "preview deploys run on the desktop app, with your own logins" }, 400);
  if (runs.get(key) && !runs.get(key)!.done) return json({ error: "a preview is already running" }, 409);
  const h = await handleFor(env, owner, repo);
  const art = h && await artifactAccess(h.handle, h.remote, "read", 3600);
  if (!art) return json({ error: "this repo has no git remote yet: commit its files first" }, 400);
  const remote = art.remote.replace("://", `://x:${art.token.split("?")[0]}@`);
  const id = crypto.randomUUID().slice(0, 8);
  const run: Run = { id, at: Date.now(), stage: `preview-${id}`, steps: STEPS.map((key) => ({ key, status: "waiting", out: "" })), done: false };
  runs.set(key, run);
  await logStart(env, owner, repo, run, user, "preview");
  void preview(runner, remote, run)
    .catch((e: Error) => { run.note = `failed: ${e.message}`; run.done = true; })
    .then(() => logEnd(env, run));
  return json({ run }, 202);
}
