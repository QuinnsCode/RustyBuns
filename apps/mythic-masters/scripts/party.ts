// The edge for walking together (#3663), on this machine: the real Worker (src/edge/worker.ts) and the real Region
// Durable Object, on Bun's own WebSockets, with a meter on every room. The journey test, the cost model
// (scripts/cost.ts) and a dev session all use it:
//
//   bun scripts/party.ts           serves /ws on :8790; `bun run dev` proxies the page's /ws here (vite.config.ts)
//
// What it stands in for: workerd's WebSocketPair and hibernation API (acceptWebSocket, getWebSockets, attachments).
// Attachments are cloned like workerd serialises them, so a Region that leaned on live object references would fail here too.
import type { ServerWebSocket } from "bun";
import type { RoomSocket } from "@rustybuns/util/room";
import worker, { Region } from "../src/edge/worker.ts";

/** How long a Durable Object with only hibernatable sockets stays in memory after its last event before it sleeps. */
export const IDLE_MS = 10_000;

/** One room's traffic: what Cloudflare bills a Durable Object for. */
export interface Meter { joins: number; inbound: number; outbound: number; inBytes: number; outBytes: number; awakeMs: number; lastAt: number | null }
const meter = (): Meter => ({ joins: 0, inbound: 0, outbound: 0, inBytes: 0, outBytes: 0, awakeMs: 0, lastAt: null });

/** Awake from an event until IDLE_MS of quiet: a gap shorter than that is billed whole, a longer one only IDLE_MS of it. */
function wake(m: Meter, now: number) {
  if (m.lastAt !== null) m.awakeMs += Math.min(now - m.lastAt, IDLE_MS);
  m.lastAt = now;
}

class Sock implements RoomSocket {
  readyState = 1;
  ws: ServerWebSocket<Bound> | null = null;
  private held: string[] = [];
  private att: unknown = null;
  constructor(private m: Meter | null = null) {}
  send(d: string | ArrayBuffer | Uint8Array) {
    if (typeof d !== "string") return;
    if (this.m) { this.m.outbound++; this.m.outBytes += d.length; }
    if (this.ws) this.ws.send(d); else this.held.push(d);
  }
  close(code = 1000, reason = "") { this.readyState = 3; this.ws?.close(code, reason); }
  serializeAttachment(v: unknown) { this.att = structuredClone(v); }
  deserializeAttachment() { return this.att; }
  bind(ws: ServerWebSocket<Bound>) { this.ws = ws; for (const d of this.held) ws.send(d); this.held = []; }
}
interface Bound { sock: Sock; room: Room }
interface Room { name: string; obj: Region; socks: Sock[]; m: Meter }

/** The pair the next upgrade makes, taken by the adapter right after the Region returns its 101. */
let made: Sock[] = [];
let meterFor: Meter | null = null;
const g: Record<string, unknown> = globalThis;
g.WebSocketPair = class { 0: Sock; 1: Sock; constructor() { this[0] = new Sock(); this[1] = new Sock(meterFor); made = [this[0], this[1]]; } };

export function serveParty(port = 0) {
  const rooms = new Map<string, Room>();
  const last: { room: Room | null } = { room: null };
  /** The room the Worker just routed to (read through a call, so the null set before the await doesn't narrow it). */
  const routed = (): Room | null => last.room;
  const REGION = {
    idFromName: (n: string) => n,
    get: (id: unknown) => {
      const name = String(id);
      let r = rooms.get(name);
      if (!r) {
        const socks: Sock[] = [];
        r = { name, socks, m: meter(), obj: new Region({ acceptWebSocket: (ws) => { if (ws instanceof Sock) socks.push(ws); }, getWebSockets: () => socks.filter((s) => s.readyState === 1) }, {}) };
        rooms.set(name, r);
      }
      const room = r;
      return { fetch: (req: Request) => { last.room = room; meterFor = room.m; return room.obj.fetch(req); } };
    },
  };
  const env = { ASSETS: { fetch: async () => new Response("the page is served by vite here", { status: 404 }) }, REGION };
  // One upgrade at a time, so the pair a Region made is the one this request gets.
  let line: Promise<unknown> = Promise.resolve();

  const server = Bun.serve<Bound>({
    port,
    fetch(req, srv) {
      const run = line.then(async () => {
        last.room = null; made = [];
        const res = await worker.fetch(req, env);
        if (res.status !== 101) return res;
        const room = routed(), sock = made[1];
        if (!room || !sock) return new Response("no socket", { status: 500 });
        room.m.joins++; wake(room.m, Date.now());
        return srv.upgrade(req, { data: { sock, room } }) ? undefined : new Response("upgrade failed", { status: 400 });
      });
      line = run.catch(() => undefined);
      return run;
    },
    websocket: {
      open(ws) { ws.data.sock.bind(ws); },
      message(ws, msg) {
        const { sock, room } = ws.data, text = typeof msg === "string" ? msg : new TextDecoder().decode(msg);
        room.m.inbound++; room.m.inBytes += text.length; wake(room.m, Date.now());
        room.obj.webSocketMessage(sock, text);
      },
      close(ws) {
        const { sock, room } = ws.data;
        sock.readyState = 3; wake(room.m, Date.now());
        room.obj.webSocketClose(sock);
      },
    },
  });
  return {
    url: `ws://localhost:${server.port}`,
    rooms: () => [...rooms.values()].map((r) => ({ name: r.name, open: r.socks.filter((s) => s.readyState === 1).length, m: { ...r.m } })),
    stop: () => server.stop(true),
  };
}

if (import.meta.main) {
  const p = serveParty(Number(process.argv[2]) || 8790);
  console.log(`walking together: ${p.url}/ws (open the world with ?room=TEST1 in two tabs of \`bun run dev\`)`);
}
