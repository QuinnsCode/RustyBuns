// Shared Sphere's room and Worker wrapper, without TerraViz: a fake page stands in for its router, and fake sockets
// for the browsers. The real thing is checked by hand with `bun apps/terraviz-demo/run.ts --shared`.
import { expect, test } from "bun:test";
import { jumpFromSearch } from "../sphere/client.ts";
import { SphereRoom, type Socket } from "../sphere/room.ts";
import { CLIENT_PATH, WS_PATH, roomName, sphere } from "../sphere/worker.ts";

class FakeSocket implements Socket {
  got: any[] = [];
  private att: unknown = null;
  send(m: string) { this.got.push(JSON.parse(m)); }
  close() {}
  serializeAttachment(v: unknown) { this.att = v; }
  deserializeAttachment() { return this.att; }
  last(t: string) { return this.got.findLast((m) => m.t === t); }
}

function room(store = new Map<string, unknown>()) {
  const sockets: FakeSocket[] = [];
  let ready: Promise<void> = Promise.resolve();
  (globalThis as any).WebSocketPair = class { 0 = new FakeSocket(); 1 = new FakeSocket(); };
  const r = new SphereRoom({
    acceptWebSocket: (ws) => { sockets.push(ws as FakeSocket); },
    getWebSockets: () => sockets,
    storage: { get: async (k) => store.get(k) as any, put: async (k, v) => { store.set(k, v); } },
    blockConcurrencyWhile: (f) => { ready = f(); }, // a real DO holds events until this settles
  }, {});
  const join = async (name: string) => {
    await ready;
    await r.fetch(new Request(`http://x${WS_PATH}?name=${name}`, { headers: { Upgrade: "websocket" } }));
    const ws = sockets.at(-1)!;
    return { ws, id: ws.last("hello").you.id as string, say: (m: object) => r.webSocketMessage(ws, JSON.stringify(m)) };
  };
  return { r, join };
}

test("a lead steers the room, a late joiner lands where the lead is, and leaving lets go", async () => {
  const { r, join } = room();
  const ada = await join("Ada"), grace = await join("Grace");
  expect(ada.ws.last("join").name).toBe("Grace");

  // nobody leads: a camera is nobody's to send
  await grace.say({ t: "cam", c: [10, 20], z: 3, b: 0, p: 0 });
  expect(ada.ws.last("cam")).toBeUndefined();

  await ada.say({ t: "lead" });
  expect(grace.ws.last("lead").id).toBe(ada.id);
  await ada.say({ t: "cam", c: [139.7, 35.7], z: 3, b: 10, p: 20 });
  await ada.say({ t: "ds", id: "sea-surface-temperature" });
  expect(grace.ws.last("cam")).toMatchObject({ c: [139.7, 35.7], z: 3 });
  expect(grace.ws.last("ds").id).toBe("sea-surface-temperature");

  // a follower can point but not steer, and off-globe numbers go nowhere
  await grace.say({ t: "cam", c: [0, 0], z: 1, b: 0, p: 0 });
  await ada.say({ t: "cam", c: [0, 400], z: 1, b: 0, p: 0 });
  await grace.say({ t: "ptr", c: [1, 2] });
  expect(ada.ws.last("cam")).toBeUndefined();
  expect(grace.ws.last("cam").c).toEqual([139.7, 35.7]);
  expect(ada.ws.last("ptr")).toEqual({ t: "ptr", from: grace.id, c: [1, 2] });

  const late = await join("Linus");
  expect(late.ws.last("hello")).toMatchObject({ lead: ada.id, ds: "sea-surface-temperature", cam: { c: [139.7, 35.7] } });
  expect(late.ws.last("hello").peers.map((p: any) => p.name)).toEqual(["Ada", "Grace"]);

  await r.webSocketClose(ada.ws);
  expect(grace.ws.last("leave").id).toBe(ada.id);
  expect(grace.ws.last("lead").id).toBeNull();
});

test("a lead saved before a restart, whose socket never came back, is let go", async () => {
  const { join } = room(new Map<string, unknown>([["lead", "gone1234"], ["ds", "hurricanes"]]));
  const ada = await join("Ada");
  expect(ada.ws.last("hello")).toMatchObject({ lead: null, ds: "hurricanes" });
});

test("the wrapper routes the room, serves the client and adds it to TerraViz's pages only", async () => {
  const seen: string[] = [];
  const env = { SPHERE: { idFromName: (n: string) => n, get: (id: unknown) => ({ fetch: async () => { seen.push(String(id)); return new Response("room"); } }) } };
  const w = sphere({
    fetch: (req) => new URL(req.url).pathname === "/"
      ? new Response("<html><head><title>t</title></head><body></body></html>", { headers: { "content-type": "text/html" } })
      : new Response("{}", { headers: { "content-type": "application/json" } }),
  });
  const page = await (await w.fetch(new Request("http://x/"), env, {})).text();
  expect(page).toContain(`<script src="${CLIENT_PATH}" defer></script></head>`);
  expect(await (await w.fetch(new Request("http://x/api/v1/catalog"), env, {})).text()).toBe("{}");

  await w.fetch(new Request(`http://x${WS_PATH}?room=Class 7B!`), env, {});
  expect(seen).toEqual(["class7b"]);
  expect(roomName(null)).toBe("lobby");

  // the client is one self-contained script that parses
  const js = await (await w.fetch(new Request(`http://x${CLIENT_PATH}`), env, {})).text();
  expect(() => new Function(js)).not.toThrow();
});

test("a link lands in a state: dataset, camera and lead, clamped, and nothing when it asks for none", () => {
  expect(jumpFromSearch("?dataset=sea-surface-temperature&lon=139.7&lat=35.7&zoom=3&lead=1"))
    .toEqual({ dataset: "sea-surface-temperature", lon: 139.7, lat: 35.7, zoom: 3, lead: true });
  expect(jumpFromSearch("?lat=200&zoom=abc&room=x")).toEqual({ lat: 85 });
  expect(jumpFromSearch("?room=class-7b&name=Ada")).toBeNull();
  // the served script carries the parser and is valid JavaScript
  expect(() => new Function(`${jumpFromSearch}`)).not.toThrow();
});
