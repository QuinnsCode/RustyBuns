import { afterAll, beforeAll, expect, test } from "bun:test";
import { Sockets, type RoomSocket } from "../src/room.ts";

// Just enough of a hibernating socket: what it sent, what closed it, what it carries.
class Sock implements RoomSocket {
  readyState = 1;
  sent: string[] = [];
  closed: number | null = null;
  private att: unknown;
  send(s: string | ArrayBuffer | Uint8Array) { if (typeof s === "string") this.sent.push(s); }
  close(code = 1000) { this.closed = code; this.readyState = 3; }
  serializeAttachment(v: unknown) { this.att = v; }
  deserializeAttachment() { return this.att; }
}
class FakePair { 0 = new Sock(); 1 = new Sock(); }
let real: unknown;
beforeAll(() => { real = (globalThis as any).WebSocketPair; (globalThis as any).WebSocketPair = FakePair; });
afterAll(() => { (globalThis as any).WebSocketPair = real; });

type Who = { id: string };
function room(limits?: ConstructorParameters<typeof Sockets>[1]) {
  const socks: RoomSocket[] = [];
  const ctx = { acceptWebSocket: (s: RoomSocket) => { socks.push(s); }, getWebSockets: () => socks };
  return new Sockets<Who, { t: string }>(ctx, limits);
}

test("a player's second tab replaces the first; a closing socket is not open", () => {
  const s = room();
  const a = s.upgrade({ id: "p1" }), b = s.upgrade({ id: "p1" }), c = s.upgrade({ id: "p2" });
  expect(a.response.status).toBe(101);
  expect(s.who(a.server)).toEqual({ id: "p1" });
  expect(s.others(b.server, (w) => w.id === "p1")).toEqual([a.server]);
  s.replace(b.server, (w) => w.id === "p1", 4001);
  expect((a.server as Sock).closed).toBe(4001);
  expect(s.open()).toEqual([b.server, c.server]);
  s.broadcast({ t: "all" }, c.server);
  s.broadcast({ t: "p2" }, undefined, (w) => w.id === "p2");
  expect((b.server as Sock).sent).toEqual(['{"t":"all"}']);
  expect((c.server as Sock).sent).toEqual(['{"t":"p2"}']);
});

test("frames: binary, oversize, non-JSON and a flood are dropped; the rest come back parsed", () => {
  const flooded: RoomSocket[] = [];
  const s = room({ maxBytes: 20, rate: 1, burst: 2, cost: (n) => (n > 10 ? 2 : 1), onFlood: (ws) => flooded.push(ws) });
  const { server } = s.upgrade({ id: "p1" });
  expect(s.frame(server, new ArrayBuffer(2), 0)).toBeNull();
  expect(s.frame(server, "x".repeat(21), 0)).toBeNull();
  expect(s.frame(server, "{nope", 0)).toBeNull();                         // one of two tokens
  expect(s.frame(server, '{"t":"pose","x":1}', 0)).toBeNull();            // costs two: over
  expect(flooded).toEqual([server]);
  expect(s.frame(server, "[1]", 0)).toEqual({ value: [1], bytes: 3 });
  expect(s.frame(server, "[1]", 0)).toBeNull();
  expect(s.frame(server, '{"t":"pose","x":1}', 2000)).toEqual({ value: { t: "pose", x: 1 }, bytes: 18 });
});
