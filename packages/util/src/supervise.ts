/**
 * Keep a child process running. When it exits on its own it is started again, after a wait that grows while it keeps
 * dying (1s, 2s, 4s… up to 30s) and starts over once a run lasted a minute. Stopping it is SIGTERM, then SIGKILL after
 * a grace. Plain Bun on purpose (EFFECT.md ruling 10): one timer and one child need no `effect`.
 *
 *   const office = supervise(["bun", "office/bin/agent-office.js"], { onExit: (code, _sig, wait) => log(code, wait) });
 *   office.start();
 *   await office.restart();   // SIGTERM, wait, start a fresh one with the wait back at 1s
 *   await office.stop();      // and no more restarts
 */
import type { Subprocess } from "bun";

/** How long to wait before starting again after `crashes` quick deaths in a row: `firstMs`, doubled each time, up to `maxMs`. */
export const backoff = (crashes: number, firstMs = 1000, maxMs = 30_000) => Math.min(maxMs, firstMs * 2 ** Math.max(0, crashes - 1));

export interface SuperviseOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** "inherit" (the default) shares this terminal; "pipe" hands everything the child prints to `onOutput`. */
  output?: "inherit" | "pipe";
  onOutput?: (chunk: Uint8Array) => void;
  /** Its own process group, so this process stopping (or a Ctrl+C here) leaves it running. */
  detached?: boolean;
  /** It exited on its own and starts again in `waitMs`. */
  onExit?: (code: number | null, signal: string | null, waitMs: number) => void;
  /** A run this long has stopped crash-looping, so the next wait starts over. */
  steadyMs?: number;
  firstMs?: number;
  maxMs?: number;
  /** How long it gets after SIGTERM before SIGKILL. */
  graceMs?: number;
}

export interface StopOptions {
  /** The signal to ask with; null sends nothing and just waits (a Ctrl+C already reached it). */
  signal?: NodeJS.Signals | null;
  /** SIGKILL it once the grace runs out (the default); false leaves it running and resolves false. */
  kill?: boolean;
  graceMs?: number;
}

export interface Supervisor {
  /** The running child, or null while it is down or waiting to start again. */
  readonly child: Subprocess | null;
  /** Start it now if it isn't running (cancelling a wait), and keep it running. */
  start(): Subprocess;
  /** Stop keeping it running and stop it: true once it has exited. */
  stop(opts?: StopOptions): Promise<boolean>;
  /** Stop it and start a fresh one, with the crash count back at zero. */
  restart(): Promise<Subprocess>;
}

const exitedWithin = (p: Subprocess, ms: number) => Promise.race([p.exited.then(() => true), Bun.sleep(ms).then(() => false)]);

/** Ask `p` to stop with `signal`, then SIGKILL after `graceMs`: true once it has exited. */
export async function stopProcess(p: Subprocess, { signal = "SIGTERM", kill = true, graceMs = 5000 }: StopOptions = {}) {
  if (p.exitCode !== null || p.signalCode !== null) return true;
  if (signal === null) return p.exited.then(() => true);
  p.kill(signal);
  if (await exitedWithin(p, graceMs)) return true;
  if (!kill) return false;
  p.kill("SIGKILL");
  await p.exited;
  return true;
}

export function supervise(cmd: string[], opts: SuperviseOptions = {}): Supervisor {
  const { steadyMs = 60_000, firstMs = 1000, maxMs = 30_000, graceMs = 5000 } = opts;
  const pipe = opts.output === "pipe";
  let child: Subprocess | null = null;
  let watching = false;
  let crashes = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const spawn = () => {
    const born = Date.now();
    const p = Bun.spawn(cmd, {
      cwd: opts.cwd, env: opts.env, detached: opts.detached,
      stdio: pipe ? ["ignore", "pipe", "pipe"] : ["inherit", "inherit", "inherit"],
    });
    child = p;
    if (pipe) for (const s of [p.stdout, p.stderr]) if (s instanceof ReadableStream) void drain(s, opts.onOutput);
    void p.exited.then(() => {
      if (child !== p) return;
      child = null;
      if (!watching) return;
      crashes = Date.now() - born > steadyMs ? 1 : crashes + 1;
      const wait = backoff(crashes, firstMs, maxMs);
      opts.onExit?.(p.exitCode, p.signalCode, wait);
      timer = setTimeout(() => { timer = undefined; if (watching && !child) spawn(); }, wait);
    });
    return p;
  };

  const stop = (o: StopOptions = {}) => {
    watching = false;
    clearTimeout(timer);
    timer = undefined;
    return child ? stopProcess(child, { graceMs, ...o }) : Promise.resolve(true);
  };

  return {
    get child() { return child; },
    start() {
      watching = true;
      clearTimeout(timer);
      timer = undefined;
      return child ?? spawn();
    },
    stop,
    async restart() {
      await stop();
      crashes = 0;
      return this.start();
    },
  };
}

async function drain(s: ReadableStream<Uint8Array>, on?: (chunk: Uint8Array) => void) {
  const r = s.getReader();
  for (let c = await r.read(); !c.done; c = await r.read()) on?.(c.value);
}
