// The scale sideboard, for admins: the survey (#/admin/scale, GET /api/admin/scale): every
// wall codeSplitter hits as it grows, like a sideboard guide. Each card says
// what breaks, where, at about what number, how it shows, the fix on Cloudflare,
// what moving to one box (Hetzner or Railway, the same code on shell-bun) would
// do instead, and the one next step. Where the app can measure how close it is,
// the card carries a live reading against its wall.
//
// The walls are estimates from the code and Cloudflare's published limits, not
// load tests. Readings are cheap queries over D1, taken when the page asks.

import { json, type Env } from "./env.ts";
import { TALLY_MS } from "./limits.ts";

export type State = "ok" | "warn" | "bad" | "unmeasured";
export interface Card {
  id: string;
  name: string;
  where: string;
  wall: string;
  shows: string;
  here: string;
  box: string;
  next: string;
}
export interface Reading { value: number | null; limit: number; unit: string; note: string }

const MB = 1024 * 1024, GB = 1024 * MB;

export const CARDS: Card[] = [
  {
    id: "d1-writes", name: "One D1 for the whole site", where: "D1: limit_hits, line_events, traffic",
    wall: "~500 writes/s sitewide (one writer per database), about 500 people typing at once, less the traffic tallies",
    shows: "Edits lag everywhere at once, even on different files; D1 overloaded errors and 5xx on Insights",
    here: "Yes. Edits are counted in the file's DO and tallied to D1 once a second per typist, off the edit path (#623); traffic is gathered per isolate and written once a second per caller, not per request (#638)",
    box: "SQLite on local NVMe takes 10–100× the writes, no network hop",
    next: "If traffic tallies still weigh, move them to Analytics Engine and point Insights at its SQL API; past that, move the append-heavy tables to PlanetScale Postgres (notes/PLANETSCALE.md)",
  },
  {
    id: "d1-errors", name: "Server errors", where: "Every answered request (the traffic tally Insights reads)",
    wall: "2% of requests answered 5xx in a day, where Insights turns amber; D1 'overloaded' is the usual cause once writes pass the single writer",
    shows: "Errors on edits, sign-ins and Insights at the busiest hour, while quiet hours are fine",
    here: "Watched, not fixed: the reading is all 5xx, so check the Worker logs for 'overloaded' before blaming D1",
    box: "Local SQLite has no overloaded error; the same 5xx count still reads",
    next: "If 'overloaded' is the cause on a normal day, that is the signal to try PlanetScale (notes/PLANETSCALE.md)",
  },
  {
    id: "d1-size", name: "D1's 10 GB cap", where: "D1, the whole database",
    wall: "10 GB per database",
    shows: "Writes start failing: new repos, digs, commits, sign-ins",
    here: "Yes. Search is out of D1 now (#626); keep line_events short, split per owner if it comes to that",
    box: "Disk is the cap: hundreds of GB for a few euros",
    next: "Split D1 per owner if it nears the cap, or move the biggest tables to PlanetScale Postgres (notes/PLANETSCALE.md)",
  },
  {
    id: "search", name: "Search keeps every file", where: "RepoSearch: FTS5 in one Durable Object per repo (search.ts)",
    wall: "10 GB per repo's index (a Durable Object's SQLite), ~4 GB of text; across repos, Vectorize's 10M vectors (16 chunks of 40 lines a file), or without it a fan-out to 50 repos",
    shows: "One huge repo stops indexing commits; without the vector index, a search across repos misses repos past the 50 it asks",
    here: "Yes, with CODESPLITTER_VECTORS=1: one Vectorize index across repos picks the 10 to ask (#636). Without it, the fan-out",
    box: "Same FTS5, plenty of disk, and the fan-out: no Vectorize off Cloudflare",
    next: "Embed whole big files, past 640 lines, if search across repos misses what's deep in them",
  },
  {
    id: "big-file", name: "A file lives in one object's memory", where: "file-do.ts: the whole doc in memory; doc-store.ts writes it in chunks",
    wall: "128 MB of memory per Durable Object, and each edit copies the lines once, so ~64 MB of doc, around half a million lines",
    shows: "That one file's object runs out of memory and restarts; edits to it fail",
    here: "Mostly. The doc is stored in chunks of ~500 lines and an edit writes only the chunks it touched (#624); next, keep only those chunks in memory too",
    box: "More memory, the same code",
    next: "Edit the doc in place, not as a copy, if files get that big",
  },
  {
    id: "op-log", name: "The op log is read whole", where: "file-do.ts: log(since) lists every op:",
    wall: "~300k ops on one file (the 128 MB isolate)",
    shows: "Reconnects and time travel on a long-lived hot file get slow, then crash the file's DO",
    here: "Yes. Read from op:<since> with a range, snapshot and trim old ops",
    box: "More memory buys time; the fix is the same",
    next: "Range-read the log from since",
  },
  {
    id: "hot-file", name: "One hot file", where: "One FileDurableObject per file",
    wall: "~1,000 requests/s on a single file",
    shows: "A swarm of agents on one file queues up; everyone else is fine",
    here: "Partly. Claims already split who writes what; past that, split the file",
    box: "One process, same single writer: no better",
    next: "Nothing yet; watch swarms on one file",
  },
  {
    id: "agents", name: "Hosted agent runs", where: "AgentSandbox containers (rustybuns.config.ts)",
    wall: "maxInstances 2: two hosted agent runs at once, sitewide",
    shows: "Agent runs wait for a sandbox",
    here: "Yes, it's config: raise maxInstances, and pay per running container",
    box: "Docker on the box: as many as the cores hold, no per-second bill",
    next: "Raise maxInstances when runs start waiting",
  },
  {
    id: "deploys", name: "Deploys and previews", where: "DeployRunner container (rustybuns.config.ts)",
    wall: "maxInstances 1: one deploy or preview at once, sitewide",
    shows: "A second deploy waits or gets a 409",
    here: "Yes, it's config: raise maxInstances",
    box: "Docker on the box",
    next: "Raise maxInstances when deploys start waiting",
  },
];

