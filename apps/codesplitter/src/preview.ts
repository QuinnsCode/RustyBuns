// A preview deploy: the repo's own Rusty Buns stack, stood up on its targets
// and torn down again, five steps the owner watches go green on the repo page.
//
//   clone    the repo's git remote into a temp dir
//   install  bun install, then read rustybuns.config.ts
//   deploy   rustybuns deploy --yes --stage preview-<id>: a stack of its own
//   check    the deployed URL answers without a 5xx
//   destroy  rustybuns destroy on that stage, then the clone is deleted
//
// In a monorepo the app's folder (the deploy settings' `dir`) is where install,
// the config read, deploy and destroy run; bun install there still installs
// the whole workspace.
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

import { arr, Bad, bool, check, int, nul, num, obj, oneOf, opt, raw, str, type Guard, type Of } from "@rustybuns/util/guard";
import { access as artifactAccess, handleFor } from "./archive.ts";
import { settings } from "./deploy.ts";
import { isCleared, review, waitingNote } from "./deploy-review.ts";
import { json, type Env } from "./env.ts";
import { repoRow } from "./repos.ts";

// A run is one wire shape: the deploy runner (deploy-runner.ts) answers it, deploy.ts reads it, both through these guards.
const text = (max = Infinity) => str(max, { min: 0 });
const time = num(0, Number.MAX_SAFE_INTEGER);
const STEP_KEYS = ["clone", "install", "deploy", "check", "destroy", "init", "save", "plan"] as const;
export type StepKey = typeof STEP_KEYS[number];
const Step = obj({ key: oneOf(STEP_KEYS), status: oneOf(["waiting", "running", "done", "failed", "skipped"]), out: text(), ms: opt(time) });
export type Step = Of<typeof Step>;
/** One row of Alchemy's plan: a resource (or one of its bindings, `Worker/KV`) and what the deploy does to it. */
const PlanAction = oneOf(["create", "update", "adopted", "replace", "delete", "orphaned", "unbind"]);
const PlanRow = obj({ id: str(Infinity), action: PlanAction });
export type PlanRow = Of<typeof PlanRow>;
/**
 * `deadline`: when a hosted run is cut off (deploy-runner.ts); a desktop one has none. `infra`: the stack as a graph
 * (rustybuns infra --json), from a try-out's infra step. `plan`: what a plan against the stage would do, row by row (planRows).
 */
export const Run = obj({ id: str(200), at: time, stage: text(), steps: arr(Step, Infinity), url: opt(text()), done: bool(), kept: opt(text()),
  note: opt(text()), commit: opt(text()), deadline: opt(time), infra: raw, plan: opt(arr(PlanRow, Infinity)) });
export type Run = Of<typeof Run>;
/** What the deploy runner's GET /run answers: the run going now, or the last one. */
export const RunReply = obj({ run: nul(Run) });
/** What its POST /run answers: the run it started, that it queued one more, or why not. */
export const StartReply = obj({ run: opt(Run), queued: opt(bool()), error: opt(text()), status: opt(int(100, 599)) });

/**
 * The rows of an Alchemy plan's printout: `[Worker] update`, `[Worker/COUNTER] unbind`, colours and the
 * Effect log prefix and all. Unchanged resources (noop) and the summary line are left out.
 */
export function planRows(out: string): PlanRow[] {
  const rows: PlanRow[] = [];
  // A hosted run is in a Worker: no Bun.stripANSI.
  for (const line of out.replace(/\x1b\[[0-9;]*m/g, "").split("\n")) {
    const m = [...line.matchAll(/\[([^\]\s]+)\]\s+(create|update|adopted|replace|delete|orphaned|unbind)\b/g)].pop();
    const action = m && check(PlanAction, m[2]);
    if (m && action && !rows.some((r) => r.id === m[1])) rows.push({ id: m[1]!, action });
  }
  return rows;
}

