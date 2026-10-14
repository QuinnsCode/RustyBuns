// Tier 2's guard rails (#866): the nightly edge run deploys slim borg for real, so it has to
// stay cheap and leave nothing behind. Pure functions here; edge.ts at the app root runs them.

/** Every edge run deploys under its own stage, `borg<unix seconds>`, so its resources carry their start time. */
export const stageName = (now = Date.now()) => `borg${Math.floor(now / 1000)}`;

// Alchemy names a resource `<app>-<id>-<stage>-<suffix>` (lowercased for R2 and queues), and the
// app is borg-slim. A name this doesn't match was never borg's, so the sweeper leaves it alone.
const nameRe = (app: string, prefix: string) => new RegExp(`^${app}-.+-${prefix}(\\d{10})-`, "i");
const BORG_NAME = nameRe("borg-slim", "borg");

/** When the run that made this resource started (ms), or null when it isn't a tier 2 resource. Fatty borg passes its app and `fatty` prefix. */
export function stageStarted(name: string, app?: string, prefix?: string): number | null {
  const m = (app ? nameRe(app, prefix ?? "borg") : BORG_NAME).exec(name);
  return m ? Number(m[1]) * 1000 : null;
}

/** A borg resource from a run that started over `maxAgeMs` ago: its own destroy should have gone by now. */
export const stale = (name: string, now = Date.now(), maxAgeMs = 60 * 60_000, app?: string, prefix?: string) => {
  const t = stageStarted(name, app, prefix);
  return t !== null && now - t > maxAgeMs;
};

export interface Billable { what: string; kind: string; note: string }

/** The rows of `rustybuns plan`'s "billable resources in this stack:" table. */
export function billablesFromPlan(plan: string): Billable[] {
  const lines = plan.split("\n");
  const start = lines.findIndex((l) => l.startsWith("billable resources in this stack:"));
  if (start < 0) return [];
  const out: Billable[] = [];
  for (const l of lines.slice(start + 1)) {
    const m = /^ {2}(\S.*?) {2,}(fixed|usage) {1,}(.*)$/.exec(l);
    if (!m) break;
    out.push({ what: m[1]!.trim(), kind: m[2]!, note: m[3]!.trim() });
  }
  return out;
}

export interface Cap {
  /** At most this many billable resources: today's stack is the Worker and its five bindings. */
  maxResources: number;
  /** Allow resources Cloudflare bills only on Workers Paid. Off: the run has to fit a Free-plan account. */
  allowPaid: boolean;
}
export const DEFAULT_CAP: Cap = { maxResources: 6, allowPaid: false };

/**
 * The cost cap, read from the plan: every resource bills by usage (one run sits inside the free
 * allowances), none needs Workers Paid unless allowed, and the stack hasn't grown. The problems,
 * empty when the deploy may go ahead.
 */
export function overCap(plan: string, cap: Cap = DEFAULT_CAP): string[] {
  const rows = billablesFromPlan(plan);
  if (!rows.length) return ["no billable resources table in the plan output, so the cost can't be checked"];
  const out: string[] = [];
  for (const r of rows) {
    if (r.kind !== "usage") out.push(`${r.what} bills ${r.kind} (${r.note}), and a run may only use resources billed by usage`);
    else if (!cap.allowPaid && /Paid only/i.test(r.note)) out.push(`${r.what} needs Workers Paid (${r.note})`);
  }
  if (rows.length > cap.maxResources) out.push(`${rows.length} billable resources, over the cap of ${cap.maxResources}: raise BORG_MAX_RESOURCES if the stack grew on purpose`);
  return out;
}

// The sweeper: anything borg's that outlived its run, for runs that died before their destroy.
// Queues go first (their consumer is the Worker), then the Worker (and its Durable Objects).
const KINDS = [
  { kind: "queue", list: "queues", paged: true, items: (r: any) => r, name: (x: any) => x.queue_name, del: (x: any) => `queues/${x.queue_id}` },
  { kind: "worker", list: "workers/scripts", paged: false, items: (r: any) => r, name: (x: any) => x.id, del: (x: any) => `workers/scripts/${x.id}?force=true` },
  { kind: "d1", list: "d1/database", paged: true, items: (r: any) => r, name: (x: any) => x.name, del: (x: any) => `d1/database/${x.uuid}` },
  { kind: "kv", list: "storage/kv/namespaces", paged: true, items: (r: any) => r, name: (x: any) => x.title, del: (x: any) => `storage/kv/namespaces/${x.id}` },
  { kind: "r2", list: "r2/buckets?per_page=1000", paged: false, items: (r: any) => r?.buckets, name: (x: any) => x.name, del: (x: any) => `r2/buckets/${x.name}` },
] as const;

export interface SweepOpts {
  accountId: string; token: string; now?: number; maxAgeMs?: number; dryRun?: boolean; fetch?: typeof fetch;
  /** Also this run's own stage, whatever its age: what its destroy left behind. */
  stage?: string;
  /** Whose resources: slim borg by default; fatty borg names its app and the `fatty` stage prefix. */
  app?: string; prefix?: string;
}
export interface Swept { kind: string; name: string; error?: string }

export async function sweep(o: SweepOpts): Promise<Swept[]> {
  const f = o.fetch ?? fetch, now = o.now ?? Date.now();
  const base = `https://api.cloudflare.com/client/v4/accounts/${o.accountId}/`;
  const call = async (path: string, method = "GET") => {
    const r = (await (await f(base + path, { method, headers: { Authorization: `Bearer ${o.token}` } })).json().catch(() => null)) as any;
    if (!r?.success) throw new Error(`${method} ${path.split("?")[0]}: ${r?.errors?.map((e: any) => e.message).join("; ") || "no answer"}`);
    return r;
  };
  const out: Swept[] = [];
  for (const k of KINDS) {
    const found: any[] = [];
    for (let page = 1; ; page++) {
      const r = await call(k.paged ? `${k.list}?per_page=100&page=${page}` : k.list);
      found.push(...(k.items(r.result) ?? []));
      if (!k.paged || page >= (r.result_info?.total_pages ?? 1)) break;
    }
    const mine = (n: string) => !!o.stage && stageStarted(n, o.app, o.prefix) !== null && n.toLowerCase().includes(`-${o.stage.toLowerCase()}-`);
    for (const x of found.filter((x) => stale(k.name(x), now, o.maxAgeMs, o.app, o.prefix) || mine(k.name(x)))) {
      const s: Swept = { kind: k.kind, name: k.name(x) };
      if (!o.dryRun) await call(k.del(x), "DELETE").catch((e: Error) => { s.error = e.message; });
      out.push(s);
    }
  }
  return out;
}
