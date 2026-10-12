// plan, deploy and destroy hold things while they run: the shared state lock, and the alchemy
// (or worker build) process doing the work. Before this, a SIGTERM (an agent harness timing out,
// CI cancelling a job, `kill <pid>`) or a closed terminal ended rustybuns at once: alchemy went on
// deploying as an orphan, the lock was left behind naming a dead pid, and the next deploy took it
// and ran beside the orphan against the same state (bench/lifecycle.ts shows it).
//
// Here those signals interrupt the command instead, so its scope closes the way it does on
// success: each child is asked to stop as Ctrl-C would and gets a grace period to finish its write, and the lock goes last.
// A second Ctrl-C skips the wait. SIGKILL can't be caught, so the lock also records the child's
// pid, and lockState treats the lock as held while that child runs.
import type { Subprocess, SpawnOptions } from "bun";
import { Cause, Effect, Exit, Fiber, Schema, Scope } from "effect";

const SIGNALS = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 } as const;
type Signal = keyof typeof SIGNALS;

/** How long a child gets to exit after SIGTERM before SIGKILL. Alchemy writes state as it goes. */
export const GRACE_MS = Number(process.env.RUSTYBUNS_STOP_GRACE_MS) || 10_000;

/** The command was stopped by a signal, and everything it held was given back. */
export class Stopped extends Schema.TaggedError<Stopped>()("Stopped", { signal: Schema.String, exitCode: Schema.Number }) {
  override get message() { return `stopped by ${this.signal}; child processes stopped and the state lock released`; }
}

/**
 * Run `effect` with SIGINT, SIGTERM and SIGHUP interrupting it, then close its scope. Resolves with
 * its value, or rejects with its error (as thrown), or with `Stopped` when a signal ended it.
 */
export async function runScoped<A, E>(effect: Effect.Effect<A, E, Scope.Scope>): Promise<A> {
  const fiber = Effect.runFork(Effect.scoped(effect));
  let got: Signal | undefined;
  const handlers = (Object.keys(SIGNALS) as Signal[]).map((s) => {
    const h = () => {
      if (got) { console.error(`\n${s} again: not waiting any longer`); process.exit(128 + SIGNALS[s]); }
      got = stopping = s;
      console.error(`\n${s}: stopping (waiting up to ${GRACE_MS / 1000}s for child processes; Ctrl-C again to skip)`);
      Effect.runFork(Fiber.interrupt(fiber));
    };
    process.on(s, h);
    return [s, h] as const;
  });
  const exit = await Effect.runPromiseExit(Fiber.join(fiber));
  for (const [s, h] of handlers) process.off(s, h);
  if (Exit.isSuccess(exit)) return exit.value;
  if (got && Cause.hasInterrupts(exit.cause)) throw new Stopped({ signal: got, exitCode: 128 + SIGNALS[got] });
  throw Cause.squash(exit.cause);
}

/** A promise-returning step as an Effect that fails with whatever it threw, unwrapped. */
export const step = <A>(f: () => Promise<A> | A): Effect.Effect<A, unknown> =>
  Effect.tryPromise({ try: async () => f(), catch: (e) => e });

/** The signal that is stopping the command, for stopChild. */
let stopping: Signal | undefined;
const exitedWithin = (p: Subprocess, ms: number) => Promise.race([p.exited.then(() => true), Bun.sleep(ms).then(() => false)]);

/**
 * Ask a child to stop the way a terminal does (SIGINT: alchemy finishes its write and exits),
 * then SIGKILL after `GRACE_MS`. After a Ctrl-C the terminal already sent it SIGINT, so it gets
 * a second first to act on that one: a second SIGINT means "now" to many CLIs.
 */
async function stopChild(p: Subprocess, what: string) {
  if (p.exitCode !== null || p.signalCode !== null) return;
  if (!(stopping === "SIGINT" && (await exitedWithin(p, 1000)))) p.kill("SIGINT");
  if (await exitedWithin(p, GRACE_MS)) return;
  console.error(`${what} (pid ${p.pid}) didn't stop in ${GRACE_MS / 1000}s; killing it`);
  p.kill("SIGKILL");
  await p.exited;
}

/**
 * Spawn `cmd` for the life of the current scope and wait for its exit code. If the scope closes
 * first (an interrupt), the child is stopped and waited for before the scope's earlier
 * finalizers, like the lock, run. `onStart` gets its pid (lockState's noteChild).
 */
export const spawnScoped = (cmd: string[], opts: SpawnOptions.OptionsObject<"inherit", "inherit", "inherit">, onStart?: (pid: number) => void): Effect.Effect<number, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => { const p = Bun.spawn(cmd, opts); onStart?.(p.pid); return p; }),
    (p) => Effect.promise(() => stopChild(p, cmd[0]!.split("/").at(-1)!)),
  ).pipe(Effect.flatMap((p) => Effect.promise(() => p.exited)));
