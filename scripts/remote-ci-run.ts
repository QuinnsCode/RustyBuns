// One builder run, scoped (#5736): wait for Bob and a slot, send the tree, run the suites, give the slot back.
// Everything the run holds is given back as its scope closes, whatever closes it (the run's end, a lost Bob, a
// SIGINT, SIGTERM or SIGHUP through runScoped): the heartbeat stops, every ssh and the push are killed, the push lock
// goes, then the slot. Loaded with a dynamic import from remote-ci.ts's `main`: build scripts import remote-ci.ts for
// `offload` under filtered CI installs, and `effect` lives in packages/cli only.
import { Cause, Data, Effect, Exit, Schedule, Stopped, runScoped, type Scope } from "../packages/cli/src/lifecycle.ts";
import { recordVerdict, type Tier } from "./ci-tier.ts";
import {
  claim, CUT, CUT_PCT, fallback, HEARTBEAT_MS, jobScript, LOG, LOST, NOT_RUN, outcome, plan, PUSH_MS, pushLock, q,
  recordPass, release, remote, SERVING, snapshot, stream, teed, type Builder, type RunRecord, type Valve,
} from "./remote-ci.ts";

/** Bob went away under the run (an ssh dropped, or the push to his slot failed or hung): wait for him, start over. */
export class Lost extends Data.TaggedError("Lost")<{ why: string }> {}
/** His battery stopped the run: wait, start over. */
export class Cut extends Data.TaggedError("Cut")<{}> {}

export type Job = { label: string; dir: string; cmd: string };
export type Run = {
  b: Builder; host: string; v: Valve; at?: string; wait?: boolean; all: boolean; tier?: Tier; who: string; branch: string;
  argv: string[]; cwd: string; jobs: Job[]; rec: RunRecord;
};

// A process for the life of the scope: closing it first (a signal, a timeout) kills it and waits for it.
const killed = (p: { exitCode: number | null; kill(): void; exited: Promise<number> }) =>
  Effect.promise(async () => { if (p.exitCode === null) { p.kill(); await p.exited; } });

/** An ssh shell on the builder for the life of the scope: its code and output. */
export const ssh = (b: Builder, script: string, label: string, quiet = false) =>
  Effect.scoped(Effect.acquireRelease(Effect.sync(() => remote(b, script)), killed)
    .pipe(Effect.flatMap((p) => Effect.promise(() => stream(p, label, quiet)))));

/** One quick round trip, given up after 10 s: true only while Bob is serving. */
const reachable = (b: Builder) => ssh(b, `[ -n "$(find ${SERVING} -mmin -2 2>/dev/null)" ]`, "serving", true)
  .pipe(Effect.map((r) => r.code === 0), Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => Effect.succeed(false) }));

/** Push `sha` to the slot's own repo (one push at a time from this Mac), given up after PUSH_MS. */
const push = (b: Builder, slot: string, sha: string, ref: string, cwd: string) => Effect.scoped(Effect.gen(function* () {
  yield* Effect.acquireRelease(Effect.promise(() => pushLock()), (unlock) => Effect.sync(unlock));
  const git = yield* Effect.acquireRelease(Effect.sync(() => Bun.spawn(["nice", "git", "push", "-q", `${b.host}:${b.dir}/${slot}`, `+${sha}:${ref}`], {
    cwd, stdout: "inherit", stderr: "inherit", env: { ...process.env, GIT_SSH_COMMAND: b.ssh.join(" ") },
  })), killed);
  return yield* Effect.promise(() => git.exited);
})).pipe(
  Effect.timeoutOrElse({ duration: PUSH_MS, orElse: () => Effect.sync(() => { console.error(`the push to ${slot} hung for ${PUSH_MS / 60_000} minutes; giving up`); return 1; }) }),
  Effect.flatMap((code) => code ? Effect.fail(new Lost({ why: "the push to his slot failed or hung" })) : Effect.void),
);

