// The edge's one Lobby: how many rooms are open at once, how many seshes are kept at all
// (the storage cap), and the sign-up lists: people who asked for a room while they were all taken, and people who hit
// a free limit and want the paid plan. A room checks in when a player arrives and out when
// its last one leaves (packages/desktop/world.ts). The desktop has no Lobby, so its one
// room is never turned away.
//
// Live sets (src/listen.ts) check in here too: one live set at a time per DJ key (held on a lease, so a set whose
// Durable Object crashed frees itself), and a monthly allowance of free set-hours per DJ key hash and per address
// hash, counted by calendar month (UTC). A set that is live holds its whole planned length against its address, so
// several DJ keys there can't each start on the same hours; when it ends, only the time it ran counts. When a set ends, its usage record lands here, so the limits can be set from
// real averages (GET /usage).
import { arr, bool, int, num, obj, oneOf, opt, rec, str, type Guard, type Of } from "@rustybuns/util/guard";
import { json, readJson } from "@rustybuns/util/http";
import { LISTS, type List } from "./signup-wire.ts";

/** A room that never checked out (its Durable Object was reset mid-jam) frees its slot after this. */
export const LEASE_MS = 6 * 60 * 60 * 1000;
export const MAX_SIGNUPS = 5000;
export const DEFAULT_MAX_ROOMS = 50;
/** Seshes kept at once, open or not: each one is a groove in storage and a backup in the bucket. */
export const DEFAULT_MAX_SESHES = 2000;
/** A sesh nobody has opened for this long is deleted, groove and backup (the World does it; the Lobby forgets it). */
export const IDLE_MS = 30 * 24 * 60 * 60 * 1000;
/** Free set-hours a month for each DJ key and each address (FREE_SET_HOURS overrides). */
export const DEFAULT_FREE_SET_HOURS = 16;
/** A live set's lease runs this long past its planned end, then a set that never checked out frees its DJ. */
export const LIVE_SLACK_MS = 10 * 60 * 1000;
/** Usage records kept (the oldest go first); the monthly totals keep everything. */
export const USAGE_KEPT = 500;
export const HOUR_MS = 60 * 60 * 1000;

const ROOM = obj({ room: str(64) });
const SIGNUP = obj({ email: str(254, { min: 3, re: /^[^\s@]+@[^\s@]+$/ }), room: str(64, { min: 0, dflt: "" }), list: opt(oneOf(LISTS)) });
const SAVED_ROOMS: Guard<Record<string, number>> = (v) => {
  const out: Record<string, number> = {};
  if (typeof v === "object" && v !== null) for (const [k, at] of Object.entries(v)) if (typeof at === "number") out[k] = at;
  return out;
};
const HASH = str(64, { re: /^[0-9a-f]{64}$/ });

/** Listen asks to go live: the DJ key's hash, the address's hash, the set's link id, when, and how long a set may run. */
export const GoLive = obj({ dj: HASH, ip: HASH, set: str(10), at: num(0, 1e15), setMs: num(0, 1e9) });
/** The Lobby's answer: refused (`why` the limit, `n` its number), or live until `endAt`, when `endWhy` (`n`) ends it. */
export const LiveReply = obj({
  ok: bool(),
  why: opt(oneOf(["one", "month"] as const)),
  n: opt(num(0, 1e6)),
  endAt: opt(num(0, 1e15)),
  endWhy: opt(oneOf(["hours", "month"] as const)),
});
export type LiveReply = Of<typeof LiveReply>;
/** One set's use, sent by Listen when it ends: how long, its most listeners at once, chunks relayed, who ended it. */
export const UsageRecord = obj({ at: num(0, 1e15), hours: num(0, 1000), peakEars: int(0, 100_000), chunks: int(0, 1e9), endedBy: oneOf(["dj", "limit"] as const) });
export type UsageRecord = Of<typeof UsageRecord>;
export const SetEnded = obj({ dj: HASH, ip: HASH, set: str(10), rec: UsageRecord });
/** A month's running total of every set that ended in it. */
export const MonthTotal = obj({ sets: int(0, 1e9), hours: num(0, 1e9), chunks: int(0, 1e15), ears: int(0, 1e12), peakEars: int(0, 100_000), byLimit: int(0, 1e9) });
export type MonthTotal = Of<typeof MonthTotal>;
/** GET /usage: the totals by month ("2026-11"), and the last USAGE_KEPT records. */
export const UsageReply = obj({ totals: rec(MonthTotal, 1000), records: arr(UsageRecord, USAGE_KEPT) });
export type UsageReply = Of<typeof UsageReply>;