/** How a doctor's preview went, kept for the doctor to ask about: `out`, the end of the step that failed. */
export interface PreviewResult { id: string; stage: string; ok: boolean; url?: string; failed?: string; note?: string; out?: string }
/** What POST /preview answers: the result, the run it's waiting on, or why it can't go now. */
export type PreviewAnswer = { result: PreviewResult } | { running: Run } | { busy: string };
const PreviewSeen = obj({
  busy: opt(text()),
  running: opt(obj({ id: str(), stage: str() })),
  result: opt(obj({ id: str(), stage: str(), ok: bool(), url: opt(text(4096)), failed: opt(text()), note: opt(text()), out: opt(text()) })),
});
/** A preview answer read back over the wire (the dependency doctor asks the deploy container): the parts it uses, checked. */
export const previewAnswer: Guard<{ result: PreviewResult } | { running: Pick<Run, "id" | "stage"> } | { busy: string }> = (v) => {
  const o = PreviewSeen(v);
  if (o.busy !== undefined) return { busy: o.busy };
  if (o.running) return { running: o.running };
  if (o.result) return { result: o.result };
  throw new Bad("a preview answer: result, running or busy");
};

/** Run a command, streaming its output; resolves to the exit code. `env`, when given, is all it sees (a check's scrubbed one); else the process's, with CI=1. */
export type Exec = (cmd: string[], cwd: string, out: (s: string) => void, env?: Record<string, string>) => Promise<number>;
/**
 * Where a run's commands go. `workdir`: a fresh directory the runner owns and cleans up (a deploy container's), used in place of a temp dir here.
 * `state`: for a runner whose machine forgets, put the app's Alchemy state back before deploy and keep it after, so the next deploy updates the same stack.
 */
