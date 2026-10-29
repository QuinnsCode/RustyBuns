// Shared Sphere's room and Worker wrapper, without TerraViz: a fake page stands in for its router, and fake sockets
// for the browsers. The real thing, two browsers on one host, is test/live.test.ts.
import { expect, test } from "bun:test";
import type { RoomSocket } from "@rustybuns/util/room";
import { jumpFromSearch } from "../sphere/client.ts";
import { SphereRoom } from "../sphere/room.ts";
import { CLIENT_PATH, TOURS_PATH, TOUR_GLUE_PATH, TOUR_WASM_PATH, WS_PATH, roomName, sphere } from "../sphere/worker.ts";

class FakeSocket implements RoomSocket {
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
    storage: { get: async (k) => store.get(k) as any, put: async (k, v) => { store.set(k, v); }, delete: async (k) => store.delete(k) },
    blockConcurrencyWhile: (f) => { ready = f(); }, // a real DO holds events until this settles
  }, {});
  const join = async (name: string, teach = "") => {
    await ready;
    await r.fetch(new Request(`http://x${WS_PATH}?name=${name}${teach ? `&teach=${teach}` : ""}`, { headers: { Upgrade: "websocket" } }));
    const ws = sockets.at(-1)!;
    return { ws, id: ws.last("hello").you.id as string, say: (m: object) => r.webSocketMessage(ws, JSON.stringify(m)) };
  };
  return { r, join, store };
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
  await ada.say({ t: "tour", url: "/assets/test-tour.json", i: 17, state: "paused" });
  expect(grace.ws.last("cam")).toMatchObject({ c: [139.7, 35.7], z: 3 });
  expect(grace.ws.last("ds").id).toBe("sea-surface-temperature");
  expect(grace.ws.last("tour").tour).toEqual({ url: "/assets/test-tour.json", i: 17, state: "paused" });

  // a follower can point but not steer, and off-globe numbers go nowhere
  await grace.say({ t: "cam", c: [0, 0], z: 1, b: 0, p: 0 });
  await grace.say({ t: "tour", url: null, i: 0, state: "stopped" });
  await ada.say({ t: "cam", c: [0, 400], z: 1, b: 0, p: 0 });
  await grace.say({ t: "ptr", c: [1, 2] });
  expect(ada.ws.last("cam")).toBeUndefined();
  expect(ada.ws.last("tour")).toBeUndefined();
  expect(grace.ws.last("cam").c).toEqual([139.7, 35.7]);
  expect(ada.ws.last("ptr")).toEqual({ t: "ptr", from: grace.id, c: [1, 2] });

  const late = await join("Linus");
  expect(late.ws.last("hello")).toMatchObject({
    lead: ada.id, ds: "sea-surface-temperature", cam: { c: [139.7, 35.7] }, tour: { url: "/assets/test-tour.json", i: 17 }, locked: false,
  });
  expect(late.ws.last("hello").peers.map((p: any) => p.name)).toEqual(["Ada", "Grace"]);

  // "none" is a message too: the pointer leaves the globe, the dataset is unloaded, the tour is stopped
  await grace.say({ t: "ptr", c: null });
  await ada.say({ t: "ds", id: null });
  await ada.say({ t: "tour", url: null, i: 0, state: "stopped" });
  expect(ada.ws.last("ptr").c).toBeNull();
  expect(grace.ws.last("ds").id).toBeNull();
  expect(grace.ws.last("tour").tour).toBeNull();
  await ada.say({ t: "tour", url: "/assets/test-tour.json", i: 17, state: "paused" });

  await r.webSocketClose(ada.ws);
  expect(grace.ws.last("leave").id).toBe(ada.id);
  expect(grace.ws.last("lead").id).toBeNull();
  // the tour went with the lead: the next joiner starts clean
  expect((await join("Margaret")).ws.last("hello").tour).toBeNull();
});

