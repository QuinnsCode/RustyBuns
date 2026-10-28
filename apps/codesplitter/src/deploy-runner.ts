// Layout: the per-repo Durable Object that runs a hosted deploy in its own container
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
// The keys run whatever is on main, so before they're unsealed the run checks
// that everything since the owner's last approval is the owner's own
// (deploy-review.ts), and the clone has to be the commit it checked.
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
//   POST /start {owner, repo, by, trigger, allowDelete?, force?}   from deploy.ts, after its checks
//   GET  /run                                the run going now, or the last one
//   POST /reseal {owner, repo}               seal the kept state under the current DEPLOY_SECRETS_KEY (deploy-keys.ts)
//   POST /preview {owner, repo, dir, files}  the dependency doctor's preview (deps.ts, #900), below
//   GET  /preview                            the doctor's preview going now, or the last one
//
// The dependency doctor's previews run here too, when the repo has a deploy key: main's
// checked tip with the doctor's files laid over it (the container's POST /files), deployed
// to a preview-<id> stage, checked and destroyed, in an alarm of its own, like a deploy. A deploy
// and a preview share the container, so one waits for the other. Each counts against the owner's
// `preview` rule and the site's `containers` minutes, as a check in a container does
// (ci-runner.ts). The doctor doesn't wait: it asks again on its next run, with the same files,
// and gets the result, kept here by commit, folder and files. A preview keeps no Alchemy state:
// it stands up and comes down in the one container. Unless its destroy fails: then that
// stage's state is sealed under `stuck:<stage>` with the commit and files it ran, and a later
// alarm, when the container is free, puts it back in a fresh container and destroys again,
// backing off between tries. The sealed state goes only once a destroy succeeds (#1299).

import { begin, finish, remoteFor, stateSuffix, type DeployFlags } from "./deploy.ts";
import { isCleared, review, waitingNote } from "./deploy-review.ts";
import { deployKeys, keyEnv, keysInfo, keysLabel, resealState, sealState, unsealState, type Provider } from "./deploy-keys.ts";
import { json, type Env } from "./env.ts";
import { isAdmin } from "./identity.ts";
import { charge, SITE } from "./limits.ts";
import { logEnd, logStart, preview, STEPS as PREVIEW_STEPS, type Run, type Runner } from "./preview.ts";
import { portFetch, type ContainerApi } from "./sandbox.ts";
import { CRATES, gate, hostList, hostOf, PROVIDER_HOSTS, REGISTRIES, type GateExports } from "./egress.ts";
import { sha256 } from "./util.ts";
import type { RepoRef } from "./repos";

interface Job { owner: string; repo: string; run: Run; production: boolean; dir?: string; flags?: DeployFlags; again?: string; started?: number; preview?: { key: string; tip: string; files: Record<string, string> } }

/** How a doctor's preview went, kept for the doctor to ask about: `out`, the end of the step that failed. */
export interface PreviewResult { id: string; stage: string; ok: boolean; url?: string; failed?: string; note?: string; out?: string }
/** What POST /preview answers: the result, the run it's waiting on, or why it can't go now. */
export type PreviewAnswer = { result: PreviewResult } | { running: Run } | { busy: string };
/** A preview whose destroy failed: what a later alarm needs to destroy it again (#1299). */
interface Stuck { id: string; stage: string; commit: string; dir?: string; files: Record<string, string>; sealed: string; tries: number; next: number; last?: string }
/** The wait before a stuck preview's next destroy, doubling from the first to the last. */
const RETRY_MS = [10 * 60_000, 24 * 60 * 60_000];

/** Results kept, newest last. */
const KEEP_RESULTS = 20;

