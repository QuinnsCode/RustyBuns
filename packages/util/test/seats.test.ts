import { afterAll, beforeAll, expect, test } from "bun:test";
import { RoomMintGate } from "../src/limits.ts";
import type { RoomSocket } from "../src/room.ts";
import { publicId, SEAT_CLOSE, seatDoor, Seats, vouched } from "../src/seats.ts";

class Sock implements RoomSocket {
  readyState = 1;
  closed: number | null = null;
  private att: unknown;
  send() {}
  close(code = 1000) { this.closed = code; this.readyState = 3; }
  serializeAttachment(v: unknown) { this.att = v; }
  deserializeAttachment() { return this.att; }
}
class FakePair { 0 = new Sock(); 1 = new Sock(); }
let real: unknown;
beforeAll(() => { real = Reflect.get(globalThis, "WebSocketPair"); Reflect.set(globalThis, "WebSocketPair", FakePair); });
afterAll(() => { Reflect.set(globalThis, "WebSocketPair", real); });

const door = { door: { app: "game", eqosys: "https://eqosys.example", fallbackName: "Player" }, room: /^[A-Z0-9]{4,8}$/, gate: new RoomMintGate() };
const ws = (q: string, h: Record<string, string> = {}) => new Request(`https://game.example/ws?${q}`, { headers: { Upgrade: "websocket", Origin: "https://game.example", ...h } });

test("a guest through the door to a seat: vouched by the edge, a second tab takes over, leaving only with the last socket", async () => {
  // The door: the client's own X-User-Id never gets through; the edge's word does.
  const passed = await seatDoor(ws("room=abcd&uid=guest-0001&name=Ada", { "X-User-Id": "eq:someone-else" }), door);
  if (passed instanceof Response) throw new Error(`refused ${passed.status}`);
  expect(passed.room).toBe("ABCD");
  expect(passed.request.headers.get("X-User-Id")).toBe("guest-0001");
  expect(passed.request.headers.get("X-RB-Principal")).toBe("guest");

  const who = await vouched(passed.request, "game", "Player");
  if (who instanceof Response) throw new Error("not vouched");
  expect(who).toEqual({ uid: "guest-0001", id: await publicId("game", "guest-0001"), name: "Ada", host: false });

  const socks: RoomSocket[] = [];
  const seats = new Seats<{ id: string }>({ acceptWebSocket: (s) => { socks.push(s); }, getWebSockets: () => socks });
  const one = seats.take({ id: who.id }), two = seats.take({ id: who.id }), bea = seats.take({ id: "bea" });
  expect([one.back, two.back, bea.back]).toEqual([false, true, false]);
  expect((one.server as Sock).closed).toBe(SEAT_CLOSE.replaced);
  expect(seats.leave(one.server)).toBeNull();                 // the replaced tab: still here on the new one
  expect(seats.here().map((s) => s.id)).toEqual([who.id, "bea"]);
  two.server.close();
  expect(seats.leave(two.server)).toBe(who.id);
  expect(seats.leave(two.server)).toBeNull();                 // close then error: told once
});

test("the door refuses what a page plausibly sends wrong", async () => {
  const status = async (r: Request) => { const out = await seatDoor(r, door); return out instanceof Response ? out.status : 200; };
  expect(await status(new Request("https://game.example/ws?room=ABCD&uid=guest-0001"))).toBe(426);
  expect(await status(ws("room=ABCD&uid=guest-0001", { Origin: "https://elsewhere.example" }))).toBe(403);
  expect(await status(ws("room=no&uid=guest-0001"))).toBe(400);
  expect(await status(ws("room=ABCD&uid=x"))).toBe(400);
});
