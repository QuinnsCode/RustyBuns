// Hosted deploys: the same clone, install, deploy, check as a deploy from the
// desktop (deploy.ts), run by the site with the repo's stored deploy key
// (deploy-keys.ts) instead of the owner's machine.
//
// One DeployRunner Durable Object per repo, so one deploy at a time, and a
// commit during a deploy queues one more, as on the desktop. Each run starts
// its own container (deploy-sandbox/Dockerfile: git, bun and a small server),
// the only place the key is unsealed to: it goes into that container's env as
// CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID and the container is destroyed
// when the run ends. It is a separate image and binding from AGENT_SANDBOX, so
// agent containers never see a deploy key. The run happens in an alarm, so it
// outlives the request that started it; every use is in the deploy log.
//
//   POST /start {owner, repo, by, trigger}   from deploy.ts, after its checks
//   GET  /run                                the run going now, or the last one

import { begin, finish, remoteFor } from "./deploy.ts";
import { deployKey, keyInfo } from "./deploy-keys.ts";
import { json, type Env } from "./env.ts";
import { preview, type Run, type Runner } from "./preview.ts";
import { portFetch, type ContainerApi } from "./sandbox.ts";

interface Job { owner: string; repo: string; run: Run; production: boolean; again?: string }

/** The slice of a Durable Object's state we use. */
export interface RunnerState {
  container?: ContainerApi;
  storage: { get<T>(k: string): Promise<T | undefined>; put(k: string, v: unknown): Promise<void>; setAlarm(at: number): Promise<void> };
}

export class DeployRunner {
  private job: Job | null | undefined;
  constructor(private ctx: RunnerState, private env: Env) {}

  private async load() {
    if (this.job === undefined) this.job = (await this.ctx.storage.get<Job>("job")) ?? null;
    return this.job;
  }
  private save() { return this.ctx.storage.put("job", this.job); }

  private async begin(owner: string, repo: string, by: string, trigger: "button" | "commit") {
    const key = await keyInfo(this.env, owner, repo);
    const { run, production } = await begin(this.env, owner, repo, by, trigger, "hosted", key.last4 as string | undefined);
    this.job = { owner, repo, run, production };
    await this.save();
    await this.ctx.storage.setAlarm(Date.now());
    return run;
  }

  async fetch(req: Request): Promise<Response> {
    const job = await this.load();
    if (req.method === "GET") return json({ run: job?.run ?? null });
    const { owner, repo, by, trigger } = (await req.json()) as { owner: string; repo: string; by: string; trigger: "button" | "commit" };
    if (job && !job.run.done) {
      if (trigger === "button") return json({ error: "a deploy is already running", status: 409 });
      job.again = by;
      await this.save();
      return json({ queued: true });
    }
    return json({ run: await this.begin(owner, repo, by, trigger) });
  }

  async alarm() {
    const job = await this.load();
    if (!job || job.run.done) return;
    const { owner, repo, run } = job, c = this.ctx.container;
    try {
      if (!c) throw new Error("this Durable Object has no container");
      const key = await deployKey(this.env, owner, repo);
      if (!key) throw new Error("the deploy key was removed");
      const remote = await remoteFor(this.env, owner, repo);
      if (!remote) throw new Error("this repo has no git remote yet");
      c.start({ env: { CLOUDFLARE_API_TOKEN: key.token, CLOUDFLARE_ACCOUNT_ID: key.account_id, CI: "1" }, enableInternet: true });
      const hide = (s: string) => s.split(key.token).join("<deploy key>");
      const runner: Runner = {
        workdir: `/work/${run.id}`,
        exec: async (cmd, cwd, out) => {
          const res = await portFetch(c, "/exec", JSON.stringify({ cmd, cwd }));
          const r = (await res.json()) as { code: number; out: string };
          out(hide(r.out ?? ""));
          await this.save();   // so a GET from a fresh instance sees the steps so far
          return r.code ?? 1;
        },
        fetch: (u) => fetch(u, { redirect: "manual" }),
      };
      await preview(runner, remote, run, { keep: true, allowAdopt: job.production });
    } catch (e) {
      run.note = `failed: ${(e as Error).message}`;
    } finally {
      run.done = true;
      await c?.destroy().catch(() => {});
      await finish(this.env, run);
      await this.save();
      if (job.again) await this.begin(owner, repo, job.again, "commit");
    }
  }
}
