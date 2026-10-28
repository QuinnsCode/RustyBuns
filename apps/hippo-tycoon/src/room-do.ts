// The world: one Room per Durable Object. A class with a Durable Object's shape
// and no base class, so the same file is the Cloudflare DO and (re-exported from
// packages/desktop/world.ts) the Rusty Buns in-process world. It does only what
// the platform owns: the upgrade handshake and handing sockets to the Room.
import { Room } from "./engine/room.ts";
import { Sockets, type RoomCtx, type RoomSocket } from "@rustybuns/util/room";
import type { EngineCtx } from "./engine/ports.ts";

const clean = (s: string | null, max: number) => (s ?? "").replace(/\p{C}/gu, "").trim().slice(0, max);

export class World {
  /**
   * The hippo_sim module every room steps its rounds in, or null for the
   * TypeScript engine. Set by the entry that has it: src/edge.ts on Cloudflare
   * (bundled), packages/desktop/world.ts on the desktop (embedded).
   */
  static sim: WebAssembly.Module | null = null;
  private room: Room;
  private sockets: Sockets<null>;

  constructor(ctx: RoomCtx & EngineCtx & { blockConcurrencyWhile(f: () => Promise<void>): void }, _env: unknown) {
    this.room = new Room(ctx, { sim: World.sim, report: (where, err) => console.error(`[hippo-tycoon ${where}]`, err) });
    this.sockets = new Sockets(ctx);
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
    // The Room writes the socket's attachment itself at hello, so it is accepted with none.
    const { server, response } = this.sockets.upgrade(null);
    this.room.onConnect(server, uid, name, clean(request.headers.get("X-Room"), 16));
    return response;
  }

  webSocketMessage(ws: RoomSocket, m: string | ArrayBuffer) { this.room.webSocketMessage(ws, m); }
  webSocketClose(ws: RoomSocket) { this.room.webSocketClose(ws); }
  webSocketError(ws: RoomSocket) { this.room.webSocketError(ws); }
  alarm() { this.room.alarm(); }
}

export default World;
