// The world: the project lives here. On the desktop the host runs it in-process
// with sqlite storage, so your groove survives a restart. On Cloudflare the same
// class is a Durable Object, so everyone in a room edits one groove live.
// A class with a Durable Object's shape and no base class.
import { apply, sanitize, type Op, type Project } from "../../src/project.ts";
import { TokenBucket } from "../../src/limits.ts";

// Provided by workerd and by the Rusty Buns host.
declare const WebSocketPair: { new (): Record<0 | 1, unknown> };

const SAVE_AFTER_MS = 500;
const MAX_MESSAGE = 256 * 1024;
// A room holds this many sockets; past it an upgrade is refused.
export const MAX_SOCKETS = 32;
// Per socket: a knob drag sends an op per pointer move; a big message costs more.
const MSG_RATE = 120, MSG_BURST = 240, BYTES_PER_TOKEN = 16 * 1024;
// Over budget the socket is closed; the client reconnects and takes the snapshot.
export const CLOSE_FLOOD = 4008;

export default class World {
  private project: Project | null = null;
  private dirty = false;
  private buckets = new WeakMap<object, TokenBucket>();
  // Online only (the Worker says how long): a room left empty this long is deleted.
  // The desktop never sets it, so your own groove stays.
  private idleMs = 0;
  private idleAt = 0;

  constructor(private ctx: any, private env: any) {
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
    if (this.open().length >= MAX_SOCKETS) return new Response("This room is full", { status: 503 });
    const idle = Number(request.headers.get("X-Room-Idle-Ms"));
    if (idle > 0) this.idleMs = idle;
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as any[];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId });
    server.send(JSON.stringify({ t: "snapshot", project: this.project }));
    this.broadcastPeers();
    return new Response(null, { status: 101, webSocket: client } as any);
  }

  webSocketMessage(ws: any, raw: string | ArrayBuffer) {
    if (typeof raw !== "string" || raw.length > MAX_MESSAGE) return;
    const now = Date.now();
    let b = this.buckets.get(ws);
    if (!b) this.buckets.set(ws, (b = new TokenBucket(MSG_RATE, MSG_BURST, now)));
    if (!b.take(now, 1 + Math.floor(raw.length / BYTES_PER_TOKEN))) { try { ws.close(CLOSE_FLOOD, "too many messages"); } catch {} return; }
    let msg: { t: string; op?: Op; project?: unknown };
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.t === "init") {
      // first client in an empty world seeds it; later ones get the snapshot instead
      if (this.project) { ws.send(JSON.stringify({ t: "snapshot", project: this.project })); return; }
      const p = sanitize(msg.project);
      if (!p) return;
      this.project = p;
      this.save();
      this.broadcast({ t: "op", op: { t: "replace", project: p } }, ws);
      return;
    }
    if (msg.t !== "op" || !msg.op || !this.project) return;
    const next = apply(this.project, msg.op);
    if (next === this.project) return;
    this.project = next;
    this.save();
    // rebroadcast the sanitized result for replace, the op itself otherwise
    const op = msg.op.t === "replace" ? { t: "replace", project: next } : msg.op;
    this.broadcast({ t: "op", op }, ws);
  }

  webSocketClose(ws: any) { this.left(ws); }
  webSocketError(ws: any) { this.left(ws); }

  private left(ws: any) {
    this.broadcastPeers();
    if (this.open().some((w) => w !== ws)) return;
    // the last one out: save now, and start the idle clock
    void this.alarm(true);
  }

  async alarm(lastOut = false) {
    const s = this.ctx.storage;
    if (this.dirty && this.project) {
      this.dirty = false;
      await s.put("project", this.project);
    }
    if (!this.idleMs || this.open().length) return;
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

  private broadcast(m: unknown, except?: unknown) {
    const s = JSON.stringify(m);
    for (const ws of this.ctx.getWebSockets()) if (ws !== except) try { ws.send(s); } catch {}
  }

  private open(): any[] {
    // getWebSockets can still list a closing socket; count open ones only
    return this.ctx.getWebSockets().filter((w: any) => w.readyState === undefined || w.readyState === 1);
  }

  private broadcastPeers() {
    this.broadcast({ t: "peers", n: this.open().length });
  }
}