test("a teacher's word locks the lead: students follow and cannot take it; the teacher can open the room", async () => {
  const { join, store } = room();
  const early = await join("Early Bird"); // in the room before the teacher: hears it lock
  const teacher = await join("Ms Ada", "apple");
  expect(early.ws.last("locked")).toEqual({ t: "locked", locked: true, teacher: false });
  expect(early.ws.last("lead").id).toBe(teacher.id);
  // a teacher walking into an empty room leads it at once
  expect(teacher.ws.last("hello")).toMatchObject({ you: { teacher: true }, locked: true, lead: null });
  expect(teacher.ws.last("lead").id).toBe(teacher.id);

  const student = await join("Linus");
  expect(student.ws.last("hello")).toMatchObject({ you: { teacher: false }, locked: true, lead: teacher.id });
  await student.say({ t: "lead" });
  await student.say({ t: "open" });
  expect(student.ws.last("lead")).toBeUndefined();
  expect(store.get("key")).toBe("apple");
  const impostor = await join("Mallory", "pear"); // the wrong word is no word
  expect(impostor.ws.last("hello").you.teacher).toBe(false);

  // the teacher reloads: the same word, still a teacher; the class keeps following the first socket meanwhile
  const again = await join("Ms Ada", "apple");
  expect(again.ws.last("hello").you.teacher).toBe(true);

  await teacher.say({ t: "open" });
  expect(student.ws.last("locked")).toEqual({ t: "locked", locked: false, teacher: false });
  expect(teacher.ws.last("locked")).toEqual({ t: "locked", locked: false, teacher: false });
  await teacher.say({ t: "unlead" });
  await student.say({ t: "lead" });
  expect(teacher.ws.last("lead").id).toBe(student.id);

  // a new word locks the open room again, and the old teacher is a student under it
  const next = await join("Mr Babbage", "pear");
  expect(teacher.ws.last("locked")).toEqual({ t: "locked", locked: true, teacher: false });
  expect(next.ws.last("hello").you.teacher).toBe(true);
  await teacher.say({ t: "open" });
  expect(store.get("key")).toBe("pear");
});

test("a lead saved before a restart, whose socket never came back, is let go", async () => {
  const { join } = room(new Map<string, unknown>([["lead", "gone1234"], ["ds", "hurricanes"]]));
  const ada = await join("Ada");
  expect(ada.ws.last("hello")).toMatchObject({ lead: null, ds: "hurricanes" });
});

test("the wrapper routes the room, serves the client, the tour reader and the demo tours, and adds the script to TerraViz's pages only", async () => {
  const seen: string[] = [];
  const env = { SPHERE: { idFromName: (n: string) => n, get: (id: unknown) => ({ fetch: async () => { seen.push(String(id)); return new Response("room"); } }) } };
  const w = sphere({
    fetch: (req) => new URL(req.url).pathname === "/"
      ? new Response("<html><head><title>t</title></head><body></body></html>", { headers: { "content-type": "text/html" } })
      : new Response("{}", { headers: { "content-type": "application/json" } }),
  });
  const get = (path: string) => w.fetch(new Request(`http://x${path}`), env, {});
  const page = await (await get("/")).text();
  expect(page).toContain(`<script src="${CLIENT_PATH}" defer></script></head>`);
  expect(await (await get("/api/v1/catalog")).text()).toBe("{}");

  await get(`${WS_PATH}?room=Class 7B!`);
  expect(seen).toEqual(["class7b"]);
  expect(roomName(null)).toBe("lobby");

  // the client is one self-contained script that parses, and the reader is a module plus real wasm
  const js = await (await get(CLIENT_PATH)).text();
  expect(() => new Function(js)).not.toThrow();
  expect((await get(TOUR_GLUE_PATH)).headers.get("content-type")).toContain("javascript");
  const wasm = new Uint8Array(await (await get(TOUR_WASM_PATH)).arrayBuffer());
  expect([...wasm.slice(0, 4)]).toEqual([0, 0x61, 0x73, 0x6d]);

  const tours = await (await get(`${TOURS_PATH}.json`)).json();
  expect(tours).toEqual([{ name: "three-places", title: "Three places, one globe", url: `${TOURS_PATH}/three-places.json` }]);
  const tour = await (await get(`${TOURS_PATH}/three-places.json`)).json();
  expect(tour.tourTasks.length).toBeGreaterThan(5);
  expect((await get(`${TOURS_PATH}/nope.json`)).status).toBe(404);
  expect((await get(`${TOURS_PATH}/constructor.json`)).status).toBe(404);
});

test("a link lands in a state: dataset, camera, lead and tour, clamped, and nothing when it asks for none", () => {
  expect(jumpFromSearch("?dataset=sea-surface-temperature&lon=139.7&lat=35.7&zoom=3&lead=1&tour=three-places"))
    .toEqual({ dataset: "sea-surface-temperature", lon: 139.7, lat: 35.7, zoom: 3, lead: true, tour: "three-places" });
  expect(jumpFromSearch("?lat=200&zoom=abc&room=x")).toEqual({ lat: 85 });
  expect(jumpFromSearch("?room=class-7b&name=Ada&teach=apple")).toBeNull();
  // the served script carries the parser and is valid JavaScript
  expect(() => new Function(`${jumpFromSearch}`)).not.toThrow();
});