/** A preview's key: the commit it deploys, the app's folder and the files laid over it. */
async function previewKey(tip: string, dir: string | undefined, files: Record<string, string>) {
  const text = JSON.stringify([tip, dir ?? "", Object.entries(files).sort(([a], [b]) => a.localeCompare(b))]);
  return sha256(text);
}

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
  exports?: GateExports;
  storage: {
    get<T>(k: string): Promise<T | undefined>; put(k: string, v: unknown): Promise<void>; delete(k: string): Promise<boolean>; setAlarm(at: number): Promise<void>;
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

  private async begin(owner: string, repo: string, by: string, trigger: "button" | "commit", flags: DeployFlags = {}) {
    const { run, production, dir } = await begin(this.env, owner, repo, by, trigger, "hosted", keysLabel(await keysInfo(this.env, owner, repo)));
    this.job = { owner, repo, run, production, dir, flags };
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
    for (const [k, stuck] of await this.ctx.storage.list<Stuck>({ prefix: "stuck:" })) {
      try {
        const fresh = await resealState(this.env, owner, repo, stuck.sealed);
        if (!fresh || (await this.ctx.storage.get<Stuck>(k))?.sealed !== stuck.sealed) continue;
        await this.ctx.storage.put(k, { ...stuck, sealed: fresh });
        out.states++;
      } catch { out.failed.push(k); }
    }
    return out;
  }

  /** The doctor's preview of `files` over main: its result if there is one, else the run it starts or waits on. */
  private async preview(owner: string, repo: string, dir: string | undefined, files: Record<string, string>): Promise<PreviewAnswer> {
    const job = await this.load();
    // The keys run main, so main has to be cleared as for a deploy, and the result is for that commit.
    const checked = await review(this.env, owner, repo);
    if (!isCleared(checked)) return { busy: waitingNote(checked) };
    const key = await previewKey(checked.tip!, dir, files);
    const done = (await this.ctx.storage.get<Record<string, PreviewResult>>("previews"))?.[key];
    if (done) return { result: done };
    if (job && !job.run.done) return job.preview?.key === key ? { running: job.run } : { busy: job.preview ? "another preview is running in this repo's deploy container" : "a deploy is running in this repo's deploy container" };
    // Its first container minute comes off the site's budget up front, as a check's does (ci-runner.ts).
    const over = (this.env.ADMINS && isAdmin(this.env, owner) ? null : await charge(this.env, "preview", `@${owner}`))
      ?? await charge(this.env, "containers", SITE);
    if (over) return { busy: over };
    const id = crypto.randomUUID().slice(0, 8);
    const run: Run = { id, at: Date.now(), stage: `preview-${id}`, steps: PREVIEW_STEPS.map((key) => ({ key, status: "waiting", out: "" })), done: false };
    await logStart(this.env, owner, repo, run, "agent-deps", "preview", "hosted", keysLabel(await keysInfo(this.env, owner, repo)));
    // The deploy panel keeps showing the last deploy while a preview holds the slot.
    if (job && !job.preview) await this.ctx.storage.put("last", job.run);
    this.job = { owner, repo, run, production: false, dir, preview: { key, tip: checked.tip!, files }, ...(job?.again && { again: job.again }) };
    await this.save();
    await this.ctx.storage.setAlarm(Date.now());
    return { running: run };
  }

  async fetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (path === "/reseal") {
      const { owner, repo } = (await req.json()) as RepoRef;
      return json(await this.reseal(owner, repo));
    }
    if (path === "/preview" && req.method === "GET") { const job = await this.load(); return json({ run: job?.preview ? job.run : null }); }
    if (path === "/preview") {
      const { owner, repo, dir, files } = (await req.json()) as { owner: string; repo: string; dir?: string; files: Record<string, string> };
      return json(await this.preview(owner, repo, dir, files));
    }
    const job = await this.load();
    if (req.method === "GET") return json({ run: job?.preview ? (await this.ctx.storage.get<Run>("last")) ?? null : job?.run ?? null });
    const { owner, repo, by, trigger, allowDelete, force } = (await req.json()) as { owner: string; repo: string; by: string; trigger: "button" | "commit" } & DeployFlags;
    if (job && !job.run.done) {
      if (trigger === "button") return json({ error: job.preview ? "the dependency doctor's preview is running: deploy when it's done" : "a deploy is already running", status: 409 });
      job.again = by;
      await this.save();
      return json({ queued: true });
    }
    return json({ run: await this.begin(owner, repo, by, trigger, { ...(allowDelete && { allowDelete }), ...(force && { force }) }) });
  }

  async alarm() {
    const job = await this.load();
    if (!job || job.run.done) return this.destroyStuck();
    const { owner, repo, run } = job, c = this.ctx.container;
    try {
      if (job.started) throw new Error("the run was cut off before it finished (an alarm gets 15 minutes)");
      job.started = Date.now();
      const deadline = run.deadline = job.started + this.budgetMs;
      await this.save();
      if (!c) throw new Error("this Durable Object has no container");
      const checked = await review(this.env, owner, repo);
      if (!isCleared(checked)) throw new Error(waitingNote(checked));
      const keys = await deployKeys(this.env, owner, repo);
      if (!Object.keys(keys).length) throw new Error("every deploy key was removed");
      const remote = await remoteFor(this.env, owner, repo);
      if (!remote) throw new Error("this repo has no git remote yet");
      // Only the clone, the registries and the APIs of the providers it holds keys for (#681, src/egress.ts).
      // Hetzner's deploy reaches its server over SSH, so that one keeps other ports open, and
      // may compile an x86 box's native/ crates, so it reaches crates.io too.
      const hosts = hostList([hostOf(remote)], REGISTRIES, ...Object.keys(keys).map((p) => PROVIDER_HOSTS[p as Provider]), keys.hetzner ? CRATES : []);
      await gate(c, this.ctx.exports, hosts);
      c.start({ env: { ...keyEnv(keys), CI: "1" }, enableInternet: !!keys.hetzner });
      const secrets = Object.values(keys).map((k) => k.token);
      const runner: Runner = {
        workdir: `/work/${run.id}`,
        write: async (cwd, files) => {
          const res = await portFetch(c, "/files", JSON.stringify({ cwd, files }));
          if (!res.ok) throw new Error(`the container's /files: ${res.status} ${await res.text()}`);
        },
        // The image has cargo (deploy-sandbox/Dockerfile) and no Docker: x86 crates build, arm64 ones can't.
        nativeArches: ["linux-x64"],
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
        // A preview comes down in this same container, so it keeps no state.
        state: job.preview ? undefined : {
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
      if (job.preview) await preview(runner, remote, run, { dir: job.dir, files: job.preview.files, expect: job.preview.tip });
      else await preview(runner, remote, run, { keep: true, allowAdopt: job.production, ...job.flags, dir: job.dir, expect: checked.tip! });
      if (run.note?.includes("wasn't logged in")) run.note = "the deploy wasn't logged in: store a deploy key for each provider its targets use (Cloudflare, Railway, Hetzner)";
      // The clone it names goes with the container; a preview's state is kept for a later destroy.
      if (run.kept) {
        const files = job.preview && await this.stick(c, job, run.kept).catch(() => false);
        run.note = files ? `destroy failed: stage ${run.stage}'s state is kept, sealed, and a later run destroys it again`
          : `destroy failed, and the container is gone: take stage ${run.stage} down by hand in the provider's dashboard`;
      }
    } catch (e) {
      run.note = `failed: ${(e as Error).message}`;
    } finally {
      run.done = true;
      await c?.destroy().catch(() => {});
      if (job.preview) await this.previewDone(job);
      else await finish(this.env, run);
      await this.save();
      if (job.again) await this.begin(owner, repo, job.again, "commit");
      else await this.nextAlarm();
    }
  }

  /** Seal a preview's state after its destroy failed, with what a later destroy needs. False when it has none. */
  private async stick(c: ContainerApi, job: Job, app: string) {
    const { files } = (await call(c, { cwd: app })) as { files: Record<string, string> };
    if (!Object.keys(files).length) return false;
    const sealed = await sealState(this.env, job.owner, job.repo, files);
    if (sealed.length > STATE_MAX) return false;
    const stuck: Stuck = { id: job.run.id, stage: job.run.stage, commit: job.preview!.tip, dir: job.dir, files: job.preview!.files, sealed, tries: 0, next: Date.now() + RETRY_MS[0]! };
    await this.ctx.storage.put(`stuck:${stuck.stage}`, stuck);
    return true;
  }

  /** The alarm for whatever waits: a queued run now, else the soonest stuck preview's next destroy. */
  private async nextAlarm() {
    const job = await this.load();
    if (job && !job.run.done) return this.ctx.storage.setAlarm(Date.now());
    const stuck = [...(await this.ctx.storage.list<Stuck>({ prefix: "stuck:" })).values()];
    if (stuck.length) await this.ctx.storage.setAlarm(Math.min(...stuck.map((x) => x.next)));
  }

  /**
   * Destroy the stuck preview that's waited longest, in a fresh container: the commit it ran, its
   * files over it, its state put back. The sealed state goes once the destroy succeeds; else it's
   * sealed again as the destroy left it, and tried later.
   */
  private async destroyStuck() {
    const job = await this.load(), c = this.ctx.container;
    if (!job || !c) return;
    const stuck = [...(await this.ctx.storage.list<Stuck>({ prefix: "stuck:" })).values()].sort((a, b) => a.next - b.next)[0];
    if (!stuck) return;
    const { owner, repo } = job, key = `stuck:${stuck.stage}`, started = Date.now(), deadline = started + this.budgetMs;
    const wd = `/work/${stuck.id}`, app = stuck.dir ? `${wd}/repo/${stuck.dir}` : `${wd}/repo`;
    let done = false, why = "";
    try {
      const keys = await deployKeys(this.env, owner, repo);
      if (!Object.keys(keys).length) throw new Error("every deploy key was removed");
      const remote = await remoteFor(this.env, owner, repo);
      if (!remote) throw new Error("this repo has no git remote");
      await gate(c, this.ctx.exports, hostList([hostOf(remote)], REGISTRIES, ...Object.keys(keys).map((p) => PROVIDER_HOSTS[p as Provider]), keys.hetzner ? CRATES : []));
      c.start({ env: { ...keyEnv(keys), CI: "1" }, enableInternet: !!keys.hetzner });
      const secrets = [remote, ...Object.values(keys).map((k) => k.token)];
      const run = async (cmd: string[], cwd: string) => {
        let out = "";
        const h = hider(secrets, (s) => { out = (out + s).slice(-1500); });
        const res = await portFetch(c, "/exec", JSON.stringify({ cmd, cwd, limit_ms: Math.max(1, deadline - Date.now()) }));
        const code = await readExec(res, h.push).finally(h.flush);
        if (code !== 0) throw new Error(`${cmd.slice(0, 3).join(" ")} exited ${code}: ${out.trim().slice(-500)}`);
      };
      // The commit the preview ran, which the review cleared then, not main's tip now.
      await run(["git", "init", "--quiet", "repo"], wd);
      await run(["git", "-C", "repo", "fetch", "--quiet", "--depth", "1", remote, stuck.commit], wd);
      await run(["git", "-C", "repo", "checkout", "--quiet", "FETCH_HEAD"], wd);
      const res = await portFetch(c, "/files", JSON.stringify({ cwd: `${wd}/repo`, files: stuck.files }));
      if (!res.ok) throw new Error(`the container's /files: ${res.status}`);
      await run(["bun", "install"], app);
      await call(c, { cwd: app, files: await unsealState(this.env, owner, repo, stuck.sealed) });
      await run(["bun", "x", "rustybuns", "destroy", "--yes", "--stage", stuck.stage], app);
      done = true;
      await this.ctx.storage.delete(key);
      await this.env.DB.prepare("UPDATE deploys SET note = ? WHERE id = ?").bind(`its destroy failed, and a later try took stage ${stuck.stage} down`, stuck.id).run().catch(() => null);
    } catch (e) {
      why = (e as Error).message;
    } finally {
      if (!done) {
        // As the failed destroy left it: it may have taken some of the stack down.
        const { files } = c.running ? (await call(c, { cwd: app }).catch(() => ({ files: {} }))) as { files: Record<string, string> } : { files: {} };
        const left = Object.keys(files).length ? await sealState(this.env, owner, repo, files).catch(() => null) : null;
        const tries = stuck.tries + 1;
        await this.ctx.storage.put(key, { ...stuck, ...(left && left.length <= STATE_MAX && { sealed: left }), tries,
          next: Date.now() + Math.min(RETRY_MS[0]! * 2 ** tries, RETRY_MS[1]!), last: why.slice(0, 1000) });
      }
      await c.destroy().catch(() => {});
      const minutes = Math.ceil((Date.now() - started) / 60_000);
      await charge(this.env, "containers", SITE, minutes).catch(() => null);
      await this.nextAlarm();
    }
  }

  /** Log a doctor's preview, keep its result for the doctor's next run, and charge the rest of its container minutes. */
  private async previewDone(job: Job) {
    const { run } = job;
    await logEnd(this.env, run);
    const failed = run.steps.find((x) => x.status === "failed");
    const result: PreviewResult = { id: run.id, stage: run.stage, ok: run.steps.every((x) => x.status === "done"),
      ...(run.url && { url: run.url }), ...(failed && { failed: failed.key, out: failed.out.slice(-1500) }), ...(run.note && { note: run.note }) };
    // One that didn't get as far as the deploy (main moved, the keys went) isn't a result: the next ask tries again.
    if (job.started && !run.note?.startsWith("failed:") && failed?.key !== "clone") {
      const kept = Object.entries((await this.ctx.storage.get<Record<string, PreviewResult>>("previews")) ?? {}).filter(([k]) => k !== job.preview!.key);
      await this.ctx.storage.put("previews", Object.fromEntries([...kept, [job.preview!.key, result]].slice(-KEEP_RESULTS)));
    }
    // It ran already, so going over only stops the next one.
    const rest = job.started ? Math.ceil((Date.now() - job.started) / 60_000) - 1 : 0;
    if (rest > 0) await charge(this.env, "containers", SITE, rest).catch(() => null);
  }
}
