// The world: the project lives here. On the desktop the host runs it in-process
// with sqlite storage, so your groove survives a restart. On Cloudflare the same
// class is a Durable Object, so everyone in a room edits one groove live.
// A class with a Durable Object's shape and no base class.
import { apply, decodeClient, sanitize, type Project, type ServerMsg } from "../../src/project.ts";
import { Sockets, type RoomCtx, type RoomSocket } from "@rustybuns/util/room";

const SAVE_AFTER_MS = 500;
// A room holds this many sockets; past it an upgrade is refused.
export const MAX_SOCKETS = 32;
// Over budget the socket is closed; the client reconnects and takes the snapshot.
export const CLOSE_FLOOD = 4008;
// Per socket: a knob drag sends an op per pointer move; a big message costs more.
const BYTES_PER_TOKEN = 16 * 1024;
const LIMITS = {
  maxBytes: 256 * 1024, rate: 120, burst: 240,
  cost: (bytes: number) => 1 + Math.floor(bytes / BYTES_PER_TOKEN),
  onFlood: (ws: RoomSocket) => { try { ws.close(CLOSE_FLOOD, "too many messages"); } catch { /* closing */ } },
};

interface Ctx extends RoomCtx {
  storage: { get(k: string): Promise<unknown>; put(k: string, v: unknown): Promise<void>; delete(k: string): Promise<unknown>; setAlarm(at: number): Promise<void>; deleteAlarm(): Promise<void> };
  blockConcurrencyWhile(f: () => Promise<void>): void;
}

export default class World {
  private project: Project | null = null;
  private dirty = false;
  private sockets: Sockets<{ userId: string }, ServerMsg>;
  // Online only (the Worker says how long): a room left empty this long is deleted.
  // The desktop never sets it, so your own groove stays.
  private idleMs = 0;
  private idleAt = 0;

  constructor(private ctx: Ctx, _env: unknown) {
    this.sockets = new Sockets(ctx, LIMITS);
    ctx.blockConcurrencyWhile(async () => {
      this.project = sanitize(await ctx.storage.get("project"));
      this.idleMs = Number(await ctx.storage.get("idleMs")) || 0;
      this.idleAt = Number(await ctx.storage.get("idleAt")) || 0;
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("websocket only", { status: 400 });
    const userId = request.headers.get("X-User-Id");
    if (!userId) return new Response("Unauthenticated", { status: 401 });
    if (this.sockets.open().length >= MAX_SOCKETS) return new Response("This room is full", { status: 503 });
    const idle = Number(request.headers.get("X-Room-Idle-Ms"));
    if (idle > 0) this.idleMs = idle;
    const { server, response } = this.sockets.upgrade({ userId });
    this.sockets.send(server, { t: "snapshot", project: this.project });
    this.broadcastPeers();
    return response;
  }

  webSocketMessage(ws: RoomSocket, raw: string | ArrayBuffer) {
    const frame = this.sockets.frame(ws, raw);
    const msg = frame && decodeClient(frame.value);
    if (!msg) return;
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
    this.broadcastPeers();
    if (this.sockets.open().some((w) => w !== ws)) return;
    // the last one out: save now, and start the idle clock
    void this.alarm(true);
  }

  async alarm(lastOut = false) {
    const s = this.ctx.storage;
    if (this.dirty && this.project) {
      this.dirty = false;
      await s.put("project", this.project);
    }
    if (!this.idleMs || this.sockets.open().length) return;
    if (!lastOut && this.idleAt && Date.now() >= this.idleAt) {
      // nobody came back: the room goes, groove and all
      await s.deleteAlarm();
      for (const k of ["project", "idleMs", "idleAt"]) await s.delete(k);
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
    if (this.dirty) return;
    this.dirty = true;
    void this.ctx.storage.setAlarm(Date.now() + SAVE_AFTER_MS);
  }

  private broadcast(m: ServerMsg, except?: RoomSocket) { this.sockets.broadcast(m, except); }

  private broadcastPeers() {
    this.broadcast({ t: "peers", n: this.sockets.open().length });
  }
}