/** The calendar month (UTC) a time falls in: "2026-11". */
export const monthOf = (ms: number) => new Date(ms).toISOString().slice(0, 7);

export interface Signup { email: string; room: string; at: number; place: number; list: List }
export type Status = { open: number; max: number; kept: number; maxKept: number };

interface Ctx {
  storage: {
    get(k: string): Promise<unknown>; put(k: string, v: unknown): Promise<void>; delete(k: string): Promise<unknown>;
    list<T>(o: { prefix: string }): Promise<Map<string, T>>;
  };
  blockConcurrencyWhile(f: () => Promise<void>): void;
}
interface Env { MAX_ROOMS?: string; MAX_SESHES?: string; FREE_SET_HOURS?: string }

/** A live set: its link, when its lease runs out, its address hash and planned length (absent on one saved before them). */
const LIVE_SET = obj({ set: str(10), until: num(0, 1e15), ip: opt(HASH), ms: opt(num(0, 1e9)) });
const LIVE = rec(LIVE_SET, 1e6);
const listPrefix = (l: List) => (l === "full" ? "s:" : `w:${l}:`);
const listCount = (l: List) => (l === "full" ? "signups" : `signups:${l}`);
const EMPTY_TOTAL: MonthTotal = { sets: 0, hours: 0, chunks: 0, ears: 0, peakEars: 0, byLimit: 0 };

export default class Lobby {
  /** Open rooms, each with when a player last arrived. */
  private rooms = new Map<string, number>();
  /** Every sesh still kept, with when someone last came in. */
  private kept = new Map<string, number>();
  /** DJ key hashes live now. */
  private live = new Map<string, Of<typeof LIVE_SET>>();
  private max: number;
  private maxKept: number;
  private freeHours: number;

  constructor(private ctx: Ctx, env: Env) {
    this.max = Number(env.MAX_ROOMS) > 0 ? Number(env.MAX_ROOMS) : DEFAULT_MAX_ROOMS;
    this.maxKept = Number(env.MAX_SESHES) > 0 ? Number(env.MAX_SESHES) : DEFAULT_MAX_SESHES;
    this.freeHours = Number(env.FREE_SET_HOURS) > 0 ? Number(env.FREE_SET_HOURS) : DEFAULT_FREE_SET_HOURS;
    ctx.blockConcurrencyWhile(async () => {
      for (const [k, at] of Object.entries(SAVED_ROOMS(await ctx.storage.get("rooms")))) this.rooms.set(k, at);
      for (const [k, at] of Object.entries(SAVED_ROOMS(await ctx.storage.get("kept")))) this.kept.set(k, at);
      try { for (const [k, v] of Object.entries(LIVE(await ctx.storage.get("live") ?? {}))) this.live.set(k, v); } catch { /* none kept */ }
    });
  }

  /** Hours used this month by a DJ key hash ("d") or an address hash ("i"). */
  private async used(month: string, who: "d" | "i", hash: string) { return Number(await this.ctx.storage.get(`u:${month}:${who}:${hash}`)) || 0; }

  /** A new month: last month's per-key hours go (the totals keep its sums). */
  private async turnMonth(month: string) {
    const was = await this.ctx.storage.get("month");
    if (was === month) return;
    if (typeof was === "string") for (const k of (await this.ctx.storage.list({ prefix: `u:${was}:` })).keys()) await this.ctx.storage.delete(k);
    await this.ctx.storage.put("month", month);
  }

  private async goLive(g: Of<typeof GoLive>): Promise<LiveReply> {
    for (const [k, l] of this.live) if (l.until <= g.at) this.live.delete(k);
    const had = this.live.get(g.dj);
    if (had && had.set !== g.set) return { ok: false, why: "one" as const, n: 1 };
    const month = monthOf(g.at);
    await this.turnMonth(month);
    // what the address's other live sets may still run to (this DJ's own entry is the set being asked about again)
    let heldMs = 0;
    for (const [dj, l] of this.live) if (dj !== g.dj && l.ip === g.ip) heldMs += l.ms ?? 0;
    const usedH = Math.max(await this.used(month, "d", g.dj), await this.used(month, "i", g.ip) + heldMs / HOUR_MS);
    const leftMs = (this.freeHours - usedH) * HOUR_MS;
    if (leftMs <= 0) return { ok: false, why: "month" as const, n: this.freeHours };
    const byMonth = leftMs < g.setMs, endAt = g.at + (byMonth ? leftMs : g.setMs);
    this.live.set(g.dj, { set: g.set, until: endAt + LIVE_SLACK_MS, ip: g.ip, ms: endAt - g.at });
    await this.ctx.storage.put("live", Object.fromEntries(this.live));
    return { ok: true, endAt, endWhy: byMonth ? "month" as const : "hours" as const, n: byMonth ? this.freeHours : g.setMs / HOUR_MS };
  }

