// A crew of two in the bigger bar, through the room's own Durable Object (edge/world.ts) on stand-in sockets: the 70 kg
// cooler is too heavy for one, so Ada takes an end and waits, Bea takes the other, they can only walk it the same way,
// and when Bea sets it down it lands in both their worlds. A wedge one of them has is the other's only to watch.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { RoomMintGate } from "@rustybuns/util/limits";
import type { RoomSocket } from "@rustybuns/util/room";
import { seatDoor } from "@rustybuns/util/seats";
import { BIGGER_BAR } from "../src/venues/bigger-bar.ts";
import { newWorld, pickUp, putDown, snapshot, walkTo, type World } from "../src/sim.ts";
import { setDial } from "../src/assists.ts";
import { World as Room } from "../src/edge/world.ts";
import { readServer } from "../src/crew/room.ts";
import { hear, outbox, poseOf, synced, type Synced } from "../src/crew/sync.ts";
import { APP } from "../src/eqosys.ts";

class Sock implements RoomSocket {
  readyState = 1;
  inbox: string[] = [];
  private att: unknown;
  send(m: string) { this.inbox.push(m); }
  close() { this.readyState = 3; }
  serializeAttachment(v: unknown) { this.att = v; }
  deserializeAttachment() { return this.att; }
}
class FakePair { 0 = new Sock(); 1 = new Sock(); }
let real: unknown;
beforeAll(() => { real = Reflect.get(globalThis, "WebSocketPair"); Reflect.set(globalThis, "WebSocketPair", FakePair); });
afterAll(() => { Reflect.set(globalThis, "WebSocketPair", real); });

interface Page { name: string; w: World; s: Synced; ws: Sock }

test("two carry the cooler together, walk it out the same way, and it lands where it was set down for both", async () => {
  setDial("sim");
  const socks: RoomSocket[] = [];
  const room = new Room({ acceptWebSocket: (s) => { socks.push(s); }, getWebSockets: () => socks }, {});
  const gate = new RoomMintGate();
  const join = async (name: string, uid: string): Promise<Page> => {
    const req = new Request(`https://load-in.example/ws?room=CREW1&level=bigger-bar&uid=${uid}&name=${name}`, { headers: { Upgrade: "websocket", Origin: "https://load-in.example" } });
    const seat = await seatDoor(req, { door: { app: APP, eqosys: "https://eqosys.example", fallbackName: "Roadie" }, room: /^[A-Z0-9]{4,12}$/, gate });
    if (seat instanceof Response) throw new Error(`refused ${seat.status}`);
    await room.fetch(seat.request);
    return { name, w: newWorld(BIGGER_BAR), s: synced(), ws: socks.at(-1) as Sock };
  };
  // One round of the wire: each page sends its grabs, drops and pose, the room sends each its view.
  const pump = (...pages: Page[]) => {
    for (const p of pages) for (const m of [...outbox(p.w, p.s), poseOf(p.w)]) room.webSocketMessage(p.ws, JSON.stringify(m));
    room.flush();
    for (const p of pages) for (const raw of p.ws.inbox.splice(0)) { const m = readServer(JSON.parse(raw)); if (m) hear(p.w, p.s, m); }
  };
  const cooler = (w: World) => snapshot(w).items.find((i) => i.key === "cooler")!;

  const ada = await join("Ada", "guest-ada-0001");
  // In by the left wall (straight from the door runs into the stage gear). Alone, the cooler is what it always was.
  const byTheWall = (p: Page, x: number, z: number) => { walkTo(p.w, -3.3, 14.5); walkTo(p.w, x, 14.5); walkTo(p.w, x, z); };
  byTheWall(ada, -3.3, 1.2);
  expect(pickUp(ada.w, "cooler")).toEqual({ ok: false, why: "back-bar drinks cooler is 70 kg, too heavy to lift alone" });

  const bea = await join("Bea", "guest-bea-0001");
  pump(ada, bea);
  expect(snapshot(ada.w).crew.map((m) => m.name)).toEqual(["Bea"]);
  // With a crew here, Ada takes one end and waits; she can't walk off with it.
  expect(pickUp(ada.w, "cooler")).toEqual({ ok: true });
  expect(snapshot(ada.w).together).toBe("waiting for a second pair of hands");
  walkTo(ada.w, 0, 8, 5);
  expect(Math.hypot(ada.w.you.x + 3.4, ada.w.you.z - 0.5)).toBeLessThan(1.7);
  walkTo(ada.w, -3.0, 1.3);
  pump(ada, bea);

  // Bea takes the other end: it comes up between them.
  byTheWall(bea, -2.5, 0.9);
  expect(pickUp(bea.w, "cooler")).toEqual({ ok: true });
  pump(bea, ada); pump(ada, bea);
  expect([snapshot(ada.w).together, snapshot(bea.w).together]).toEqual(["Bea", "Ada"]);
  expect(cooler(ada.w).y).toBeGreaterThan(0);

  // Ada heads off while Bea stands still: the cooler won't let her get away.
  const apart = () => Math.hypot(ada.w.you.x - bea.w.you.x, ada.w.you.z - bea.w.you.z);
  const span = apart();
  walkTo(ada.w, -3.0, 6, 3);
  expect(apart()).toBeLessThan(span + 0.2);

  // Both walk it across the room, a step at a time each, and Bea sets it down.
  for (let k = 0; k < 40; k++) {
    walkTo(ada.w, ada.w.you.x + 0.6, ada.w.you.z + 0.1, 0.1);
    walkTo(bea.w, bea.w.you.x + 0.6, bea.w.you.z + 0.1, 0.1);
    pump(ada, bea);
  }
  expect(bea.w.you.x).toBeGreaterThan(-1.5);
  expect(putDown(bea.w)).toEqual({ ok: true });
  pump(bea, ada); pump(ada, bea);
  expect(ada.w.held).toBeNull();
  const landed = cooler(bea.w);
  expect(cooler(ada.w)).toEqual(landed);
  expect(landed.x).toBeGreaterThan(-2.5);

  // A wedge is light: whoever has it has it.
  // Round by the right wall to the front of the stage gear.
  for (const [p, x] of [[ada, 1.2], [bea, 2.0]] as const) { walkTo(p.w, 3.3, 3); walkTo(p.w, 3.3, 14); walkTo(p.w, x, 14); }
  expect(pickUp(ada.w, "wedge-1")).toEqual({ ok: true });
  pump(ada, bea);
  expect(pickUp(bea.w, "wedge-1")).toEqual({ ok: false, why: "Ada has the 12\" floor monitor" });
});
