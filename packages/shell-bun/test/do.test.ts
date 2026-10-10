import { test, expect } from "bun:test";
import { serve, durableObject, type LocalDurableObjectState } from "../src/index.ts";

declare const WebSocketPair: { new (): Record<0 | 1, unknown> };

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

// Room with tags and an in-memory counter that only storage carries across eviction.
class Tagged {
  boots: number;
  mem = 0;
  closes: [string, number, boolean][] = [];
  constructor(private ctx: LocalDurableObjectState, private env: { log: Tagged[] }) {
    env.log.push(this);
    this.boots = env.log.length;
    ctx.blockConcurrencyWhile(async () => { this.mem = (await ctx.storage.get<number>("n")) ?? 0; });
  }
  async fetch(request: Request): Promise<Response> {
    const team = new URL(request.url).searchParams.get("team")!;
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as any[];
    this.ctx.acceptWebSocket(server, [team, "all"]);
    server.serializeAttachment({ team });
    return new Response(null, { status: 101, webSocket: client } as any);
  }
  async webSocketMessage(ws: any, m: string | ArrayBuffer) {
    if (m === "kick") return ws.close(4000, "kicked");
    this.mem++;
    await this.ctx.storage.put("n", this.mem);
    const team = ws.deserializeAttachment().team;
    for (const s of this.ctx.getWebSockets(team)) s.send(`${team}:${this.mem}:boot${this.boots}:${this.ctx.getTags(s).join("+")}`);
  }
  webSocketClose(ws: any, code: number, _reason: string, clean: boolean) { this.closes.push([ws.deserializeAttachment().team, code, clean]); }
  alarm() { this.env.log.at(-1)!.closes.push(["alarm", this.boots, true]); }
}

test("in-process DO: socket tags, eviction + rebuild, alarm across eviction, clean flag", async () => {
  const env = { log: [] as Tagged[] };
  const NS = durableObject(Tagged, env);
  const stub = NS.getByName("room");
  const sock = async (team: string) => {
    const res = await stub.fetch(`http://do/?team=${team}`);
    const c = (res as any).webSocket;
    const got: string[] = [];
    c.toBrowser = (d: string) => got.push(d);
    return { c, got };
  };
  const red = await sock("red"), red2 = await sock("red"), blue = await sock("blue");

  // getWebSockets(tag) filters; getTags reports what acceptWebSocket got
  red.c.onMessage("go"); await Bun.sleep(5);
  expect(red.got).toEqual(["red:1:boot1:red+all"]);
  expect(red2.got).toEqual(["red:1:boot1:red+all"]);
  expect(blue.got).toEqual([]);
  expect(() => env.log[0]!["ctx"].acceptWebSocket(new WebSocketPair()[1] as any, Array(11).fill("x"))).toThrow();

  // evict: next frame builds a fresh instance from storage + the live sockets
  expect(NS.evict(stub.id)).toBe(true);
  expect(NS.evict(stub.id)).toBe(false);
  await env.log[0]!["ctx"].storage.put("n", 999);   // a zombie write is dropped
  blue.c.onMessage("go"); await Bun.sleep(5);
  expect(env.log.length).toBe(2);
  expect(blue.got).toEqual(["blue:2:boot2:blue+all"]);   // count restored from storage, tags survived

  // an alarm set before eviction fires into the instance live at the time
  await env.log[1]!["ctx"].storage.setAlarm(Date.now() + 10);
  NS.evict(stub.id);
  await Bun.sleep(30);
  expect(env.log.length).toBe(3);
  expect(env.log[2]!.closes).toContainEqual(["alarm", 3, true]);

  // clean flag: a DO-side close is clean; a dropped browser socket is not
  red.c.onMessage("kick"); await Bun.sleep(5);
  red2.c.readyState = 3; red2.c.onClose(1006, "", false); await Bun.sleep(5);
  expect(env.log[2]!.closes).toContainEqual(["red", 4000, true]);
  expect(env.log[2]!.closes).toContainEqual(["red", 1006, false]);
  expect(env.log[2]!["ctx"].getWebSockets().length).toBe(1);   // only blue left
});

test("serve bridge: an abnormal browser drop reaches webSocketClose with clean=false", async () => {
  const env = { log: [] as Tagged[] };
  const NS = durableObject(Tagged, env);
  const shell = serve<{ NS: typeof NS }>({});
  shell.mount({ fetch: (req, e) => e.NS.getByName("r").fetch(req) }, { NS });
  const url = shell.url.replace("http", "ws");
  const open = () => new Promise<WebSocket>((res) => { const w = new WebSocket(`${url}/?team=a`); w.onopen = () => res(w); });
  const a = await open(), b = await open();
  a.close(1000, "bye");
  (b as any).terminate();   // no close frame
  await Bun.sleep(50);
  const closes = env.log[0]!.closes;
  expect(closes).toContainEqual(["a", 1000, true]);
  expect(closes).toContainEqual(["a", 1006, false]);
  await shell.stop();
});

test("idFromString only takes hex: the id becomes a sqlite file name", () => {
  const NS = durableObject(Tagged, { log: [] as Tagged[] });
  expect(() => NS.idFromString("x/../../pwned")).toThrow(TypeError);
  expect(() => NS.idFromString("")).toThrow(TypeError);
  const id = NS.newUniqueId();
  expect(NS.idFromString(id.toString()).equals(id)).toBe(true);
  expect(NS.idFromString("a".repeat(64)).toString()).toBe("a".repeat(64));
});
