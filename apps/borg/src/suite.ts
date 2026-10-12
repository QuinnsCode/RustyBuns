// The slim borg suite: every check, run from outside against one URL. The local test points
// it at the desktop host; `bun borg.ts <url>` points it at a deploy. Same checks, same verdicts.
import type { Verdict } from "./worker.ts";

export type Result = Verdict & { check: string; ms: number };
export interface Target {
  url: string;
  /** Sent on every request: the desktop host's token cookie, say. */
  headers?: Record<string, string>;
  /** How long a queued message may take to reach the consumer. The edge batches for a few seconds. */
  queueWaitMs?: number;
}

const get = async (t: Target, path: string): Promise<Verdict> => {
  const r = await fetch(t.url + path, { headers: t.headers });
  if (!r.ok) return { ok: false, detail: `HTTP ${r.status}` };
  return r.json() as Promise<Verdict>;
};

// One socket: the object accepts it, keeps an attachment, and echoes a message with it.
async function ws(t: Target): Promise<Verdict> {
  const n = crypto.randomUUID().slice(0, 8);
  const sock = new WebSocket(`${t.url.replace(/^http/, "ws")}/borg/ws?n=${n}`, { headers: t.headers } as any);
  return new Promise((resolve) => {
    const done = (v: Verdict) => { clearTimeout(timer); sock.close(); resolve(v); };
    const timer = setTimeout(() => done({ ok: false, detail: "no echo in 5s" }), 5000);
    sock.onopen = () => sock.send("ping");
    sock.onerror = () => done({ ok: false, detail: "socket error" });
    sock.onmessage = (m) => {
      const { echo, joined } = JSON.parse(String(m.data));
      done({ ok: echo === "ping" && joined === n, detail: `echo=${echo} attachment=${joined === n ? "kept" : joined}` });
    };
  });
}

async function queue(t: Target): Promise<Verdict> {
  const n = crypto.randomUUID().slice(0, 8);
  const sent = await get(t, `/borg/queue-send?n=${n}`);
  if (!sent.ok) return sent;
  const until = Date.now() + (t.queueWaitMs ?? 20_000);
  for (let v = await get(t, `/borg/queue-seen?n=${n}`); ; v = await get(t, `/borg/queue-seen?n=${n}`)) {
    if (v.ok || Date.now() > until) return v.ok ? v : { ok: false, detail: `not consumed in ${t.queueWaitMs ?? 20_000}ms` };
    await Bun.sleep(250);
  }
}

export const CHECKS: Record<string, (t: Target) => Promise<Verdict>> = {
  kv: (t) => get(t, "/borg/kv"),
  d1: (t) => get(t, "/borg/d1"),
  "d1-batch": (t) => get(t, "/borg/d1-batch"),
  r2: (t) => get(t, "/borg/r2"),
  do: (t) => get(t, "/borg/do"),
  ws,
  queue,
};

export async function runBorg(t: Target): Promise<Result[]> {
  const out: Result[] = [];
  for (const [check, run] of Object.entries(CHECKS)) {
    const t0 = performance.now();
    const v = await run(t).catch((e): Verdict => ({ ok: false, detail: `threw: ${e instanceof Error ? e.message : String(e)}` }));
    out.push({ check, ...v, ms: Math.round(performance.now() - t0) });
  }
  return out;
}

export const formatResults = (rs: Result[]) =>
  rs.map((r) => `${r.ok ? "✓" : "✗"} ${r.check.padEnd(9)} ${String(r.ms).padStart(5)}ms  ${r.detail}`).join("\n");
