// The world: the project lives here. On the desktop the host runs it in-process
// with sqlite storage, so your groove survives a restart. On Cloudflare the same
// class is a Durable Object, so everyone in a room edits one groove live and hears
// each other play, with a copy in an R2 bucket in case the Durable Object is reset.
// A class with a Durable Object's shape and no base class.
import { apply, decodeClient, sanitize, type Full, type Project, type ServerMsg } from "../../src/project.ts";
import { Sockets, type RoomCtx, type RoomSocket } from "@rustybuns/util/room";

const SAVE_AFTER_MS = 500;
// A room holds this many sockets (ROOM_SEATS online); past it a socket is told so and closed.
export const MAX_SOCKETS = 32;
// Over budget the socket is closed; the client reconnects and takes the snapshot.
export const CLOSE_FLOOD = 4008;
// No seat in this room, or no room free on the edge: the page stops trying and offers the sign-up list.
export const CLOSE_FULL = 4009;
// Per socket: a knob drag sends an op per pointer move; a big message costs more.
const BYTES_PER_TOKEN = 16 * 1024;
const LIMITS = {
  maxBytes: 256 * 1024, rate: 120, burst: 240,
  cost: (bytes: number) => 1 + Math.floor(bytes / BYTES_PER_TOKEN),
  onFlood: (ws: RoomSocket) => { try { ws.close(CLOSE_FLOOD, "too many messages"); } catch { /* closing */ } },
};

interface Stub { fetch(url: string, init?: RequestInit): Promise<Response> }
interface Bucket {
  get(k: string): Promise<{ text(): Promise<string> } | null>;
  put(k: string, v: string): Promise<unknown>;
  delete(k: string): Promise<unknown>;
}
// The bucket copy is a few minutes behind at worst during a jam, and current once the room empties.
export const BACKUP_EVERY_MS = 5 * 60 * 1000;
const backupKey = (room: string) => `sesh/${room}.json`;
/** The bindings the edge hands a room (rustybuns.config.ts). The desktop host hands it none. */
export interface WorldEnv {
  LOBBY?: { idFromName(n: string): unknown; get(id: unknown): Stub };
  /** Every sesh's groove, copied out of the Durable Object, so a reset one gets it back. */
  BACKUP?: Bucket;
  ROOM_SEATS?: string;
}
/** `peer` numbers a socket for the live line; 0 is one that was turned away. */
type Seat = { userId: string; peer: number; room: string };

interface Ctx extends RoomCtx {
  storage: { get(k: string): Promise<unknown>; put(k: string, v: unknown): Promise<void>; delete(k: string): Promise<unknown>; setAlarm(at: number): Promise<void>; deleteAlarm(): Promise<void> };
  blockConcurrencyWhile(f: () => Promise<void>): void;
}

export default class World {
  private project: Project | null = null;
  private dirty = false;
  private sockets: Sockets<Seat, ServerMsg>;
  private lobby: Stub | null;
  private bucket: Bucket | null;
  private seats: number;
  /** Online, the room's name (the Worker says it), which names its backup. */
  private room = "";
  private backupDirty = false;
  private backedUpAt = 0;
  // Online only (the Worker says how long): a room left empty this long is deleted.
  // The desktop never sets it, so your own groove stays.
  private idleMs = 0;
  private idleAt = 0;

