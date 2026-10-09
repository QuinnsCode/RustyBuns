// The world: one hunt. On the desktop it runs in-process for whoever clicked
// "Host a LAN game", and guests reach it over ws:// with the join passphrase;
// the host vouches X-User-Id / X-User-Name for each. Online it is the Durable
// Object behind each room code (src/edge/worker.ts vouches instead), and a
// quick play room starts itself on an alarm the Matchmaker sets.
// The Room here is the same one the page runs for single player.
import { Room, TICK_MS } from "../../src/room.ts";
import { TokenBucket } from "../../src/edge/limits.ts";
import { QUICK } from "../../src/edge/match.ts";
import { parseMsg } from "../../src/hunt/game.ts";
import { fetchWeather } from "../../src/weather.ts";

// Provided by workerd and by the Rusty Buns host.
declare const WebSocketPair: { new (): Record<0 | 1, unknown> };

// Views go out at most this often per socket.
const SEND_MS = 66;
const MAX_MESSAGE = 4096;
// Positions come in about 20 a second; anything past this is dropped.
const MSG_RATE = 40, MSG_BURST = 80;

export default class World {
  // The host looks up the park's weather; guests get it in their views.
  private room = new Room(Date.now(), fetchWeather);
  private timer: ReturnType<typeof setInterval> | null = null;
  private sent = new WeakMap<object, { v: number; at: number }>();
  private buckets = new WeakMap<object, TokenBucket>();

  constructor(private ctx: any, private env: any) {}

  async fetch(request: Request): Promise<Response> {
    // Only the Matchmaker gets here: the Worker sends players' requests on /ws.
    if (new URL(request.url).pathname === "/quick") {
      const at = Number(new URL(request.url).searchParams.get("at"));
      if (!Number.isFinite(at)) return new Response("bad start time", { status: 400 });
      await this.ctx.storage.setAlarm(at);
      return new Response(null, { status: 204 });
    }
    if (request.headers.get("Upgrade") !== "websocket") return new Response("websocket only", { status: 400 });
    const id = request.headers.get("X-User-Id");
    if (!id) return new Response("Unauthenticated", { status: 401 });
    const name = request.headers.get("X-User-Name") || "Ranger";
    const host = request.headers.get("X-RB-Principal") !== "guest";
    const now = Date.now();
    if (!this.room.game.join(id, name, now, { host })) return Response.json({ error: "full" }, { status: 503 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as any[];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id });
    this.flush(true);
    this.send(server, id, now);
    if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
    return new Response(null, { status: 101, webSocket: client } as any);
  }

  webSocketMessage(ws: any, raw: string | ArrayBuffer) {
    if (typeof raw !== "string" || raw.length > MAX_MESSAGE) return;
    const now = Date.now();
    let b = this.buckets.get(ws);
    if (!b) { b = new TokenBucket(MSG_RATE, MSG_BURST, now); this.buckets.set(ws, b); }
    if (!b.take(now)) return;
    const { id } = ws.deserializeAttachment() as { id: string };
    let m;
    try { m = parseMsg(JSON.parse(raw)); } catch { return; }
    if (!m) return;
    this.room.handle(id, m, now);
    // Positions stream in all the time; the tick sends views out at its own pace.
    if (m.t !== "pos") this.flush(true);
  }

  /** Quick play's window closed: fill the room out with AI and start, on behalf of whoever hosts it. */
  alarm() {
    const g = this.room.game, host = g.hostId, now = Date.now();
    if (!host || g.phase !== "lobby") return;
    for (let n = g.players.filter((p) => p.online).length; n < QUICK.size; n++) this.room.handle(host, { t: "bot", level: "normal" }, now);
    this.room.handle(host, { t: "start" }, now);
    this.flush(true);
  }

  webSocketClose(ws: any) { this.gone(ws); }
  webSocketError(ws: any) { this.gone(ws); }

  private gone(ws: any) {
    const { id } = (ws.deserializeAttachment() ?? {}) as { id?: string };
    const others = this.open().filter((w) => w !== ws && (w.deserializeAttachment() as any)?.id === id);
    if (id && !others.length) this.room.game.leave(id, Date.now());
    if (!this.open().length && this.timer) { clearInterval(this.timer); this.timer = null; }
    this.flush();
  }

  private tick() {
    this.room.tick(Date.now());
    this.flush();
  }

  private open(): any[] {
    // getWebSockets can still list a closing socket; count open ones only
    return this.ctx.getWebSockets().filter((w: any) => w.readyState === undefined || w.readyState === 1);
  }

  /** Send each socket its own view when the game moved, at most every SEND_MS. */
  private flush(force = false) {
    const now = Date.now();
    const v = this.room.game.version;
    for (const ws of this.open()) {
      const last = this.sent.get(ws);
      if (!force && last && (last.v === v || now - last.at < SEND_MS)) continue;
      const { id } = ws.deserializeAttachment() as { id: string };
      this.send(ws, id, now);
    }
  }

  private send(ws: any, id: string, now: number) {
    try { ws.send(JSON.stringify({ t: "view", view: this.room.game.view(id, now) })); this.sent.set(ws, { v: this.room.game.version, at: now }); } catch {}
  }
}
