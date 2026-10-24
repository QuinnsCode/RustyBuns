// One shared globe per room: a Durable Object that relays where everyone points and what the lead is looking at.
// The same class is a Cloudflare Durable Object and, on the desktop, Rusty Buns' local twin. It keeps no globe of
// its own: the lead's camera and dataset are the room's state, held so a late joiner lands where everyone else is.

// Provided by workerd and by the Rusty Buns host.
declare const WebSocketPair: { new (): Record<0 | 1, Socket> };

export type Socket = {
  send(m: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(v: unknown): void;
  deserializeAttachment(): unknown;
};
type Ctx = {
  acceptWebSocket(ws: Socket): void;
  getWebSockets(): Socket[];
  storage: { get<T>(k: string): Promise<T | undefined>; put(k: string, v: unknown): Promise<void> };
  blockConcurrencyWhile(f: () => Promise<void>): void;
};

export type Peer = { id: string; name: string; color: string };
/** The lead's view, as MapLibre takes it: centre [lng, lat], zoom, bearing, pitch. */
export type Cam = { c: [number, number]; z: number; b: number; p: number };

export const MAX_PEERS = 64;
const MAX_MESSAGE = 512;
const COLORS = ["#f97316", "#22c55e", "#3b82f6", "#e11d48", "#a855f7", "#14b8a6", "#eab308", "#ec4899"];

export const clean = (s: string | null | undefined, max: number) => (s ?? "").replace(/\p{C}/gu, "").trim().slice(0, max);
const num = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const lngLat = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && num(v[0], -540, 540) && num(v[1], -90, 90);

/** A camera from a message, or null if any part of it is off the globe. */
export function readCam(m: Record<string, unknown>): Cam | null {
  if (!lngLat(m.c) || !num(m.z, 0, 24) || !num(m.b, -360, 360) || !num(m.p, 0, 90)) return null;
  return { c: [m.c[0], m.c[1]], z: m.z as number, b: m.b as number, p: m.p as number };
}

export class SphereRoom {
  private lead: string | null = null;
  private cam: Cam | null = null;
  private ds: string | null = null;

  constructor(private ctx: Ctx, _env: unknown) {
    ctx.blockConcurrencyWhile(async () => {
      this.lead = (await ctx.storage.get<string>("lead")) ?? null;
      this.ds = (await ctx.storage.get<string>("ds")) ?? null;
    });
  }

  private peers(): Array<{ ws: Socket; peer: Peer }> {
    return this.ctx.getWebSockets().flatMap((ws) => {
      const peer = ws.deserializeAttachment() as Peer | null;
      return peer ? [{ ws, peer }] : [];
    });
  }

  private broadcast(msg: object, except?: Socket) {
    const s = JSON.stringify(msg);
    for (const { ws } of this.peers()) if (ws !== except) try { ws.send(s); } catch { /* closing; its close event cleans up */ }
  }

  private async setLead(id: string | null) {
    this.lead = id;
    if (!id) this.cam = null;
    await this.ctx.storage.put("lead", id);
    this.broadcast({ t: "lead", id });
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("websocket only", { status: 400 });
    const peers = this.peers();
    if (peers.length >= MAX_PEERS) return new Response("this globe is full", { status: 503 });
    // a lead saved before a restart whose socket didn't come back: nobody can follow a ghost
    if (this.lead && !peers.some((p) => p.peer.id === this.lead)) await this.setLead(null);
    const id = crypto.randomUUID().slice(0, 8);
    const name = clean(new URL(req.url).searchParams.get("name"), 24) || `Guest ${id.slice(0, 4)}`;
    const peer: Peer = { id, name, color: COLORS[parseInt(id.slice(0, 6), 16) % COLORS.length] };
    const [client, server] = Object.values(new WebSocketPair()) as Socket[];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(peer);
    server.send(JSON.stringify({ t: "hello", you: peer, peers: peers.map((p) => p.peer), lead: this.lead, cam: this.cam, ds: this.ds }));
    this.broadcast({ t: "join", ...peer }, server);
    return new Response(null, { status: 101, webSocket: client } as ResponseInit);
  }

  async webSocketMessage(ws: Socket, raw: string | ArrayBuffer) {
    const peer = ws.deserializeAttachment() as Peer | null;
    if (!peer || typeof raw !== "string" || raw.length > MAX_MESSAGE) return;
    let m: Record<string, unknown>;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== "object") return;
    const from = peer.id;
    switch (m.t) {
      case "ptr": // anyone's pointer, or null when it leaves the globe
        if (m.c === null || lngLat(m.c)) this.broadcast({ t: "ptr", from, c: m.c }, ws);
        return;
      case "cam": { // only the lead steers
        const cam = readCam(m);
        if (from !== this.lead || !cam) return;
        this.cam = cam;
        this.broadcast({ t: "cam", from, ...cam }, ws);
        return;
      }
      case "ds": { // the lead's dataset: an id TerraViz's own loader resolves, or null for none
        const ds = m.id === null ? null : clean(typeof m.id === "string" ? m.id : "", 128) || undefined;
        if (from !== this.lead || ds === undefined) return;
        this.ds = ds;
        await this.ctx.storage.put("ds", ds);
        this.broadcast({ t: "ds", from, id: ds }, ws);
        return;
      }
      case "lead": // take the wheel: a classroom, not a contest, so anyone may
        if (this.lead !== from) await this.setLead(from);
        return;
      case "unlead":
        if (this.lead === from) await this.setLead(null);
        return;
    }
  }

  async webSocketClose(ws: Socket) {
    const peer = ws.deserializeAttachment() as Peer | null;
    ws.serializeAttachment(null);
    try { ws.close(1000, "bye"); } catch { /* already closed */ }
    if (!peer) return;
    this.broadcast({ t: "leave", id: peer.id }, ws);
    if (this.lead === peer.id) await this.setLead(null);
  }

  webSocketError(ws: Socket) { return this.webSocketClose(ws); }
}
