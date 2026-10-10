// The world: one Room per Durable Object. A class with a Durable Object's shape
// and no base class, so the same file is the Cloudflare DO and (re-exported from
// packages/desktop/world.ts) the Rusty Buns in-process world. It does only what
// the platform owns: the upgrade handshake and handing sockets to the Room.
import { Room } from "./engine/room.ts";

// Provided by workerd and by the Rusty Buns host.
declare const WebSocketPair: { new (): Record<0 | 1, any> };

const clean = (s: string | null, max: number) => (s ?? "").replace(/\p{C}/gu, "").trim().slice(0, max);

export class World {
  private room: Room;

  constructor(private ctx: any, _env: unknown) {
    this.room = new Room(ctx, { report: (where, err) => console.error(`[hippo-tycoon ${where}]`, err) });
    ctx.blockConcurrencyWhile(() => this.room.restore());
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("websocket only", { status: 400 });
    // The shell vouches identity in these headers; a message body never can.
    const uid = request.headers.get("X-User-Id");
    if (!uid) return new Response("Unauthenticated", { status: 401 });
    // The desktop host's own page (principal "host", which only the host's shell
    // sets) names its hippo from the menu; the vouched name is the OS username.
    const own = request.headers.get("X-RB-Principal") === "host" ? clean(new URL(request.url).searchParams.get("name"), 24) : "";
    // past every seat and the gallery, refuse before accepting: a socket never said hello still costs
    if (!this.room.admits(uid)) return new Response("This room is full", { status: 503 });
    const name = own || clean(request.headers.get("X-User-Name"), 24) || "Tycoon";
    const [client, server] = Object.values(new WebSocketPair()) as any[];
    this.ctx.acceptWebSocket(server);
    this.room.onConnect(server, uid, name, clean(request.headers.get("X-Room"), 16));
    return new Response(null, { status: 101, webSocket: client } as ResponseInit);
  }

  webSocketMessage(ws: any, m: string | ArrayBuffer) { this.room.webSocketMessage(ws, m); }
  webSocketClose(ws: any) { this.room.webSocketClose(ws); }
  webSocketError(ws: any) { this.room.webSocketError(ws); }
  alarm() { this.room.alarm(); }
}

export default World;