export interface Runner {
  exec: Exec; fetch: (url: string) => Promise<{ status: number }>; workdir?: string;
  /** Write files (paths under `cwd`) on a machine this process can't reach: a container's POST /files. */
  write?: (cwd: string, files: Record<string, string>) => Promise<void>;
  state?: { restore(app: string): Promise<void>; keep(app: string): Promise<void> };
  /**
   * The Linux arches this machine can compile a box's native/ crates for; unset for any (the desktop:
   * Docker, or it says to start it). A hosted deploy container has cargo and no Docker, so only
   * linux-x64: a box whose crates need another arch is refused up front.
   */
  nativeArches?: string[];
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

export const spawnExec = (timeoutMs = 15 * 60_000): Exec => async (cmd, cwd, out, env) => {
  const p = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe", timeout: timeoutMs, env: env ?? { ...process.env, CI: "1" } });
  const pump = async (s: ReadableStream<Uint8Array>) => { const d = new TextDecoder(); for await (const c of s) out(d.decode(c, { stream: true })); };
  await Promise.all([pump(p.stdout), pump(p.stderr)]);
  return await p.exited;
};

export const runnerFor = (env: Env): Runner | null => {
  const fake = env.PREVIEW_RUNNER as Runner | undefined;
  if (fake) return fake;
  return typeof Bun !== "undefined" && !env.BETTER_AUTH_SECRET ? { exec: spawnExec(), fetch: (u) => fetch(u, { redirect: "manual" }) } : null;
};

/** One run per repo, in this process: the desktop app is one process. The dependency doctor's previews show here too. */
export const runs = new Map<string, Run>();

// ---- the log: deploys and previews alike, in D1's `deploys` table ------------

/** `destroy` is a stage's teardown: logged and pruned with the deploys, not the previews. */
export type Trigger = "button" | "commit" | "preview" | "destroy";

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
 * ran is already in the log, and isn't one that died. Nor is one logged after the live run began:
 * it's logged a moment before it's handed the live slot (a deploy queued behind the last one).
 */
export async function history(env: Env, owner: string, repo: string, previews: boolean, live: () => Run | null | Promise<Run | null>) {
  const { results } = await env.DB.prepare(`SELECT id, stage, by, trigger, status, commit_hash, url, at, ms, note, out, runner, key_last4 FROM deploys
    WHERE owner = ? AND repo = ? AND trigger ${previews ? "= 'preview'" : "!= 'preview'"} ORDER BY at DESC LIMIT 20`).bind(owner, repo).all<any>();
  const run = await live();
  const died = (d: any) => d.status === "running" && run?.id !== d.id && !(run && d.at > run.at);
  return { run, history: results.map((d) => died(d) ? { ...d, status: "interrupted" } : d) };
}

/** The deployed URL from Alchemy's printed outputs: `url: "https://..."`, else the last workers.dev or railway one. */
export function urlIn(out: string): string | undefined {
  const named = [...out.matchAll(/\b(?:url|box)\s*:\s*["']?(https?:\/\/[^\s"',}]+)/g)].pop();
  if (named) return named[1];
  return [...out.matchAll(/https:\/\/[^\s"',}]+\.(?:workers\.dev|up\.railway\.app)[^\s"',}]*/g)].pop()?.[0];
}

/**
 * A deploy the CLI's guard refused, said in the panel's words: what it would have hurt and which box
 * to tick if that's meant. Null when the output holds no refusal this knows.
 */
export function refusalNote(out: string): string | null {
  const gone = /would delete (.+?), and the data in/.exec(out)?.[1];
  if (gone) return `stopped: this deploy would delete ${gone}, with its data. If you mean that, tick Allow deletes and deploy again; if not, put it back in rustybuns.config.ts (or rebase a branch that lacks it).`;
  if (/is a REAL environment and this destroy deletes/.test(out)) return "stopped: the CLI counts this stage as Real, so tearing it down deletes its data. If you mean that, mark it Real in the deploy settings and type its name to tear it down.";
  if (/behind origin\/main, and this is a live site/.test(out)) return "stopped: this commit is behind main on a live site, so deploying it would roll back what main shipped since. Deploy main's tip, or tick Force if the rollback is meant.";
  return null;
}

const LOGIN_HINT = /unauthori[sz]ed|authentication|not logged in|no credentials|api token|CLOUDFLARE_API_TOKEN|RAILWAY_TOKEN|HCLOUD_TOKEN|profile/i;

/**
 * A run that couldn't sign in, said as what to do on this machine. The CLI reaches a wrangler login whether or
 * not the app installs wrangler (#3632), so "no wrangler" here means this machine has no wrangler login at all.
 * Null when the output isn't a login failure.
 */
export function loginNote(out: string): string | null {
  if (/no wrangler in this project or on PATH/.test(out) && /no Cloudflare credentials/i.test(out))
    return "this machine has no Cloudflare login a deploy can use: run `wrangler login` or `rustybuns login cloudflare` once, then deploy again";
  // Only the lines that report the failure: every Alchemy run prints "...instead of the profile" and the CLI's "profile: deploy".
  const failed = out.split("\n").filter((l) => /✗|\berror\b|unauthori[sz]ed/i.test(l)).join("\n");
  return LOGIN_HINT.test(failed) ? "this machine isn't logged in: run `rustybuns login cloudflare` (or railway, hetzner)" : null;
}

/**
 * The config read, run with the repo's own install so it is what deploy will see:
 * `RB {adopt, edge, box, native}`. `native` is set when a Hetzner box would have
 * to compile native/ crates: `rustybuns build box` builds a cax (arm64) box's in
 * Docker every time, and an x86 one's with the local cargo when
 * native/dist/<crate>/linux-x64/ isn't there (on Linux x64; elsewhere in Docker). It mirrors the CLI's
 * shippingCrates(): desktop.native names them, or every crate under
 * native/crates without `[package.metadata.rustybuns] desktop = false`.
 * Railway boxes build theirs in Railway's own image, so they need nothing here.
 */
export const CONFIG_READ = `const c = (await import("./rustybuns.config.ts")).default;
const fs = await import("node:fs"), b = c.targets?.box, n = c.targets?.desktop?.native;
let native = null;
if (b && b.provider !== "railway" && n !== false && fs.existsSync("native/Cargo.toml")) {
  const ships = (x) => { const t = "native/crates/" + x + "/Cargo.toml"; return !fs.existsSync(t) || Bun.TOML.parse(fs.readFileSync(t, "utf8"))?.package?.metadata?.rustybuns?.desktop !== false; };
  const all = n?.length ? n : fs.existsSync("native/crates") ? fs.readdirSync("native/crates", { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).filter(ships) : [];
  const arch = /^cax/i.test(b.serverType ?? "") ? "linux-arm64" : "linux-x64";
  const crates = arch === "linux-arm64" ? all : all.filter((x) => !fs.existsSync("native/dist/" + x + "/" + arch));
  if (crates.length) native = { arch, crates };
}
console.log("RB " + JSON.stringify({ adopt: !!c.targets?.edge?.adopt, edge: !!c.targets?.edge, box: !!b, native }));`;

/**
 * Clone, install, deploy and check `run.stage`; then destroy it, unless this is
 * a real deploy (`keep`, see deploy.ts), whose run has no destroy step. A real
 * deploy may take over live resources (`adopt`) when the owner said so. With
 * `expect`, the clone has to be that commit (the one a hosted deploy checked,
 * deploy-review.ts), or nothing after it runs. `files` (repo paths) are laid
 * over the clone first: the dependency doctor's branch, not yet pushed (deps.ts).
 *
 * `only` runs one command against the stage's kept Alchemy state in place of deploy, check and destroy
 * (deploy.ts): "plan" (`rustybuns plan --stage X`, its rows in `run.plan`; the state isn't kept after)
 * or "destroy" (tear the stage down, `--real` when `allowAdopt` says the owner marked it Real).
 */
export async function preview(runner: Runner, remote: string, run: Run, opts: { keep?: boolean; allowAdopt?: boolean; allowDelete?: boolean; force?: boolean; dir?: string; expect?: string; files?: Record<string, string>; only?: "plan" | "destroy" } = {}) {
  const fs = runner.workdir ? null : await import("node:fs");
  const dir = runner.workdir ?? fs!.mkdtempSync((await import("node:path")).join((await import("node:os")).tmpdir(), "codesplitter-preview-"));
  const app = opts.dir ? `${dir}/repo/${opts.dir}` : `${dir}/repo`;
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
    if (opts.expect && run.commit !== opts.expect) {
      step("clone").status = "failed";
      run.note = `main moved to ${run.commit?.slice(0, 7) ?? "?"} after ${opts.expect.slice(0, 7)} was checked: deploy again`;
      return skip("install", "deploy", "check", "destroy");
    }
    if (opts.files) {
      const c = step("clone"), paths = Object.keys(opts.files);
      // A runner with a workdir of its own is a container: it writes through `write`, or not at all.
      const outside = paths.find((p) => p.split("/").some((x) => x === ".." || x === "" || x === "."));
      const bad = !fs && !runner.write ? "this runner can't lay files over its clone" : outside ? `${outside} is outside the repo` : null;
      if (bad) { c.status = "failed"; c.out += bad + "\n"; return skip("install", "deploy", "check", "destroy"); }
      if (!fs) {
        const wrote = await runner.write!(`${dir}/repo`, opts.files).then(() => null, (e: Error) => e.message);
        if (wrote) { c.status = "failed"; c.out += `laying the changed files over the clone: ${wrote}\n`; return skip("install", "deploy", "check", "destroy"); }
      } else {
        const { dirname, join } = await import("node:path");
        for (const p of paths) { fs.mkdirSync(dirname(join(dir, "repo", p)), { recursive: true }); fs.writeFileSync(join(dir, "repo", p), opts.files[p]!); }
      }
      c.out += `laid ${paths.length} changed file${paths.length === 1 ? "" : "s"} over the clone: ${paths.join(", ")}\n`;
    }
    // A folder that isn't there says so, rather than failing to start bun in it.
    const has = opts.dir ? [{ cmd: ["test", "-d", opts.dir], cwd: `${dir}/repo` }] : [];
    if (!(await go("install", [...has, { cmd: ["bun", "install"], cwd: app }, { cmd: ["bun", "-e", CONFIG_READ], cwd: app }]))) {
      const where = opts.dir ? `${opts.dir} in this repo` : "this repo";
      if (opts.dir && !step("install").out.includes("bun install")) run.note = `this repo has no folder ${opts.dir}: fix the folder in the deploy settings`;
      else if (/rustybuns\.config\.ts/.test(step("install").out)) run.note = `${where} has no rustybuns.config.ts: run \`rustybuns init\` in it first`;
      return skip("deploy", "check", "destroy");
    }
    const cfg = JSON.parse(/RB (\{.*\})/.exec(step("install").out)?.[1] ?? "{}");
    if (!cfg.edge && !cfg.box) { run.note = "no edge or box target to deploy to"; return skip("deploy", "check", "destroy"); }
    if (opts.only) {
      // A plan changes nothing, so adopt can't hurt it; a teardown of an adopting stack is the owner's Real call.
      const k = opts.only;
      if (k === "destroy" && cfg.adopt && !opts.allowAdopt) {
        step(k).status = "failed";
        step(k).out = "refused: targets.edge.adopt is on, so tearing this stage down deletes the live Worker and its data under their real names.\nIf that is meant, mark the stage Real in the deploy settings and type its name.\n";
        return;
      }
      const real = k === "destroy" && opts.allowAdopt ? ["--real"] : [];
      await runner.state?.restore(app);
      const ok = await go(k, [{ cmd: ["bun", "x", "rustybuns", k, ...(k === "destroy" ? ["--yes"] : []), "--stage", run.stage, ...real], cwd: app }]);
      if (k === "plan") run.plan = planRows(step(k).out);
      else await runner.state?.keep(app).catch((e: Error) => { step(k).out += `\ncouldn't keep the Alchemy state: ${e.message}\n`; });
      if (!ok) run.note = refusalNote(step(k).out) ?? loginNote(step(k).out) ?? run.note;
      else if (k === "destroy") run.note = `${run.stage} is torn down`;
      return;
    }
    if (cfg.adopt && !opts.allowAdopt) {
      const d = step("deploy");
      d.status = "failed";
      d.out = opts.keep
        ? "refused: targets.edge.adopt is on, so this deploy would take over the live Worker and its data under their real names.\nIf this repo is production, say so in the deploy settings: set its environment to Real (CLI: --real).\n"
        : "refused: targets.edge.adopt is on, so this stack would take over the live Worker and its data under their real names, and destroy would delete them.\nTurn adopt off on a branch to preview it.\n";
      return skip("check", "destroy");
    }
    if (cfg.native && runner.nativeArches && !runner.nativeArches.includes(cfg.native.arch)) {
      const { arch, crates } = cfg.native as { arch: string; crates: string[] };
      step("deploy").status = "failed";
      step("deploy").out = `refused: targets.box would compile native/ crates (${crates.join(", ")}) for ${arch}, and the hosted deploy container builds them for ${runner.nativeArches.join(", ")} only (it has no Docker).\n`
        + `Commit their native/dist/<crate>/${arch}/ builds, pick an x86 server type, or deploy this one from the desktop app.\n`;
      run.note = "this box's Rust crates need building: deploy it from the desktop app";
      return skip("check", "destroy");
    }
    deployed = true;   // from here a half-made stack may exist, so destroy always runs
    // An adopting stack the owner marked Real is told so (--real): the CLI asks at a terminal otherwise, and a run here has none, so it refused every first deploy.
    const real = cfg.adopt && opts.allowAdopt && opts.keep ? ["--real"] : [];
    const rb = (sub: string) => ({ cmd: ["bun", "x", "rustybuns", sub, "--yes", "--stage", run.stage, ...(sub === "deploy" ? [...real, ...(opts.allowDelete ? ["--allow-delete"] : []), ...(opts.force ? ["--force"] : [])] : [])], cwd: app });
    await runner.state?.restore(app);
    const ok = await go("deploy", [rb("deploy")]);
    // Kept even when the deploy failed: a half-made stack is in it too.
    await runner.state?.keep(app).catch((e: Error) => { step("deploy").out += `\ncouldn't keep the Alchemy state: ${e.message}\n`; });
    run.url = urlIn(step("deploy").out);
    const login = ok ? null : loginNote(step("deploy").out);
    if (!ok) run.note = refusalNote(step("deploy").out) ?? login ?? run.note;
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
      // Not signed in, the deploy made nothing and the destroy fails the same way: the login is what to fix.
      const finish = `the clone and its Alchemy state are kept in ${app}. Finish with: cd ${app} && bun x rustybuns destroy --yes --stage ${run.stage}`;
      run.note = login ? `${login}. ${finish[0]!.toUpperCase()}${finish.slice(1)}` : `destroy failed; ${finish}`;
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
  if (!(await repoRow(env, owner, repo, "1"))) return json({ error: "not found" }, 404);
  const runner = runnerFor(env);
  if (req.method === "GET") {
    // On the site, the dependency doctor's previews run in the repo's deploy container (deploy-runner.ts).
    const live = async () => runs.get(key) ?? (!runner && env.DEPLOY_RUNNER
      ? ((await (await env.DEPLOY_RUNNER.get(env.DEPLOY_RUNNER.idFromName(key)).fetch(new Request("http://deploy/preview"))).json()) as { run: Run | null }).run : null);
    return json({ can_run: !!runner, ...(await history(env, owner, repo, true, live)) });
  }
  if (req.method !== "POST") return null;
  if (!runner) return json({ error: "preview deploys run on the desktop app, with your own logins" }, 400);
  if (runs.get(key) && !runs.get(key)!.done) return json({ error: "a preview is already running" }, 409);
  // The crew's remote when there is one: a preview builds the real private lines.
  const h = await handleFor(env, owner, repo, true);
  const art = h && await artifactAccess(h.handle, h.remote, "read", 3600);
  if (!art) return json({ error: "this repo has no git remote yet: commit its files first" }, 400);
  const remote = art.remote.replace("://", `://x:${art.token.split("?")[0]}@`);
  // Main's code runs here with this machine's logins, as a deploy's does: commits that aren't the owner's own wait for their approval
  // (deploy-review.ts). The review reads the same crew remote the clone comes from, so the clone has to be the tip it cleared:
  // a crew commit landing in between fails the clone rather than running unread.
  const checked = await review(env, owner, repo);
  if (!isCleared(checked)) return json({ error: waitingNote(checked), review: { tip: checked.tip, commits: checked.commits, more: checked.more } }, 409);
  const { dir } = await settings(env, owner, repo);
  const id = crypto.randomUUID().slice(0, 8);
  const run: Run = { id, at: Date.now(), stage: `preview-${id}`, steps: STEPS.map((key) => ({ key, status: "waiting", out: "" })), done: false };
  runs.set(key, run);
  await logStart(env, owner, repo, run, user, "preview");
  void preview(runner, remote, run, { dir, ...(checked.tip ? { expect: checked.tip } : {}) })
    .catch((e: Error) => { run.note = `failed: ${e.message}`; run.done = true; })
    .then(() => logEnd(env, run));
  return json({ run }, 202);
}
