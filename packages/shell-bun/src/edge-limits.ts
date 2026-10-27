// The edge's per-request memory and CPU limits, on a host that runs the Worker in its own Bun
// process (#894). There's no isolate to cap, so this measures the request instead: the process's
// CPU time and RSS growth from the moment fetch() starts until it settles. Over either, the
// response the Worker made is thrown away and the client gets the 503 the edge sends when it
// kills a request. The edge stops it mid-flight; here it runs to the end first, so its side
// effects (a D1 write, a queue send) still happen.
//
// Both are process-wide, so another request running alongside counts too, and RSS only grows the
// first time: pages a big request freed are reused by the next one without growing it again.
// Good enough to catch a request that would blow up on the edge, not a meter.

// Taken once, at import, before any app code runs: a bundle built with nodejs_compat swaps
// globalThis.process for unenv's, whose cpuUsage and memoryUsage.rss throw "not implemented".
const cpuUsage = process.cpuUsage.bind(process);
const rss = process.memoryUsage.rss.bind(process.memoryUsage);

/** An isolate's memory on the edge, every plan. */
export const EDGE_MEMORY_MB = 128;

export interface EdgeLimits {
  /** CPU ms a request may use: `worker.cpuMs`, or RB_CPU_MS at run time. Unset is no cap. */
  cpuMs?: number;
  /** @default EDGE_MEMORY_MB */
  memoryMb?: number;
}

/** The limits a generated host runs with: RB_CPU_MS (say 10, the Free plan's) wins over the config's cpuMs. */
export function edgeLimits(cpuMs?: number, env: Record<string, string | undefined> = process.env): EdgeLimits {
  const fromEnv = Number(env.RB_CPU_MS);
  return { cpuMs: fromEnv > 0 ? fromEnv : cpuMs };
}

/** Run one request's fetch() under the edge's limits. */
export async function capped(limits: EdgeLimits, run: () => Response | Promise<Response>): Promise<Response> {
  const cpu0 = cpuUsage(), rss0 = rss();
  const res = await run();
  // A 101 hands a live socket to the shell; it isn't the request's to refuse.
  if (res.status === 101) return res;
  const grewMb = (rss() - rss0) / 2 ** 20;
  const memMb = limits.memoryMb ?? EDGE_MEMORY_MB;
  if (grewMb > memMb) return exceeded(`memory grew ${Math.round(grewMb)} MB, over the isolate's ${memMb} MB`);
  if (limits.cpuMs !== undefined) {
    const used = cpuUsage(cpu0), ms = (used.user + used.system) / 1000;
    if (ms > limits.cpuMs) return exceeded(`used ${Math.round(ms)} ms of CPU, over cpuMs ${limits.cpuMs}`);
  }
  return res;
}

const exceeded = (why: string) => {
  console.warn(`[edge-limits] request refused: ${why}`);
  return new Response(`Error 1102: Worker exceeded resource limits (${why})`, { status: 503 });
};

/** The edge's idle time before it evicts a Durable Object. */
export const EDGE_DO_IDLE_MS = 70_000;

/** Requests an isolate serves before the host starts a fresh one, when RB_EDGE_LIKE is on and RB_EDGE_RECYCLE doesn't say. */
export const EDGE_RECYCLE_REQUESTS = 100;

/**
 * RB_EDGE_LIKE: unset or 0 is off, 1 the edge's 70 s, any other number the idle seconds.
 * RB_EDGE_RECYCLE: requests before the host restarts so module globals reset (default 100, 0 never).
 */
export function edgeLike(env: Record<string, string | undefined> = process.env): { idleMs: number; recycleAfter: number } | undefined {
  const v = Number(env.RB_EDGE_LIKE);
  if (!(v > 0)) return undefined;
  const r = env.RB_EDGE_RECYCLE === undefined || env.RB_EDGE_RECYCLE === "" ? NaN : Number(env.RB_EDGE_RECYCLE);
  return { idleMs: v === 1 ? EDGE_DO_IDLE_MS : v * 1000, recycleAfter: r >= 0 ? Math.floor(r) : EDGE_RECYCLE_REQUESTS };
}

/** Wrap fetch so that after `every` requests have answered (0 is never), `restart` runs once. */
export function recycling<A extends unknown[]>(every: number, restart: () => void, fetch: (...a: A) => Response | Promise<Response>): (...a: A) => Promise<Response> {
  let n = 0;
  return async (...a) => {
    const res = await fetch(...a);
    if (every > 0 && ++n === every) setTimeout(restart, 0);
    return res;
  };
}

/**
 * Start this program again on the same address and token, then leave: a Worker bundled into one file
 * can't re-import its modules, so a new process is how its globals start over. DOs keep their state in
 * storage, so they come back as they do after an eviction.
 */
export function restartHost(shell: { hostname: string; port: number; server: { stop(force?: boolean): unknown } }, token?: string, graceMs = 500): void {
  const listen = `${shell.hostname}:${shell.port}`;   // before stop(): a stopped server reports port 0
  void shell.server.stop(false);   // releases the port now; open connections finish
  console.log(`[edge-like] module globals reset: restarting on ${listen}`);
  // A script run by bun is argv[1..]; a compiled binary has only its own flags after argv[1].
  const argv = /(^|[\\/])bun(\.exe)?$/.test(process.execPath) ? process.argv.slice(1) : process.argv.slice(2);
  const child = Bun.spawn([process.execPath, ...argv], {
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, RB_LISTEN: listen, PORT: String(shell.port), RB_NO_BROWSER: "1", ...(token ? { RB_TOKEN: token } : {}) },
  });
  child.unref();
  setTimeout(() => process.exit(0), graceMs);
}

/** Until the returned stop() runs, say each process.env key read (once): on the edge it is empty while the Worker loads. */
export function watchEnvAtImport(warn: (msg: string) => void = console.warn): () => void {
  const real = process.env, seen = new Set<string>();
  const proxy = new Proxy(real, { get(t, k, r) {
    if (typeof k === "string" && !seen.has(k)) { seen.add(k); warn(`[edge-like] process.env.${k} read at import: on the edge it is empty then; read it from env inside fetch()`); }
    return Reflect.get(t, k, r);
  } });
  try { Object.defineProperty(process, "env", { value: proxy, configurable: true, writable: true }); } catch { return () => {}; }
  return () => { Object.defineProperty(process, "env", { value: real, configurable: true, writable: true }); };
}
