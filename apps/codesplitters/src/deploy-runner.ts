// Hosted deploys: the same clone, install, deploy, check as a deploy from the
// desktop (deploy.ts), run by the site with the repo's stored deploy key
// (deploy-keys.ts) instead of the owner's machine.
//
// One DeployRunner Durable Object per repo, so one deploy at a time, and a
// commit during a deploy queues one more, as on the desktop. Each run starts
// its own container (deploy-sandbox/Dockerfile: git, bun and a small server),
// the only place the keys are unsealed to: they go into that container's env
// (CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, RAILWAY_API_TOKEN, HCLOUD_TOKEN:
// whichever the owner stored) and the container is destroyed when the run ends. It is a separate image and binding from AGENT_SANDBOX, so
// agent containers never see a deploy key. The run happens in an alarm, so it
// outlives the request that started it; every use is in the deploy log. A
// command's output streams back as it runs, so the panel shows it live.
//
// An alarm gets 15 minutes of wall time, so a run gets RUN_BUDGET_MS: each
// command is sent the time left and the container kills it when that's up,
// leaving time to destroy the container and log the result. If the alarm is cut
// off anyway, its retry fails the run rather than deploying a second time.
//
// The container forgets, so the repo's Alchemy state is kept here between runs,
// sealed under DEPLOY_SECRETS_KEY (it holds the app's secrets), and put back
// before each deploy: the next deploy updates the same stack instead of making
// a second one under a new name. Each app folder of a monorepo keeps its own.
//
//   POST /start {owner, repo, by, trigger}   from deploy.ts, after its checks
//   GET  /run                                the run going now, or the last one
//   POST /reseal {owner, repo}               seal the kept state under the current DEPLOY_SECRETS_KEY (deploy-keys.ts)

import { begin, finish, remoteFor, stateSuffix } from "./deploy.ts";
import { deployKeys, keyEnv, keysInfo, keysLabel, resealState, sealState, unsealState } from "./deploy-keys.ts";
import { json, type Env } from "./env.ts";
import { preview, type Run, type Runner } from "./preview.ts";
import { portFetch, type ContainerApi } from "./sandbox.ts";

interface Job { owner: string; repo: string; run: Run; production: boolean; dir?: string; again?: string; started?: number }

/** A run's share of the alarm's 15 minutes, leaving room to clean up after it. */
export const RUN_BUDGET_MS = 13 * 60_000;
/** Under a Durable Object's 2 MB per stored value. */
const STATE_MAX = 1_900_000;

/** The deploy container's POST /state (deploy-sandbox/server.mjs). */
async function call(c: ContainerApi, body: unknown) {
  const res = await portFetch(c, "/state", JSON.stringify(body));
  if (!res.ok) throw new Error(`the container's /state: ${res.status} ${await res.text()}`);
  return (await res.json()) as unknown;
}

/**
 * The deploy container's POST /exec answer (deploy-sandbox/server.mjs): a JSON line
 * per piece of output as the command runs, `{out}`, and a last one with its exit
 * code, `{code}`. Resolves to the code.
 */
export async function readExec(res: Response, out: (s: string) => void): Promise<number> {
  let code: number | undefined, buf = "";
  const line = (l: string) => {
    if (!l.trim()) return;
    const m = JSON.parse(l) as { out?: string; code?: number };
    if (m.out) out(m.out);
    if (typeof m.code === "number") code = m.code;
  };
  if (res.body) {
    const reader = res.body.getReader(), d = new TextDecoder();
    for (let r = await reader.read(); !r.done; r = await reader.read()) {
      buf += d.decode(r.value, { stream: true });
      const i = buf.lastIndexOf("\n");
      if (i < 0) continue;
      buf.slice(0, i).split("\n").forEach(line);
      buf = buf.slice(i + 1);
    }
    buf += d.decode();
  }
  line(buf);
  if (code === undefined) { out("\nthe container's answer ended before the command did\n"); return 1; }
  return code;
}

/**
 * Output with the deploy keys swapped out. A key can arrive split across two
 * pieces, so what's after the last line break is held until the line ends (keys
 * have no line breaks), or, on a long line, all but a key's length of it.
 */
export function hider(secrets: string[], out: (s: string) => void) {
  const hide = (s: string) => secrets.reduce((t, k) => t.split(k).join("<deploy key>"), s);
  const longest = Math.max(0, ...secrets.map((k) => k.length));
  let held = "";
  return {
    push(s: string) {
      held = hide(held + s);
      const i = Math.max(held.lastIndexOf("\n"), held.lastIndexOf("\r")) + 1;
      const cut = held.length - i > 4 * longest ? held.length - longest : i;
      if (cut > 0) { out(held.slice(0, cut)); held = held.slice(cut); }
    },
    flush() { if (held) out(held); held = ""; },
  };
}

