import { test, expect } from "bun:test";
import { serve, durableObject, type LocalDurableObjectState } from "../src/index.ts";

// Shaped like a real hibernating DO: constructor gate, WebSocketPair, 101,
// webSocketMessage delivery, storage, alarm, getWebSockets broadcast.
class World {
  private tick = 0;
  private restored = false;
  constructor(private ctx: LocalDurableObjectState, private env: { KV_LIKE: Map<string, string> }) {
    ctx.blockConcurrencyWhile(async () => {
      this.tick = (await ctx.storage.get<number>("tick")) ?? 0;
      this.restored = true;
    });
  }
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("world DO — websocket only", { status: 400 });
    const userId = request.headers.get("X-User-Id");
    if (!userId) return new Response("Unauthenticated", { status: 401 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as any[];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId });
    server.send(JSON.stringify({ t: "hello", tick: this.tick, restored: this.restored }));
    await this.ctx.storage.setAlarm(Date.now() + 20);
    return new Response(null, { status: 101, webSocket: client } as any);
  }
  webSocketMessage(ws: any, m: string | ArrayBuffer) {
    const a = ws.deserializeAttachment();
    this.tick++;
    void this.ctx.storage.put("tick", this.tick);
    if (typeof m === "string") for (const s of this.ctx.getWebSockets()) s.send(`${a.userId}:${m}:${this.tick}`);
    else ws.send(new Uint8Array(m as ArrayBuffer).reverse());
  }
  webSocketClose(ws: any) { this.env.KV_LIKE.set("closed", ws.deserializeAttachment().userId); }
  alarm() { this.env.KV_LIKE.set("alarm", "fired"); }
}

test("in-process DO: upgrade, hibernation delivery, broadcast, storage, alarm", async () => {
  const env = { KV_LIKE: new Map<string, string>() };
  const WORLD = durableObject(World, env);
  const shell = serve<{ WORLD: typeof WORLD }>({});
  // the "worker": routes /ws to the DO exactly like a CF worker would
  shell.mount({
    async fetch(req, e) {
      const u = new URL(req.url);
      if (u.pathname === "/ws") {
        const stub = e.WORLD.get(e.WORLD.idFromName(u.searchParams.get("world") ?? "veil"));
        const h = new Headers(req.headers); h.set("X-User-Id", u.searchParams.get("u") ?? "");
        return stub.fetch(new Request(req.url, { headers: h }));
      }
      return new Response("nope", { status: 404 });
    },
  }, { WORLD });

  const wsUrl = shell.url.replace("http", "ws") + "/ws?world=veil";
  const open = (u: string) => new Promise<WebSocket & { msgs: string[] }>((res) => {
    const ws = new WebSocket(`${wsUrl}&u=${u}`) as any; ws.msgs = [];
    ws.onmessage = (m: MessageEvent) => ws.msgs.push(typeof m.data === "string" ? m.data : `bin:${new Uint8Array(m.data as ArrayBuffer).join(",")}`);
    ws.onopen = () => setTimeout(() => res(ws), 30);
  });

  const a = await open("ada"), b = await open("bob");
  expect(a.msgs[0]).toContain('"t":"hello"');
  expect(JSON.parse(a.msgs[0]!).restored).toBe(true);

  a.send("move");
  await Bun.sleep(30);
  expect(a.msgs).toContain("ada:move:1");
  expect(b.msgs).toContain("ada:move:1");   // broadcast via getWebSockets

  a.binaryType = "arraybuffer";
  a.send(new Uint8Array([1, 2, 3]));
  await Bun.sleep(30);
  expect(a.msgs).toContain("bin:3,2,1");   // binary path, ws.send back

  expect(env.KV_LIKE.get("alarm")).toBe("fired");

  b.close();
  await Bun.sleep(30);
  expect(env.KV_LIKE.get("closed")).toBe("bob");   // webSocketClose delivered

  // unauthenticated upgrade -> the DO's own 401, passed straight through
  const r = await fetch(shell.url + "/ws?world=veil", { headers: { Upgrade: "websocket" } });
  expect(r.status).toBe(401);

  a.close();
  await shell.stop();
});
