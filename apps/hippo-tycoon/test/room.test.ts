import { expect, test } from "bun:test";
import { Room } from "../src/engine/room.ts";
import { TickLoop, TICK_MS, MAX_CATCHUP } from "../src/engine/tickLoop.ts";
import { CLOSE_FULL, CLOSE_REPLACED, CLOSE_VERSION, PROTO_VERSION } from "../src/engine/wire.ts";
import { COUNTDOWN_TICKS } from "../src/sim/rules.ts";
import { FakeCtx, FakeSocket, ManualClock } from "./fakes.ts";

function setup(seed = 5) {
  const ctx = new FakeCtx(), clock = new ManualClock(), errors: unknown[] = [];
  const room = new Room(ctx, { clock, seed, report: (_w, e) => errors.push(e) });
  const join = (uid: string, name = uid) => {
    const ws = new FakeSocket();
    ctx.sockets.push(ws);
    room.onConnect(ws, uid, name);
    room.webSocketMessage(ws, JSON.stringify({ t: "hello", v: PROTO_VERSION }));
    return ws;
  };
  const say = (ws: FakeSocket, m: object) => room.webSocketMessage(ws, JSON.stringify(m));
  return { ctx, clock, room, join, say, errors };
}

test("hello with the wrong protocol is refused with a clear message", () => {
  const { ctx, room } = setup();
  const ws = new FakeSocket(); ctx.sockets.push(ws);
  room.onConnect(ws, "a", "Ada");
  room.webSocketMessage(ws, JSON.stringify({ t: "hello", v: PROTO_VERSION + 1 }));
  expect(ws.closed?.code).toBe(CLOSE_VERSION);
  expect(ws.last("err")!.msg).toMatch(/protocol/);
  expect(room.match.humans()).toBe(0);
});

test("nothing counts before hello, and junk is ignored", () => {
  const { ctx, room, say, join } = setup();
  const ws = new FakeSocket(); ctx.sockets.push(ws);
  room.onConnect(ws, "a", "Ada");
  say(ws, { t: "start" });
  say(ws, { t: "in", m: 100, g: 1, h: 1 });
  expect(room.match.humans()).toBe(0);
  const b = join("b");
  room.webSocketMessage(b, "not json"); room.webSocketMessage(b, JSON.stringify({ t: "in", m: 9999, g: 1, h: 0 }));
  room.webSocketMessage(b, new ArrayBuffer(4));
  expect(room.match.phase).toBe("lobby");
  expect(b.last("hello")!.you).toBe(0);
});

test("identity is the shell's: a name in a message body changes nothing", () => {
  const { room, join, say } = setup();
  const a = join("a", "Ada");
  say(a, { t: "hello", v: PROTO_VERSION, uid: "evil", name: "Evil" });
  expect(room.match.seats[0]).toMatchObject({ uid: "a", name: "Ada" });
  expect(room.match.seatOf("evil")).toBe(-1);
});

test("join, bot takeover, leave hands the seat back", () => {
  const { room, join, ctx } = setup();
  const a = join("a", "Ada"), b = join("b", "Bo");
  expect(a.last("hello")!.you).toBe(0);
  expect(b.last("hello")!.you).toBe(1);
  const f = b.last("room")!;
  expect(f.seats.map((s) => s.h)).toEqual([1, 1, 0, 0]);
  expect(f.seats[2]!.n).toBe("Big Barrel Bertha");     // a bot keeps its tycoon name
  expect(f.host).toBe(0);
  ctx.sockets = ctx.sockets.filter((s) => s !== a);
  room.webSocketClose(a);
  expect(b.last("room")!.seats.map((s) => s.h)).toEqual([0, 1, 0, 0]);
  expect(b.last("room")!.host).toBe(1);                // the host moves to the next human
});

test("a fifth human is told the room is full", () => {
  const { join } = setup();
  for (const u of ["a", "b", "c", "d"]) join(u);
  const e = join("e");
  expect(e.closed?.code).toBe(CLOSE_FULL);
  expect(e.last("err")!.msg).toMatch(/full/);
});

test("the same player from a second tab replaces the first and keeps the seat", () => {
  const { room, join, ctx } = setup();
  const first = join("a", "Ada");
  const second = join("a", "Ada");
  expect(first.closed?.code).toBe(CLOSE_REPLACED);
  ctx.sockets = ctx.sockets.filter((s) => s.closed === null);
  room.webSocketClose(first);                          // the platform reports the old close late
  expect(room.match.seatOf("a")).toBe(0);
  expect(second.last("hello")!.you).toBe(0);
});