/** The slice of a Durable Object's state we use. */
export interface RunnerState {
  container?: ContainerApi;
  storage: {
    get<T>(k: string): Promise<T | undefined>; put(k: string, v: unknown): Promise<void>; setAlarm(at: number): Promise<void>;
    list<T>(o: { prefix: string }): Promise<Map<string, T>>;
  };
}

export class DeployRunner {
  private job: Job | null | undefined;
  constructor(private ctx: RunnerState, private env: Env, private budgetMs = RUN_BUDGET_MS) {}

  private async load() {
    if (this.job === undefined) this.job = (await this.ctx.storage.get<Job>("job")) ?? null;
    return this.job;
  }
  private save() { return this.ctx.storage.put("job", this.job); }

  private async begin(owner: string, repo: string, by: string, trigger: "button" | "commit") {
    const { run, production, dir } = await begin(this.env, owner, repo, by, trigger, "hosted", keysLabel(await keysInfo(this.env, owner, repo)));
    this.job = { owner, repo, run, production, dir };
    await this.save();
    await this.ctx.storage.setAlarm(Date.now());
    return run;
  }

  /** Seal each app folder's kept state under the current DEPLOY_SECRETS_KEY. */
  private async reseal(owner: string, repo: string) {
    const out = { states: 0, failed: [] as string[] };
    for (const [k, sealed] of await this.ctx.storage.list<string>({ prefix: "state" })) {
      try {
        const fresh = await resealState(this.env, owner, repo, sealed);
        // A deploy that kept newer state meanwhile sealed it under the current key already.
        if (!fresh || (await this.ctx.storage.get<string>(k)) !== sealed) continue;
        await this.ctx.storage.put(k, fresh);
        out.states++;
      } catch { out.failed.push(k.slice("state".length)); }
    }
    return out;
  }

  async fetch(req: Request): Promise<Response> {
    if (new URL(req.url).pathname === "/reseal") {
      const { owner, repo } = (await req.json()) as { owner: string; repo: string };
      return json(await this.reseal(owner, repo));
    }
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
      if (job.started) throw new Error("the run was cut off before it finished (an alarm gets 15 minutes)");
      job.started = Date.now();
      await this.save();
      const deadline = job.started + this.budgetMs;
      if (!c) throw new Error("this Durable Object has no container");
      const keys = await deployKeys(this.env, owner, repo);
      if (!Object.keys(keys).length) throw new Error("every deploy key was removed");
      const remote = await remoteFor(this.env, owner, repo);
      if (!remote) throw new Error("this repo has no git remote yet");
      c.start({ env: { ...keyEnv(keys), CI: "1" }, enableInternet: true });
      const secrets = Object.values(keys).map((k) => k.token);
      const runner: Runner = {
        workdir: `/work/${run.id}`,
        noRust: true,
        exec: async (cmd, cwd, out) => {
          const left = deadline - Date.now();
          if (left <= 0) throw new Error(`out of time: a hosted deploy gets ${Math.round(this.budgetMs / 60_000)} minutes`);
          // Saved now and then as it streams, so a GET from a fresh instance sees it too.
          let saved = Date.now();
          const h = hider(secrets, (s) => { out(s); if (Date.now() - saved > 1000) { saved = Date.now(); void this.save(); } });
          const res = await portFetch(c, "/exec", JSON.stringify({ cmd, cwd, limit_ms: left }));
          const code = await readExec(res, h.push).finally(h.flush);
          await this.save();
          return code;
        },
        fetch: (u) => fetch(u, { redirect: "manual" }),
        state: {
          restore: async (app) => {
            const sealed = await this.ctx.storage.get<string>(`state${stateSuffix(job.dir)}`);
            if (sealed) await call(c, { cwd: app, files: await unsealState(this.env, owner, repo, sealed) });
          },
          keep: async (app) => {
            const { files } = (await call(c, { cwd: app })) as { files: Record<string, string> };
            if (!Object.keys(files).length) return;
            const sealed = await sealState(this.env, owner, repo, files);
            if (sealed.length > STATE_MAX) throw new Error(`${sealed.length} bytes sealed, over the ${STATE_MAX} this keeps`);
            await this.ctx.storage.put(`state${stateSuffix(job.dir)}`, sealed);
          },
        },
      };
      await preview(runner, remote, run, { keep: true, allowAdopt: job.production, dir: job.dir });
      if (run.note?.includes("wasn't logged in")) run.note = "the deploy wasn't logged in: store a deploy key for each provider its targets use (Cloudflare, Railway, Hetzner)";
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
