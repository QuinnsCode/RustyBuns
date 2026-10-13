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
  const cpu0 = process.cpuUsage(), rss0 = process.memoryUsage.rss();
  const res = await run();
  // A 101 hands a live socket to the shell; it isn't the request's to refuse.
  if (res.status === 101) return res;
  const grewMb = (process.memoryUsage.rss() - rss0) / 2 ** 20;
  const memMb = limits.memoryMb ?? EDGE_MEMORY_MB;
  if (grewMb > memMb) return exceeded(`memory grew ${Math.round(grewMb)} MB, over the isolate's ${memMb} MB`);
  if (limits.cpuMs !== undefined) {
    const used = process.cpuUsage(cpu0), ms = (used.user + used.system) / 1000;
    if (ms > limits.cpuMs) return exceeded(`used ${Math.round(ms)} ms of CPU, over cpuMs ${limits.cpuMs}`);
  }
  return res;
}

const exceeded = (why: string) => {
  console.warn(`[edge-limits] request refused: ${why}`);
  return new Response(`Error 1102: Worker exceeded resource limits (${why})`, { status: 503 });
};
