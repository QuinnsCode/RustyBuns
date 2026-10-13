// `plan --usage`: a monthly bill from what the bindings actually did (#1224). The host counts every
// binding call per cause (shell-bun's usage.ts): per request, per cron tick, per queue message.
// Here each cause's per-run counts are multiplied out: a cron by its ticks in 30 days, requests by
// a stated rate, a queue's consumer by the messages the other causes send it. Durable Object
// duration is the one that surprises: an object stays in memory, billed, for a while after its
// last event, so a cron that pokes it more often than that keeps it awake around the clock.

import { cronMatches, parseCron } from "@rustybuns/shell-bun/cron";
import type { UsageSnapshot } from "@rustybuns/shell-bun/usage";
import { homedir } from "node:os";

const DAY_S = 86_400, MONTH_S = 30 * DAY_S;
/** How long an idle Durable Object stays in memory (and billed) after its last event; Cloudflare evicts after 70-140 s. */
export const DO_IDLE_S = 70;
/** Duration bills the 128 MB an object is given, whatever it uses. */
const DO_GB = 0.128;

/** Workers Paid ($5 a month): what it includes a month and the price per million past that. */
const PRICES: Record<string, { label: string; included: number; perMillion: number }> = {
  workerRequests: { label: "Worker requests", included: 10e6, perMillion: 0.30 },
  requests: { label: "DO requests", included: 1e6, perMillion: 0.15 },
  gbS: { label: "DO duration, GB-s", included: 400_000, perMillion: 12.50 },
  rowsRead: { label: "D1 rows read", included: 25e9, perMillion: 0.001 },
  rowsWritten: { label: "D1 rows written", included: 50e6, perMillion: 1.00 },
  reads: { label: "KV reads", included: 10e6, perMillion: 0.50 },
  writes: { label: "KV writes", included: 1e6, perMillion: 5.00 },
  lists: { label: "KV lists", included: 1e6, perMillion: 5.00 },
  classA: { label: "R2 class A ops", included: 1e6, perMillion: 4.50 },
  classB: { label: "R2 class B ops", included: 10e6, perMillion: 0.36 },
  queueOps: { label: "Queue ops", included: 1e6, perMillion: 0.40 },
};

/** Seconds between a cron's ticks over 30 days from a fixed start: their count is the ticks a month. */
export function cronGaps(expr: string, from = Date.UTC(2026, 0, 1)): number[] {
  const cron = parseCron(expr), ticks: number[] = [];
  for (let m = 0; m < MONTH_S / 60; m++) if (cronMatches(cron, new Date(from + m * 60_000))) ticks.push(m * 60);
  // Wrap around, so the gap after the last tick of the window counts too.
  return ticks.map((t, i) => (i + 1 < ticks.length ? ticks[i + 1]! : ticks[0]! + MONTH_S) - t);
}

export interface CauseEstimate {
  cause: string;
  /** Runs a month: ticks, requests or messages. */
  runs: number;
  /** How `runs` was found. */
  basis: string;
  /** Each run's counts, `<binding>.<unit>`. */
  perRun: Record<string, number>;
  /** The month's counts, `<binding>.<unit>`, with `<binding>.gbS` for DO duration. */
  monthly: Record<string, number>;
  /** DO bindings this cron keeps awake around the clock, with the objects per tick. */
  awake: { binding: string; objects: number; everyS: number }[];
}

export interface Estimate { causes: CauseEstimate[]; rows: { label: string; amount: number; usd: number }[]; usd: number; uptimeS: number }

const split = (key: string) => { const i = key.lastIndexOf("."); return [key.slice(0, i), key.slice(i + 1)] as const; };

function project(cause: string, c: UsageSnapshot["causes"][string], runs: number, basis: string, gaps?: number[]): CauseEstimate {
  const perRun: Record<string, number> = {}, monthly: Record<string, number> = {}, awake: CauseEstimate["awake"] = [];
  const n = Math.max(c.runs, 1);
  for (const [k, v] of Object.entries(c.ops)) perRun[k] = v / n;
  for (const [k, v] of Object.entries(perRun)) {
    const [binding, unit] = split(k);
    if (unit === "busyMs") continue;
    monthly[k] = v * runs;
    if (unit !== "objects") continue;
    // Each object a run touches is awake while the run uses it, then DO_IDLE_S more, unless the next run comes first.
    const busyS = (perRun[`${binding}.busyMs`] ?? 0) / 1000 / Math.max(v, 1e-9);
    const held = busyS + DO_IDLE_S;
    const seconds = gaps ? gaps.reduce((s, g) => s + Math.min(g, held), 0) : held * runs;
    monthly[`${binding}.gbS`] = v * seconds * DO_GB;
    if (gaps?.length && v >= 1 && gaps.every((g) => g <= held)) awake.push({ binding, objects: Math.round(v), everyS: Math.max(...gaps) });
  }
  return { cause, runs, basis, perRun, monthly, awake };
}

/**
 * The month a usage snapshot points to. Requests run at `requestsPerDay`, or at the rate the
 * snapshot saw; other work (socket frames, alarms with no cause) is scaled up by uptime.
 */