  private async ended(e: Of<typeof SetEnded>) {
    if (this.live.get(e.dj)?.set === e.set) { this.live.delete(e.dj); await this.ctx.storage.put("live", Object.fromEntries(this.live)); }
    const month = monthOf(e.rec.at);
    await this.turnMonth(month);
    for (const [who, hash] of [["d", e.dj], ["i", e.ip]] as const) {
      await this.ctx.storage.put(`u:${month}:${who}:${hash}`, (await this.used(month, who, hash)) + e.rec.hours);
    }
    const use = await this.usage();
    const t = use.totals[month] ?? { ...EMPTY_TOTAL };
    use.totals[month] = {
      sets: t.sets + 1, hours: t.hours + e.rec.hours, chunks: t.chunks + e.rec.chunks, ears: t.ears + e.rec.peakEars,
      peakEars: Math.max(t.peakEars, e.rec.peakEars), byLimit: t.byLimit + (e.rec.endedBy === "limit" ? 1 : 0),
    };
    use.records = [...use.records, e.rec].slice(-USAGE_KEPT);
    await this.ctx.storage.put("usage", use);
  }

  private async usage(): Promise<UsageReply> {
    try { return UsageReply(await this.ctx.storage.get("usage") ?? { totals: {}, records: [] }); } catch { return { totals: {}, records: [] }; }
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url), path = url.pathname, now = Date.now();
    for (const [r, at] of this.rooms) if (now - at > LEASE_MS) this.rooms.delete(r);
    for (const [r, at] of this.kept) if (now - at > IDLE_MS && !this.rooms.has(r)) this.kept.delete(r);
    const status = (): Status => ({ open: this.rooms.size, max: this.max, kept: this.kept.size, maxKept: this.maxKept });
    if (req.method === "GET" && path === "/status") return json(status());
    if (req.method === "GET" && path === "/signups") {
      const list = LISTS.find((l) => l === url.searchParams.get("list")) ?? "full";
      const rows = await this.ctx.storage.list<Signup>({ prefix: listPrefix(list) });
      return json([...rows.values()].sort((a, b) => a.place - b.place));
    }
    if (req.method === "GET" && path === "/usage") return json((await this.usage()) satisfies UsageReply);
    if (req.method !== "POST") return json({ error: "not found" }, 404);
    if (path === "/signup") {
      const s = await readJson(req, SIGNUP);
      if (!s) return json({ error: "an email address, please" }, 400);
      const list = s.list ?? "full", key = `${listPrefix(list)}${s.email.toLowerCase()}`;
      const had = await this.ctx.storage.get(key);
      if (typeof had === "object" && had !== null && "place" in had && typeof had.place === "number") return json({ place: had.place });
      const count = Number(await this.ctx.storage.get(listCount(list))) || 0;
      if (count >= MAX_SIGNUPS) return json({ error: "the list is full too, sorry" }, 503);
      const row: Signup = { email: s.email, room: s.room, at: now, place: count + 1, list };
      await this.ctx.storage.put(key, row);
      await this.ctx.storage.put(listCount(list), row.place);
      return json({ place: row.place });
    }
    if (path === "/live") {
      const g = await readJson(req, GoLive);
      return g ? json(await this.goLive(g)) : json({ error: "which set?" }, 400);
    }
    if (path === "/ended") {
      const e = await readJson(req, SetEnded);
      if (!e) return json({ error: "which set?" }, 400);
      await this.ended(e);
      return json({ ok: true });
    }
    const r = await readJson(req, ROOM);
    if (!r) return json({ error: "which room?" }, 400);
    if (path === "/admit") {
      // a room already open always gets its next player; a new one needs a free slot, and a new sesh room in storage
      const full = !this.rooms.has(r.room) && (this.rooms.size >= this.max || (!this.kept.has(r.room) && this.kept.size >= this.maxKept));
      if (full) return json({ ok: false, ...status() });
      this.rooms.set(r.room, now);
      this.kept.set(r.room, now);
      await this.ctx.storage.put("kept", Object.fromEntries(this.kept));
    } else if (path === "/release") {
      this.rooms.delete(r.room);
      if (this.kept.has(r.room)) this.kept.set(r.room, now);       // its idle clock starts now, as the World's does
      await this.ctx.storage.put("kept", Object.fromEntries(this.kept));
    } else return json({ error: "not found" }, 404);
    await this.ctx.storage.put("rooms", Object.fromEntries(this.rooms));
    return json({ ok: true, ...status() });
  }
}
