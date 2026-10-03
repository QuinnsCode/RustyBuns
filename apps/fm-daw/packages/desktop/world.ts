// The world: the project lives here. On the desktop the host runs it in-process
// with sqlite storage, so your groove survives a restart. On Cloudflare the same
// class is a Durable Object, so everyone in a room edits one groove live.
// A class with a Durable Object's shape and no base class.
import { apply, sanitize, type Op, type Project } from "../../src/project.ts";

// Provided by workerd and by the Rusty Buns host.
declare const WebSocketPair: { new (): Record<0 | 1, unknown> };

const SAVE_AFTER_MS = 500;
const MAX_MESSAGE = 256 * 1024;

export default class World {
  private project: Project | null = null;
  private dirty = false;

  constructor(private ctx: any, private env: any) {
    ctx.blockConcurrencyWhile(async () => {
      this.project = sanitize(await ctx.storage.get("project"));
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("websocket only", { status: 400 });
    const userId = request.headers.get("X-User-Id");
    if (!userId) return new Response("Unauthenticated", { status: 401 });
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

  webSocketClose() { this.broadcastPeers(); if (this.dirty) void this.alarm(); }
  webSocketError() { this.broadcastPeers(); }

  async alarm() {
    if (!this.dirty || !this.project) return;
    this.dirty = false;
    await this.ctx.storage.put("project", this.project);
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

  private broadcastPeers() {
    // getWebSockets can still list a closing socket; count open ones only
    const open = this.ctx.getWebSockets().filter((w: any) => w.readyState === undefined || w.readyState === 1);
    this.broadcast({ t: "peers", n: open.length });
  }
}