// Send the commit straight to the slot's own repo, then check it out on top of its warm node_modules.
// The ref is the slot's scratch: one a run left behind (it failed before its checkout) is overwritten, not a reason to refuse.
// After the checkout the commit stays at refs/remote-ci/base, so the next push packs only what is new since this run
// (a few KB). Without it the slot showed only its setup-day refs, and every push packed 200 MB of history again.
/** The setup's exit code; Lost when the push failed or hung. */
export const load = (b: Builder, slot: string, sha: string, cwd: string) => Effect.gen(function* () {
  const ref = `refs/remote-ci/${slot}`;
  yield* push(b, slot, sha, ref, cwd);
  return (yield* ssh(b, LOG(slot) + teed(`cd ${q(slot)} && git checkout -q -f --detach ${sha} && git update-ref refs/remote-ci/base ${sha} `
    + `&& git update-ref -d ${ref} && git clean -fdq && bun install --frozen-lockfile --silent`), "setup")).code;
});

// A code that means Bob, not the branch: the run is neither passed nor failed.
const gone = (code: number) => code === LOST ? Effect.fail(new Lost({ why: "lost Bob mid-run" })) : code === CUT ? Effect.fail(new Cut()) : Effect.void;

/** The run in a held slot: the heartbeat, the tree sent, the suites `cap` at a time. The worst code. */
const runIn = (r: Run, slot: string, cap: number): Effect.Effect<number, Lost | Cut, Scope.Scope> => Effect.gen(function* () {
  // while this run holds the slot its lock stays fresh, so only a dead run's lock goes stale; only a lock that is
  // still there is touched (a touch after release once left a file where the lock was)
  yield* Effect.forkScoped(ssh(r.b, `[ -d locks/${q(slot)} ] && touch locks/${q(slot)}`, "beat", true)
    .pipe(Effect.timeout(HEARTBEAT_MS), Effect.ignore, Effect.delay(HEARTBEAT_MS), Effect.repeat(Schedule.forever)));
  const sent = r.at ?? (yield* Effect.promise(() => snapshot(r.cwd)));
  const setup = yield* load(r.b, slot, sent, r.cwd);
  yield* gone(setup);
  if (setup) return setup;
  console.log(`running ${r.jobs.map((j) => j.label).join(", ")} on ${r.host} (${slot}), ${cap} at a time`);
  const t0 = performance.now();
  const codes = yield* Effect.forEach(r.jobs, (j) => ssh(r.b, jobScript(slot, j.dir, j.cmd), j.label).pipe(Effect.map((x) => x.code)), { concurrency: cap });
  yield* gone(codes.includes(CUT) ? CUT : codes.includes(LOST) ? LOST : 0);
  const worst = Math.max(0, ...codes);
  console.log(`${outcome(worst)} in ${((performance.now() - t0) / 1000).toFixed(1)}s on ${r.host}`);
  yield* Effect.promise(() => writeDown(r, worst, sent));
  return worst;
});

