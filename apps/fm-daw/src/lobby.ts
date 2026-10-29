// The edge's one Lobby: how many rooms are open at once, how many seshes are kept at all
// (the storage cap), and the list of people who asked for one while they were all taken. A room checks in when a player arrives and out when
// its last one leaves (packages/desktop/world.ts). The desktop has no Lobby, so its one
// room is never turned away.
import { obj, str, type Guard } from "@rustybuns/util/guard";
import { json, readJson } from "@rustybuns/util/http";

/** A room that never checked out (its Durable Object was reset mid-jam) frees its slot after this. */
export const LEASE_MS = 6 * 60 * 60 * 1000;
export const MAX_SIGNUPS = 5000;
export const DEFAULT_MAX_ROOMS = 50;
/** Seshes kept at once, open or not: each one is a groove in storage and a backup in the bucket. */
export const DEFAULT_MAX_SESHES = 2000;
/** A sesh nobody has opened for this long is deleted, groove and backup (the World does it; the Lobby forgets it). */
export const IDLE_MS = 30 * 24 * 60 * 60 * 1000;

const ROOM = obj({ room: str(64) });
const SIGNUP = obj({ email: str(254, { min: 3, re: /^[^\s@]+@[^\s@]+$/ }), room: str(64, { min: 0, dflt: "" }) });
const SAVED_ROOMS: Guard<Record<string, number>> = (v) => {
  const out: Record<string, number> = {};
  if (typeof v === "object" && v !== null) for (const [k, at] of Object.entries(v)) if (typeof at === "number") out[k] = at;
  return out;
};

export interface Signup { email: string; room: string; at: number; place: number }
export type Status = { open: number; max: number; kept: number; maxKept: number };

interface Ctx {
  storage: {
    get(k: string): Promise<unknown>; put(k: string, v: unknown): Promise<void>;
    list<T>(o: { prefix: string }): Promise<Map<string, T>>;
  };
  blockConcurrencyWhile(f: () => Promise<void>): void;
}

export default class Lobby {
  /** Open rooms, each with when a player last arrived. */
  private rooms = new Map<string, number>();
  /** Every sesh still kept, with when someone last came in. */
  private kept = new Map<string, number>();
  private signups = 0;
  private max: number;
  private maxKept: number;

  constructor(private ctx: Ctx, env: { MAX_ROOMS?: string; MAX_SESHES?: string }) {
    this.max = Number(env.MAX_ROOMS) > 0 ? Number(env.MAX_ROOMS) : DEFAULT_MAX_ROOMS;
    this.maxKept = Number(env.MAX_SESHES) > 0 ? Number(env.MAX_SESHES) : DEFAULT_MAX_SESHES;
    ctx.blockConcurrencyWhile(async () => {
      for (const [k, at] of Object.entries(SAVED_ROOMS(await ctx.storage.get("rooms")))) this.rooms.set(k, at);
      for (const [k, at] of Object.entries(SAVED_ROOMS(await ctx.storage.get("kept")))) this.kept.set(k, at);
      this.signups = Number(await ctx.storage.get("signups")) || 0;
    });
  }

  async fetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname, now = Date.now();
    for (const [r, at] of this.rooms) if (now - at > LEASE_MS) this.rooms.delete(r);
    for (const [r, at] of this.kept) if (now - at > IDLE_MS && !this.rooms.has(r)) this.kept.delete(r);
    const status = (): Status => ({ open: this.rooms.size, max: this.max, kept: this.kept.size, maxKept: this.maxKept });
    if (req.method === "GET" && path === "/status") return json(status());
    if (req.method === "GET" && path === "/signups") {
      const list = await this.ctx.storage.list<Signup>({ prefix: "s:" });
      return json([...list.values()].sort((a, b) => a.place - b.place));
    }
    if (req.method !== "POST") return json({ error: "not found" }, 404);
    if (path === "/signup") {
      const s = await readJson(req, SIGNUP);
      if (!s) return json({ error: "an email address, please" }, 400);
      const key = `s:${s.email.toLowerCase()}`;
      const had = await this.ctx.storage.get(key);
      if (typeof had === "object" && had !== null && "place" in had && typeof had.place === "number") return json({ place: had.place });
      if (this.signups >= MAX_SIGNUPS) return json({ error: "the list is full too, sorry" }, 503);
      const row: Signup = { email: s.email, room: s.room, at: now, place: ++this.signups };
      await this.ctx.storage.put(key, row);
      await this.ctx.storage.put("signups", this.signups);
      return json({ place: row.place });
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
