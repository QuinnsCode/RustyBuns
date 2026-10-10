import { afterEach, describe, expect, test } from "bun:test";
import World, { publicId } from "../packages/desktop/world.ts";

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
(globalThis as any).WebSocketPair = class { 0 = new Sock(); 1 = new Sock(); };

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