// Every base-ref run, targeted or whole, is what the trust dial learns from; a one-off `run` isn't the branch's test.
// A pass of `all` on a committed HEAD is written down as ready to merge (uncommitted changes aren't what the PR would merge).
async function writeDown(r: Run, worst: number, sent: string) {
  if (r.tier !== undefined && !r.at) await recordVerdict({ who: r.who, tier: r.tier, passed: !worst, at: Date.now() }).catch(() => {});
  if (!r.all || worst) return;
  const head = (await Bun.$`git rev-parse HEAD`.cwd(r.cwd).quiet().text()).trim();
  if (sent !== head) return console.log("not written down as ready: the working tree has uncommitted changes");
  const named = r.branch && r.branch !== "HEAD" ? r.branch
    : (await Bun.$`git branch -a --points-at HEAD ${"--format=%(refname:short)"}`.cwd(r.cwd).quiet().nothrow().text()).split("\n").find((x) => x && !x.startsWith("(")) ?? r.who;
  await recordPass({ sha: head, branch: named.replace(/^origin\//, ""), base: r.argv[0]!, at: Date.now(), jobs: r.jobs.map((j) => j.label) });
  console.log(`${head.slice(0, 8)} ${named} written down as ready: bun run builder passed`);
}

// Give the slot back as the scope closes. A run that ended writes its record; a slot handed back unrun, or one Bob
// lost or cut off under it, just goes; a signal reads 130. Bob gone, this may not reach him either (a lock untouched
// for STALE_MIN is taken back anyway).
const giveBack = (r: Run, slot: string, exit: Exit.Exit<unknown, unknown>, code: number | undefined) => {
  const failed = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
  const ended = Exit.isSuccess(exit) ? code : Cause.hasInterrupts(exit.cause) ? 130 : failed instanceof Lost || failed instanceof Cut ? undefined : 1;
  return Effect.promise(() => release(r.b, slot, ended === undefined ? undefined : { ...r.rec, ended: Date.now(), code: ended }).catch(() => {}));
};

/** One try: ask Bob for a slot and, given one, run in it. The code, or why it has to wait (or go elsewhere). */
const tryOnce = (r: Run, cap: number) => Effect.scoped(Effect.gen(function* () {
  let ran: number | undefined;
  // he can go between the check and the claim: that is waiting, not a failure
  const got = yield* Effect.acquireRelease(
    reachable(r.b).pipe(Effect.flatMap((up) => up
      ? Effect.promise(() => claim(r.b, { ...r.rec, started: (r.rec.started = Date.now()) }).catch(() => undefined))
      : Effect.succeed(undefined))),
    (got, exit) => got ? giveBack(r, got.slot, exit, ran) : Effect.void,
  );
  const p = plan(r.v, !!got, got?.batt ?? { onPower: true, pct: 100 }, cap);
  if (p.where !== "bob" || !got) return { wait: p };
  if (p.why) console.log(p.why);
  const code = yield* runIn(r, got.slot, p.cap);
  ran = code;
  return { code };
}));

/** Wait for Bob and a slot, then run: the run's code. Fails Lost or Cut when he went away under it. */
const attempt = (r: Run): Effect.Effect<number, Lost | Cut> => Effect.gen(function* () {
  const poll = Number(process.env.BUILDER_POLL_MS ?? 30_000), cap = Number(process.env.BUILDER_WORKERS ?? 4);
  for (let said = ""; ; ) {
    const t = yield* tryOnce(r, cap);
    if (!t.wait) return t.code;
    const why = t.wait.why ?? "off";
    if (r.at) { console.error(`the builder can't take a run now (${why})`); return NOT_RUN; }
    if (t.wait.where === "here") return yield* Effect.promise(() => fallback(r.argv, r.cwd, why));
    // Without --wait, a shut valve and no Bob is one line and out, not a wait nobody knows how long is (#5839):
    // push and let GitHub CI run it, or ask again with --wait once he serves.
    if (!r.wait) { console.error(`${why}: not waiting, nothing ran (push and let CI run it, or \`bun run builder --wait ...\`)`); return NOT_RUN; }
    if (said !== why) console.log((said = why));
    // the session that started this wait is gone (it was a background task): nobody reads the answer, so stop waiting
    // rather than poll for Bob for days under pid 1 (2026-11-23, leftovers that held the office to three workers)
    if (process.ppid === 1) { console.error("the session that asked for this run is gone: not waiting for the builder"); return NOT_RUN; }
    yield* Effect.sleep(poll);
  }
});

const goneWhy = (e: Lost | Cut) => e instanceof Cut ? `cut off: Bob's battery fell to ${CUT_PCT}%` : e.why;

/** The run, retried from the start each time Bob goes away under it (a run at a commit answers NOT_RUN instead).
 *  A signal gives everything back and answers 128 + its number. */
export async function run(r: Run): Promise<number> {
  const retried = attempt(r).pipe(
    Effect.retry({ while: (e) => !r.at && (console.log(`${goneWhy(e)}: waiting for him again, then running it from the start`), true) }),
    Effect.catchTags({ Lost: (e) => notRun(e), Cut: (e) => notRun(e) }),
  );
  try {
    return await runScoped(retried);
  } catch (e) {
    if (!(e instanceof Stopped)) throw e;
    console.error(`stopped by ${e.signal}: the builder slot was given back`);
    return e.exitCode;
  }
}
const notRun = (e: Lost | Cut) => Effect.sync(() => { console.error(goneWhy(e)); return NOT_RUN; });
