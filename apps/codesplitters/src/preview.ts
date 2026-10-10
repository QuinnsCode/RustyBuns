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
// finished by hand.
//
//   GET  /api/repos/:o/:r/preview     the current or last run (owner only)
//   POST /api/repos/:o/:r/preview     start one

import { access as artifactAccess, handleFor } from "./archive.ts";
import { json, type Env } from "./env.ts";

export type StepKey = "clone" | "install" | "deploy" | "check" | "destroy";
export interface Step { key: StepKey; status: "waiting" | "running" | "done" | "failed" | "skipped"; out: string; ms?: number }
export interface Run { id: string; at: number; stage: string; steps: Step[]; url?: string; done: boolean; kept?: string; note?: string }

/** Run a command, streaming its output; resolves to the exit code. */
export type Exec = (cmd: string[], cwd: string, out: (s: string) => void) => Promise<number>;
export interface Runner { exec: Exec; fetch: (url: string) => Promise<{ status: number }> }

const STEPS: StepKey[] = ["clone", "install", "deploy", "check", "destroy"];
const MAX_OUT = 60_000;

const spawnExec = (timeoutMs = 15 * 60_000): Exec => async (cmd, cwd, out) => {
  const p = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe", timeout: timeoutMs, env: { ...process.env, CI: "1" } });
  const pump = async (s: ReadableStream<Uint8Array>) => { const d = new TextDecoder(); for await (const c of s) out(d.decode(c, { stream: true })); };
  await Promise.all([pump(p.stdout), pump(p.stderr)]);
  return await p.exited;
};

const runnerFor = (env: Env): Runner | null => {
  const fake = env.PREVIEW_RUNNER as Runner | undefined;
  if (fake) return fake;
  return typeof Bun !== "undefined" && !env.BETTER_AUTH_SECRET ? { exec: spawnExec(), fetch: (u) => fetch(u, { redirect: "manual" }) } : null;
};

/** One run per repo, in this process: the desktop app is one process. */
const runs = new Map<string, Run>();

/** The deployed URL from Alchemy's printed outputs: `url: "https://..."`, else the last workers.dev or railway one. */
export function urlIn(out: string): string | undefined {
  const named = [...out.matchAll(/\b(?:url|box)\s*:\s*["']?(https?:\/\/[^\s"',}]+)/g)].pop();
  if (named) return named[1];
  return [...out.matchAll(/https:\/\/[^\s"',}]+\.(?:workers\.dev|up\.railway\.app)[^\s"',}]*/g)].pop()?.[0];
}

const LOGIN_HINT = /unauthori[sz]ed|authentication|not logged in|no credentials|api token|CLOUDFLARE_API_TOKEN|RAILWAY_TOKEN|HCLOUD_TOKEN|profile/i;

export async function preview(runner: Runner, remote: string, run: Run) {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "codesplitters-preview-"));
  const app = join(dir, "repo");
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
  const skip = (...ks: StepKey[]) => { for (const k of ks) step(k).status = "skipped"; };
  let deployed = false;
  try {
    if (!(await go("clone", [{ cmd: ["git", "clone", "--depth", "1", "--quiet", remote, "repo"], cwd: dir }]))) return skip("install", "deploy", "check", "destroy");
    // Read the config with the repo's own @rustybuns/cli, so it is what deploy will see.
    const read = `const c = (await import("./rustybuns.config.ts")).default; console.log("RB " + JSON.stringify({ adopt: !!c.targets?.edge?.adopt, edge: !!c.targets?.edge, box: !!c.targets?.box }))`;
    if (!(await go("install", [{ cmd: ["bun", "install"], cwd: app }, { cmd: ["bun", "-e", read], cwd: app }]))) {
      if (/rustybuns\.config\.ts/.test(step("install").out)) run.note = "this repo has no rustybuns.config.ts: run `rustybuns init` in it first";
      return skip("deploy", "check", "destroy");
    }
    const cfg = JSON.parse(/RB (\{.*\})/.exec(step("install").out)?.[1] ?? "{}");
    if (!cfg.edge && !cfg.box) { run.note = "no edge or box target to deploy to"; return skip("deploy", "check", "destroy"); }
    if (cfg.adopt) {
      const d = step("deploy");
      d.status = "failed";
      d.out = "refused: targets.edge.adopt is on, so this stack would take over the live Worker and its data under their real names, and destroy would delete them.\nTurn adopt off on a branch to preview it.\n";
      return skip("check", "destroy");
    }
    deployed = true;   // from here a half-made stack may exist, so destroy always runs
    const rb = (sub: string) => ({ cmd: ["bun", "x", "rustybuns", sub, "--yes", "--stage", run.stage], cwd: app });
    const ok = await go("deploy", [rb("deploy")]);
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
        await Bun.sleep(2000);
      }
      c.status = +last > 0 && +last < 500 ? "done" : "failed";
      c.ms = Date.now() - t;
    }
    if (!(await go("destroy", [rb("destroy")]))) {
      run.kept = app;
      run.note = `destroy failed; the clone and its Alchemy state are kept in ${app}. Finish with: cd ${app} && bun x rustybuns destroy --yes --stage ${run.stage}`;
    }
  } finally {
    if (!(deployed && run.kept)) rmSync(dir, { recursive: true, force: true });
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
  if (req.method === "GET") return json({ can_run: !!runner, run: runs.get(key) ?? null });
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
  void preview(runner, remote, run).catch((e: Error) => { run.note = `failed: ${e.message}`; run.done = true; });
  return json({ run }, 202);
}