  constructor(private ctx: Ctx, env: WorldEnv = {}) {
    this.sockets = new Sockets(ctx, LIMITS);
    this.lobby = env.LOBBY ? env.LOBBY.get(env.LOBBY.idFromName("lobby")) : null;
    this.bucket = env.BACKUP ?? null;
    this.seats = Number(env.ROOM_SEATS) > 0 ? Number(env.ROOM_SEATS) : MAX_SOCKETS;
    ctx.blockConcurrencyWhile(async () => {
      this.project = sanitize(await ctx.storage.get("project"));
      this.room = String((await ctx.storage.get("room")) ?? "");
      this.idleMs = Number(await ctx.storage.get("idleMs")) || 0;
      this.idleAt = Number(await ctx.storage.get("idleAt")) || 0;
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("websocket only", { status: 400 });
    const userId = request.headers.get("X-User-Id");
    if (!userId) return new Response("Unauthenticated", { status: 401 });
    const room = request.headers.get("X-Room") ?? "";
    if (this.sockets.open().length >= this.seats) return this.refuse(userId, "room");
    if (this.lobby && !(await this.admitted(this.lobby, room))) return this.refuse(userId, "rooms");
    const idle = Number(request.headers.get("X-Room-Idle-Ms"));
    if (idle > 0) this.idleMs = idle;
    if (room && room !== this.room) { this.room = room; await this.ctx.storage.put("room", room); }
    if (!this.project && this.bucket && room) await this.restore(this.bucket, room);
    const { server, response } = this.sockets.upgrade({ userId, peer: 1 + Math.floor(Math.random() * 2 ** 31), room });
    this.sockets.send(server, { t: "snapshot", project: this.project });
    this.broadcastPeers();
    return response;
  }

  /** Storage came back empty but the bucket has the groove: the Durable Object was reset, not the sesh. */
  private async restore(bucket: Bucket, room: string) {
    try {
      const got = await bucket.get(backupKey(room));
      const p = got && sanitize(JSON.parse(await got.text()));
      if (p && !this.project) { this.project = p; this.save(); }
    } catch { /* no copy, or a bad one: the room starts empty */ }
  }

  /** A browser can't read why an upgrade failed, so the answer goes down the socket before it closes. */
  private refuse(userId: string, why: Full): Response {
    const { server, response } = this.sockets.upgrade({ userId, peer: 0, room: "" });
    this.sockets.send(server, { t: "full", why });
    try { server.close(CLOSE_FULL, why === "room" ? "this room is full" : "every room is taken"); } catch { /* closing */ }
    return response;
  }

  /** Online, the Lobby says whether a room may open (or stay open: each arrival renews its lease). */
  private async admitted(lobby: Stub, room: string): Promise<boolean> {
    try {
      const r = await lobby.fetch("https://lobby/admit", { method: "POST", body: JSON.stringify({ room }) });
      const v: unknown = await r.json();
      return typeof v === "object" && v !== null && "ok" in v && v.ok === true;
    } catch { return true; }                         // a Lobby hiccup doesn't lock everyone out
  }

  webSocketMessage(ws: RoomSocket, raw: string | ArrayBuffer) {
    const frame = this.sockets.frame(ws, raw);
    const msg = frame && decodeClient(frame.value);
    if (!msg) return;
    if (msg.t === "live") {
      // the live line: in the order it came, to everyone else, kept nowhere
      const peer = this.sockets.who(ws)?.peer;
      if (peer) this.broadcast({ t: "live", from: peer, e: msg.e }, ws);
      return;
    }
    if (msg.t === "init") {
      // first client in an empty world seeds it; later ones get the snapshot instead
      if (this.project) { this.sockets.send(ws, { t: "snapshot", project: this.project }); return; }
      this.project = msg.project;
      this.save();
      this.broadcast({ t: "op", op: { t: "replace", project: msg.project } }, ws);
      return;
    }
    if (msg.t !== "op" || !this.project) return;
    const next = apply(this.project, msg.op);
    if (next === this.project) return;
    this.project = next;
    this.save();
    // rebroadcast the sanitized result for replace, the op itself otherwise
    const op = msg.op.t === "replace" ? { t: "replace" as const, project: next } : msg.op;
    this.broadcast({ t: "op", op }, ws);
  }

  webSocketClose(ws: RoomSocket) { this.left(ws); }
  webSocketError(ws: RoomSocket) { this.left(ws); }

  private left(ws: RoomSocket) {
    const seat = this.sockets.who(ws);
    if (!seat?.peer) return;                         // turned away: never counted in
    this.broadcast({ t: "gone", from: seat.peer }, ws);
    this.broadcastPeers();
    if (this.sockets.open().some((w) => w !== ws)) return;
    // the last one out: save now, start the idle clock, and give the room's slot back
    void this.alarm(true);
    if (this.lobby) void this.lobby.fetch("https://lobby/release", { method: "POST", body: JSON.stringify({ room: seat.room }) }).catch(() => {});
  }

  async alarm(lastOut = false) {
    const s = this.ctx.storage;
    if (this.dirty && this.project) {
      this.dirty = false;
      await s.put("project", this.project);
    }
    if (this.bucket && this.room && this.project && this.backupDirty && (lastOut || Date.now() - this.backedUpAt >= BACKUP_EVERY_MS)) {
      this.backupDirty = false;
      this.backedUpAt = Date.now();
      try { await this.bucket.put(backupKey(this.room), JSON.stringify(this.project)); } catch { this.backupDirty = true; }
    }
    if (!this.idleMs || this.sockets.open().length) return;
    if (!lastOut && this.idleAt && Date.now() >= this.idleAt) {
      // nobody came back: the room goes, groove and all
      await s.deleteAlarm();
      for (const k of ["project", "idleMs", "idleAt", "room"]) await s.delete(k);
      if (this.bucket && this.room) await this.bucket.delete(backupKey(this.room)).catch(() => {});
      this.project = null;
      this.idleAt = 0;
      return;
    }
    if (!this.project) return;                       // nothing stored, nothing to clean up
    if (lastOut || !this.idleAt) {
      this.idleAt = Date.now() + this.idleMs;
      await s.put("idleMs", this.idleMs);
      await s.put("idleAt", this.idleAt);
    }
    await s.setAlarm(this.idleAt);
  }

  private save() {
    this.backupDirty = true;
    if (this.dirty) return;
    this.dirty = true;
    void this.ctx.storage.setAlarm(Date.now() + SAVE_AFTER_MS);
  }

  private broadcast(m: ServerMsg, except?: RoomSocket) { this.sockets.broadcast(m, except); }

  private broadcastPeers() {
    this.broadcast({ t: "peers", n: this.sockets.open().length });
  }
}
