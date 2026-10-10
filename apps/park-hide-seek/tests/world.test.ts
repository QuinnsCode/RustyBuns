// The world behind real sockets, hosted by Rusty Buns' in-process Durable Object.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { serve, durableObject } from "@rustybuns/shell-bun";
import World, { CLOSE_REPLACED, publicId } from "../packages/desktop/world.ts";

const env: any = {};
env.WORLD = durableObject(World as never, env);
const shell = serve<any>({ hostname: "127.0.0.1", port: 0 });
// Stands in for the edge Worker: vouches the uid from the query.
shell.mount({
  fetch: (req: Request, e: any) => {
    const uid = new URL(req.url).searchParams.get("uid")!;
    const headers = new Headers(req.headers);
    headers.set("X-User-Id", uid); headers.set("X-User-Name", uid);
    return e.WORLD.get(e.WORLD.idFromName("ROOM")).fetch(new Request(req, { headers }));
  },
} as never, env);
afterAll(() => shell.stop());

function open(uid: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${shell.port}/ws?uid=${uid}`);
  const s = { ws, views: 0, closed: null as number | null };
  ws.onmessage = () => { s.views++; };
  ws.onclose = (e) => { s.closed = e.code; };
  return s;
}
const until = async (f: () => unknown, ms = 10000) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error("timed out"); await Bun.sleep(15); } };

test("the same player again replaces their older socket and stays in the game", async () => {
  const one = open("player-one");
  await until(() => one.views > 0);
  const two = open("player-one");
  await until(() => two.views > 0 && one.closed !== null);
  expect(one.closed).toBe(CLOSE_REPLACED);
  const seen = two.views;
  const other = open("player-two");                 // a join moves the game: the replacement still gets views
  await until(() => other.views > 0 && two.views > seen);
  expect(two.closed).toBeNull();
  two.ws.close(); other.ws.close();
}, 30_000);

// Just enough of a Durable Object and its sockets to join players and read their views.
class Sock {
  readyState = 1;
  sent: any[] = [];
  private att: unknown;
  send(s: string) { this.sent.push(JSON.parse(s)); }
  serializeAttachment(a: unknown) { this.att = a; }
  deserializeAttachment() { return this.att; }
  get view() { return this.sent.at(-1).view; }
}
class FakePair { 0 = new Sock(); 1 = new Sock(); }

const worlds: World[] = [];
function world() {
  const socks: Sock[] = [];
  const w = new World({ acceptWebSocket: (s: Sock) => socks.push(s), getWebSockets: () => socks, storage: {} }, {});
  worlds.push(w);
  const join = async (uid: string, name: string) => {
    const res = await w.fetch(new Request("https://world/ws", { headers: { Upgrade: "websocket", "X-User-Id": uid, "X-User-Name": name, "X-RB-Principal": "guest" } }));
    expect(res.status).toBe(101);
    return socks.at(-1)!;
  };
  return { w, join };
}
afterEach(() => { for (const w of worlds.splice(0)) clearInterval((w as any).timer); });

describe("player ids", () => {
  // The fake pair only while these run: the real-socket test above needs shell-bun's.
  let real: unknown;
  beforeAll(() => { real = (globalThis as any).WebSocketPair; (globalThis as any).WebSocketPair = FakePair; });
  afterAll(() => { (globalThis as any).WebSocketPair = real; });

  test("views carry public ids, never anyone's uid", async () => {
    const { join } = world();
    const host = await join("host-secret-0001", "Host");
    const guest = await join("guest-secret-0002", "Guest");
    for (const s of [host, guest]) {
      const text = JSON.stringify(s.sent);
      expect(text).not.toContain("host-secret-0001");
      expect(text).not.toContain("guest-secret-0002");
    }
    expect(host.view.me).toBe(await publicId("host-secret-0001"));
    expect(guest.view.hostId).toBe(host.view.me);
    expect(guest.view.players.map((p: any) => p.id)).toEqual([host.view.me, guest.view.me]);
  });

  test("connecting with an id seen in a view makes a new player, not that one", async () => {
    const { join } = world();
    const host = await join("host-secret-0001", "Host");
    const thief = await join(host.view.me, "Thief");
    expect(thief.view.me).not.toBe(host.view.me);
    expect(thief.view.hostId).toBe(host.view.me);
  });

  test("the same uid rejoins as the same player", async () => {
    const { join } = world();
    const a = await join("host-secret-0001", "Host");
    const b = await join("host-secret-0001", "Host");
    expect(b.view.me).toBe(a.view.me);
    expect(b.view.players).toHaveLength(1);
  });
});
