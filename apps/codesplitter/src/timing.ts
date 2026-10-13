// Server-Timing on every /api answer (#1313): where a call's time went, in the browser's
// network panel. identify is who's asking (the session lookup), limit the rate-limit
// tally, app the rest (the route itself), total the whole call. On Workers the clock only
// moves across I/O, so these are the waits on D1, Durable Objects and fetches.

const marks = new WeakMap<Request, [string, number][]>();

/** Time `work` under `name` for this request's Server-Timing. */
export async function timed<T>(req: Request, name: string, work: () => Promise<T>): Promise<T> {
  const t = performance.now();
  try { return await work(); }
  finally {
    let m = marks.get(req);
    if (!m) marks.set(req, m = []);
    m.push([name, performance.now() - t]);
  }
}

/** The Server-Timing header for a request that started at `start`. */
export function serverTiming(req: Request, start: number) {
  const total = performance.now() - start, m = marks.get(req) ?? [];
  const app = Math.max(0, total - m.reduce((n, [, d]) => n + d, 0));
  return [...m, ["app", app] as const, ["total", total] as const].map(([k, d]) => `${k};dur=${d.toFixed(1)}`).join(", ");
}

/** `res` with its Server-Timing set; a socket's answer goes as it is. */
export function withTiming(req: Request, res: Response, start: number): Response {
  if (res.status === 101 || (res as { webSocket?: unknown }).webSocket) return res;
  const v = serverTiming(req, start);
  // A Response from a fetch or a Durable Object has immutable headers: copy it then.
  try { res.headers.set("server-timing", v); return res; }
  catch { const out = new Response(res.body, res); out.headers.set("server-timing", v); return out; }
}