test("only the host steers the room", () => {
  const { room, join, say } = setup();
  const a = join("a"), b = join("b");
  say(b, { t: "start" });
  expect(room.match.phase).toBe("lobby");
  say(b, { t: "cfg", secs: 90 });
  expect(room.match.cfg.secs).toBe(60);
  say(a, { t: "cfg", secs: 90, diff: "hard" });
  expect(room.match.cfg).toEqual({ secs: 90, difficulty: "hard" });
  say(a, { t: "start" });
  expect(room.match.phase).toBe("countdown");
});

test("a whole round on the clock: snapshots at 15 Hz, seq only goes up, podium at the end", () => {
  const { room, join, say, clock, errors } = setup();
  const a = join("a");
  say(a, { t: "cfg", secs: 30 });
  say(a, { t: "start" });
  clock.advance(1000 * 3.2);
  expect(room.match.phase).toBe("playing");
  const before = a.of("snap").length;
  clock.advance(1000);
  const perSecond = a.of("snap").length - before;
  expect(perSecond).toBeGreaterThanOrEqual(14);
  expect(perSecond).toBeLessThanOrEqual(16);
  say(a, { t: "in", m: 100, g: 1, h: 0 });
  clock.advance(1000 * 30);
  expect(room.match.phase).toBe("podium");
  expect(a.last("room")!.ph).toBe("podium");
  const seqs = [...a.of("room").map((m) => m.seq), a.last("hello")!.seq].sort((x, y) => x - y);
  expect(new Set(a.of("room").map((m) => m.seq)).size).toBe(a.of("room").length);
  expect(seqs.length).toBeGreaterThan(3);
  const ticks = a.of("snap").map((m) => m.tick);
  expect(a.of("snap").some((m) => m.ev.length > 0)).toBe(true);
  expect(ticks.length).toBeGreaterThan(300);
  say(a, { t: "rematch" });
  expect(room.match.phase).toBe("countdown");
  expect(errors).toEqual([]);
});

test("bellow in the lobby is the ready button, and everyone ready starts the countdown", () => {
  const { room, join, say, clock } = setup();
  const a = join("a"), b = join("b");
  say(a, { t: "in", m: 0, g: 0, h: 1 });
  expect(b.last("room")!.seats[0]!.r).toBe(1);
  say(b, { t: "in", m: 0, g: 0, h: 1 });
  clock.advance(100);
  expect(room.match.phase).toBe("countdown");
  expect(a.last("room")!.ph).toBe("countdown");
});

test("the last human leaving stops the loop; a join starts it again", () => {
  const { room, join, ctx, clock } = setup();
  const a = join("a");
  expect(clock.pending()).toBe(1);
  ctx.sockets = []; room.webSocketClose(a);
  expect(clock.pending()).toBe(0);
  join("b");
  expect(clock.pending()).toBe(1);
});

test("eviction: seats come back from live sockets, a running round restarts at its countdown", async () => {
  const { ctx, room, join, say, clock } = setup();
  const a = join("a", "Ada"), b = join("b", "Bo");
  say(a, { t: "start" });
  clock.advance(1000 * (COUNTDOWN_TICKS / 30 + 3));
  expect(room.match.phase).toBe("playing");
  await Promise.resolve();                              // let the persist land
  // a new Room object on the same storage and sockets, as after a DO wake
  const clock2 = new ManualClock();
  const again = new Room(ctx, { clock: clock2, seed: 999 });
  await again.restore();
  expect(again.match.phase).toBe("countdown");
  expect(again.match.baseSeed).toBe(5);                  // same round seed
  expect(again.match.seatOf("a")).toBe(0);
  expect(again.match.seatOf("b")).toBe(1);
  expect(clock2.pending()).toBe(1);                      // and it is ticking
  void b;
});

test("a throwing tick is reported and does not stop the loop", () => {
  const clock = new ManualClock(); let steps = 0; const errs: unknown[] = [];
  const loop = new TickLoop(clock, { step() { steps++; if (steps === 3) throw new Error("boom"); }, wakeEnd() {}, fail: (e) => errs.push(e) });
  loop.start();
  clock.advance(TICK_MS * 10.5);
  expect(errs.length).toBe(1);
  expect(steps).toBeGreaterThanOrEqual(9);
  expect(loop.active).toBe(true);
  loop.stop();
  expect(clock.pending()).toBe(0);
});

test("tick loop: catch-up is capped after a stall, then steady", () => {
  const clock = new ManualClock(); let steps = 0;
  const loop = new TickLoop(clock, { step() { steps++; }, wakeEnd() {}, fail() {} });
  loop.start();
  clock.advance(TICK_MS * 30);
  const steady = steps;
  expect(steady).toBeGreaterThanOrEqual(29);
  expect(steady).toBeLessThanOrEqual(31);
  clock.t += 5000;                                       // the process was frozen for 5 s
  const before = steps;
  clock.advance(TICK_MS * 2);
  expect(steps - before).toBeLessThanOrEqual(MAX_CATCHUP * 2 + 2);   // a capped burst, not 150 ticks
});