/** How close a reading is to its wall: under half is fine, past 80% is critical. */
export function stateOf(r: Reading | undefined): State {
  if (!r || r.value === null) return "unmeasured";
  const f = r.value / r.limit;
  return f >= 0.8 ? "bad" : f >= 0.5 ? "warn" : "ok";
}

const n = (x: unknown) => Number(x ?? 0);

/** D1's size: Cloudflare reports it on every result; the local twin answers the pragmas. */
async function dbBytes(env: Env): Promise<number | null> {
  const r: any = await env.DB.prepare("SELECT 1").run().catch(() => null);
  if (typeof r?.meta?.size_after === "number") return r.meta.size_after;
  try {
    const pages = n((await env.DB.prepare("PRAGMA page_count").first() as any)?.page_count);
    const size = n((await env.DB.prepare("PRAGMA page_size").first() as any)?.page_size);
    return pages && size ? pages * size : null;
  } catch { return null; }
}

/** Live readings for the cards that can be measured from D1. */
export async function readings(env: Env, now = Date.now()): Promise<Record<string, Reading>> {
  const first = async (sql: string, ...args: unknown[]) => ((await env.DB.prepare(sql).bind(...args).first()) ?? {}) as Record<string, unknown>;
  // The busiest edit window in the last day, in D1 writes: a file's Tally writes each typist's edits once every TALLY_MS at most, before the feed's and traffic's.
  const edits = await first("SELECT MAX(c) AS peak FROM (SELECT SUM(MIN(count, ?)) AS c FROM limit_hits WHERE rule = 'edit' AND win >= ? GROUP BY win)", 60_000 / TALLY_MS, now - 86_400_000);
  // The biggest committed file: its text, plus ~70 bytes a line of id, rev, author and time in the doc.
  const big = await first("SELECT owner, repo, big_path AS path, big_bytes AS bytes, big_lines AS lines FROM repo_search ORDER BY big_bytes DESC LIMIT 1");
  // The biggest repo's search index (its DO's SQLite, as of its last commit).
  const search = await first("SELECT owner, repo, size_bytes AS bytes FROM repo_search ORDER BY size_bytes DESC LIMIT 1");
  // The most edited file in the 30 days of line_events: ops added to its log.
  const hot = await first("SELECT owner, repo, path, SUM(sets + inserts + deletes) AS ops FROM line_events GROUP BY owner, repo, path ORDER BY ops DESC LIMIT 1");
  // 5xx as a share of the last day's requests, from the tally Insights reads.
  const errs = await first("SELECT SUM(hits) AS hits, SUM(errors) AS errors FROM traffic WHERE last_at >= ?", now - 86_400_000);
  const runs = await first("SELECT COUNT(*) AS c FROM agent_runs WHERE status = 'running'");
  const deploys = await first("SELECT COUNT(*) AS c FROM deploys WHERE status = 'running'");
  const size = await dbBytes(env);
  const where = (r: Record<string, unknown>) => r.path ? `${r.owner ? `${r.owner}/${r.repo}/` : ""}${r.path}` : "";
  return {
    "d1-writes": { value: n(edits.peak) / 60, limit: 500, unit: "writes/s", note: "edit tallies in the busiest minute of the last day; traffic and feed writes come on top" },
    "d1-size": { value: size, limit: 10 * GB, unit: "bytes", note: size === null ? "D1 didn't say" : "the whole database" },
    "d1-errors": { value: n(errs.hits) ? Math.round(n(errs.errors) / n(errs.hits) * 1000) / 10 : 0, limit: 2, unit: "% 5xx",
      note: `${n(errs.errors).toLocaleString()} server errors in ${n(errs.hits).toLocaleString()} requests, last 24 hours` },
    "search": { value: n(search.bytes), limit: 10 * GB, unit: "bytes",
      note: search.repo ? `${search.owner}/${search.repo}, the biggest repo's index` : "no repo indexed yet" },
    "big-file": { value: n(big.bytes) + n(big.lines) * 70, limit: 64 * MB, unit: "bytes", note: big.path ? `${where(big)}, ${n(big.lines).toLocaleString()} lines` : "no files yet" },
    "op-log": { value: n(hot.ops), limit: 300_000, unit: "ops", note: hot.path ? `${where(hot)}, ops in the last 30 days (the log keeps all of them)` : "no edits yet" },
    "agents": { value: n(runs.c), limit: 2, unit: "runs", note: "running now" },
    "deploys": { value: n(deploys.c), limit: 1, unit: "deploys", note: "running now" },
  };
}

export async function scaleRoutes(req: Request, env: Env, p: string[], admin: boolean): Promise<Response | null> {
  if (p[1] !== "admin" || p[2] !== "scale" || p[3]) return null;
  if (!admin) return json({ error: "admins only" }, 403);
  if (req.method !== "GET") return json({ error: "GET only" }, 405);
  const r = await readings(env);
  const cards = CARDS.map((c) => ({ ...c, reading: r[c.id] ?? null, state: stateOf(r[c.id]) }));
  const order: State[] = ["bad", "warn", "ok", "unmeasured"];
  const worst = order.find((s) => cards.some((c) => c.state === s)) ?? "unmeasured";
  return json({ generated_at: Date.now(), worst, cards });
}