export function estimate(snap: UsageSnapshot, o: { requestsPerDay?: number } = {}): Estimate {
  const uptimeS = Math.max(snap.uptimeS, 1), scale = MONTH_S / uptimeS;
  const out: CauseEstimate[] = [];
  for (const [cause, c] of Object.entries(snap.causes)) {
    if (cause.startsWith("cron ")) {
      const gaps = cronGaps(cause.slice(5));
      out.push(project(cause, c, gaps.length, "ticks in 30 days", gaps));
    } else if (cause === "request") {
      const perDay = o.requestsPerDay ?? c.runs * DAY_S / uptimeS;
      out.push(project(cause, c, perDay * 30, o.requestsPerDay !== undefined ? `${fmt(perDay)} a day (--requests-per-day)` : `${fmt(perDay)} a day, the rate this run saw`));
    } else if (cause === "other") out.push(project(cause, { ...c, runs: 1 }, scale, `scaled from ${duration(uptimeS)} of uptime`));
  }
  // A queue's consumer runs once per message the causes above send it (one level: sends from a consumer aren't chased).
  for (const [cause, c] of Object.entries(snap.causes)) {
    if (!cause.startsWith("queue ")) continue;
    const name = cause.slice(6);
    const messages = out.reduce((s, e) => s + (e.monthly[`${name}.sent`] ?? 0), 0);
    out.push(project(cause, c, messages, `messages sent to ${name}`));
  }
  const totals: Record<string, number> = { workerRequests: 0 };
  for (const e of out) {
    if (e.cause === "request" || e.cause.startsWith("cron ")) totals.workerRequests! += e.runs;
    for (const [k, v] of Object.entries(e.monthly)) {
      const [, unit] = split(k);
      // A queued message is about three operations: write, read, delete.
      const key = unit === "sent" ? "queueOps" : unit;
      if (key in PRICES) totals[key] = (totals[key] ?? 0) + (unit === "sent" ? v * 3 : v);
    }
  }
  const rows = Object.entries(PRICES).filter(([k]) => totals[k]).map(([k, p]) => {
    const amount = totals[k]!;
    return { label: p.label, amount, usd: Math.max(0, amount - p.included) / 1e6 * p.perMillion };
  });
  return { causes: out, rows, usd: rows.reduce((s, r) => s + r.usd, 0), uptimeS };
}

function fmt(n: number): string {
  if (n >= 1e9) return `${+(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `${+(n / 1e3).toFixed(0)}k`;
  return n >= 100 || Number.isInteger(n) ? Math.round(n).toLocaleString("en-US") : String(+n.toFixed(1));
}
function duration(s: number): string {
  return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round(s % 3600 / 60)}m` : `${Math.round(s / 60)} min`;
}

export function formatEstimate(e: Estimate): string {
  const lines = [`estimated month from ${duration(e.uptimeS)} of counted usage (Workers Paid):`];
  for (const c of e.causes) {
    const per = Object.entries(c.perRun).filter(([k]) => !k.endsWith(".busyMs")).map(([k, v]) => `${fmt(v)} ${k}`).join(", ");
    lines.push(`  ${c.cause}: ${fmt(c.runs)} (${c.basis})${per ? `, each ${per}` : ""}`);
    for (const a of c.awake)
      lines.push(`    ! keeps ${a.objects} ${a.binding} object${a.objects === 1 ? "" : "s"} awake 24/7: ticks at most ${a.everyS} s apart, and an idle object stays billed ~${DO_IDLE_S} s`);
  }
  if (e.rows.length) {
    const w = Math.max(...e.rows.map((r) => r.label.length));
    for (const r of e.rows) lines.push(`  ${r.label.padEnd(w)}  ${fmt(r.amount).padStart(7)}  ${r.usd ? `$${r.usd.toFixed(2)}` : "included"}`);
  }
  lines.push(`  ~$${e.usd.toFixed(2)} a month past what Workers Paid includes, plus its $5`);
  lines.push("  not counted: CPU time, storage, Workers AI and other bindings with no local twin");
  return lines.join("\n");
}

/** A snapshot from a file (a desktop's <data>/usage.json) or a box's URL (its /__rb/usage). */
export async function loadUsage(src: string, f: typeof fetch = fetch): Promise<UsageSnapshot> {
  if (/^https?:\/\//.test(src)) {
    const url = src.includes("/__rb/usage") ? src : `${src.replace(/\/$/, "")}/__rb/usage`;
    const res = await f(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`${url}: status ${res.status}; is it a RustyBuns box built with usage counting?`);
    return await res.json() as UsageSnapshot;
  }
  const file = Bun.file(src.replace(/^~(?=\/)/, homedir()));
  if (!(await file.exists())) throw new Error(`--usage ${src}: no such file. A desktop host writes <data>/usage.json once a minute.`);
  return await file.json() as UsageSnapshot;
}

/** Takes `--usage <src>` and `--requests-per-day <n>` (or `=`) out of a command line. */
export function usageFlags(args: string[]): { usage?: string; requestsPerDay?: number; rest: string[] } {
  let usage: string | undefined, requestsPerDay: number | undefined;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!, eq = a.indexOf("="), name = eq > 0 ? a.slice(0, eq) : a;
    if (name !== "--usage" && name !== "--requests-per-day") { rest.push(a); continue; }
    const v = eq > 0 ? a.slice(eq + 1) : args[++i];
    if (!v) throw new Error(`${name} needs a value`);
    if (name === "--usage") usage = v;
    else if (!(Number(v) >= 0)) throw new Error(`--requests-per-day wants a number, got ${v}`);
    else requestsPerDay = Number(v);
  }
  return { usage, requestsPerDay, rest };
}
