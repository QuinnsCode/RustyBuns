import { expect, test } from "bun:test";
import { MAX_WATCHERS, MSG_BURST, Room, WATCHDOG_MS } from "../src/engine/room.ts";
import { TickLoop, TICK_MS, MAX_CATCHUP } from "../src/engine/tickLoop.ts";
import { CLOSE_FLOOD, CLOSE_FULL, CLOSE_REPLACED, CLOSE_VERSION, PROTO_VERSION } from "../src/engine/wire.ts";
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

test("a fifth human watches, can sit when a seat frees, and the gallery has a limit", () => {
  const { room, join, say, ctx, clock } = setup();
  const [a, b] = ["a", "b", "c", "d"].map((u) => join(u));
  const e = join("e", "Eve");
  expect(e.closed).toBeNull();
  expect(e.last("hello")!.you).toBe(-1);
  expect(e.last("room")!.you).toEqual([]);
  expect(a!.last("room")!.sp).toBe(1);
  expect(a!.last("room")!.you).toEqual([0]);
  say(a!, { t: "start" });
  clock.advance(1000 * 4);
  expect(e.of("snap").length).toBeGreaterThan(0);        // the gallery sees the round
  say(e, { t: "in", m: 100, g: 1, h: 0 });
  clock.advance(500);
  expect(room.match.seatOf("e")).toBe(-1);               // and cannot drive anything
  say(e, { t: "start" }); say(e, { t: "seat", n: 1 });   // nor steer, nor take a human's seat
  expect(room.match.seats[1]!.uid).toBe("b");
  ctx.sockets = ctx.sockets.filter((s) => s !== b); room.webSocketClose(b!);
  say(e, { t: "seat", n: 1 });                           // mid-round: a watcher takes over the bot
  expect(room.match.seatOf("e")).toBe(1);
  expect(e.last("room")!.you).toEqual([1]);
  expect(a!.last("room")!.sp).toBe(0);
  const gallery = Array.from({ length: MAX_WATCHERS }, (_, i) => join(`w${i}`));
  expect(gallery.every((w) => w.closed === null)).toBe(true);
  const late = join("late");
  expect(late.closed?.code).toBe(CLOSE_FULL);
  expect(late.last("err")!.msg).toMatch(/full/);
});

test("couch over the network: one socket, two seats, each driven by its own input", () => {
  const { room, ctx, say, join } = setup();
  const pair = new FakeSocket(); ctx.sockets.push(pair);
  room.onConnect(pair, "a", "Ada");
  say(pair, { t: "hello", v: PROTO_VERSION, k: 2 });
  const b = join("b", "Bo");
  expect(pair.last("hello")!.you).toBe(0);
  expect(pair.last("room")!.you).toEqual([0, 1]);
  expect(b.last("room")!.you).toEqual([2]);
  expect(room.match.seats.map((s) => s.name).slice(0, 3)).toEqual(["Ada", "Ada 2", "Bo"]);
  say(pair, { t: "in", m: 0, g: 0, h: 1, s: 1 });          // the second player readies their own seat
  expect(room.match.seats.map((s) => s.ready)).toEqual([false, true, false, false]);
  say(pair, { t: "in", m: 0, g: 0, h: 1 });                // no seat field: the first player
  expect(room.match.seats[0]!.ready).toBe(true);
  say(pair, { t: "in", m: 0, g: 0, h: 1, s: 2 });          // not this socket's seat
  expect(room.match.seats[2]!.ready).toBe(false);
  say(pair, { t: "hello", v: PROTO_VERSION, k: 1 });       // back to one player: the partner's seat frees
  expect(room.match.seatOf("a+2")).toBe(-1);
  expect(pair.last("room")!.you).toEqual([0]);
  ctx.sockets = ctx.sockets.filter((s) => s !== pair); room.webSocketClose(pair);
  expect(room.match.humans()).toBe(1);
});

test("a dropped human comes back to their own seat; the bot kept it warm", () => {
  const { room, join, say, ctx, clock } = setup();
  const a = join("a"), b = join("b"); join("c");
  say(a, { t: "start" });
  clock.advance(1000 * 4);
  ctx.sockets = ctx.sockets.filter((s) => s !== b); room.webSocketClose(b);
  room.match.sim.hippos[1]!.score = 9;
  const d = join("d");
  expect(d.last("hello")!.you).toBe(3);                  // not Bo's seat while Bo may come back
  join("b");
  expect(room.match.seatOf("b")).toBe(1);
  expect(room.match.sim.hippos[1]!.score).toBe(9);       // and the fortune the bot kept
  const p = new FakeSocket(); ctx.sockets.push(p); room.onConnect(p, "p", "Pat");
  say(p, { t: "hello", v: PROTO_VERSION, k: 2 });        // a couch pair that only half fits... the room is full
  expect(p.last("hello")!.you).toBe(-1);
  ctx.sockets = ctx.sockets.filter((s) => s !== d); room.webSocketClose(d);
  say(p, { t: "seat", n: 3 });
  expect(room.match.seatOf("p")).toBe(3);
});

test("per-seat bot difficulty: only the host sets it, and the room frame carries it", () => {
  const { room, join, say } = setup();
  const a = join("a"), b = join("b");
  say(b, { t: "cfg", n: 2, diff: "hard" });
  expect(room.match.cfg.bots[2]).toBe("normal");
  say(a, { t: "cfg", n: 2, diff: "hard" });
  say(a, { t: "cfg", n: 3, diff: "easy" });
  expect(room.match.cfg.bots).toEqual(["normal", "normal", "hard", "easy"]);
  expect(b.last("room")!.bd).toEqual(["normal", "normal", "hard", "easy"]);
  say(a, { t: "cfg", diff: "easy" });                    // "all bots" sets every seat
  expect(b.last("room")!.bd).toEqual(["easy", "easy", "easy", "easy"]);
});

test("flood: a socket over its message budget is closed and its seat freed; a busy player is not", () => {
  const { room, join, say, clock, errors } = setup();
  const a = join("a"), b = join("b");
  for (let i = 0; i < 30 * 10; i++) { say(a, { t: "in", m: i % 200 - 100, g: i % 7 === 0 ? 1 : 0, h: 0 }); if (i % 15 === 0) say(a, { t: "ping", n: i }); clock.advance(1000 / 30); }
  expect(a.closed).toBeNull();                           // 30 moves a second for ten seconds, plus pings
  for (let i = 0; i < MSG_BURST + 5; i++) say(b, { t: "ping", n: i });
  expect(b.closed?.code).toBe(CLOSE_FLOOD);
  expect(b.last("err")!.msg).toMatch(/Too many/);
  expect(room.match.seatOf("b")).toBe(-1);
  const pongs = b.of("pong").length;
  say(b, { t: "ping", n: 1 });
  expect(b.of("pong").length).toBe(pongs);               // nothing more counts
  expect(errors.length).toBe(1);                         // reported once
});

test("watchdog: a dead tick loop is revived by the storage alarm while players are seated", () => {
  const { room, join, ctx, clock, errors } = setup();
  const a = join("a");
  expect(ctx.alarmAt).toBe(clock.now() + WATCHDOG_MS);
  clock.advance(500);
  clock.dropAll();                                       // the timer is lost: the loop is dead
  const n = a.of("snap").length;
  clock.advance(5000);
  expect(a.of("snap").length).toBe(n);
  room.alarm();
  expect(errors.length).toBe(1);
  expect(ctx.alarmAt).toBe(clock.now() + WATCHDOG_MS);   // and the next check is set
  clock.advance(2000);
  expect(a.of("snap").length).toBeGreaterThan(n);
  room.alarm();                                          // a healthy loop is left alone
  expect(errors.length).toBe(1);
  ctx.sockets = []; room.webSocketClose(a);
  ctx.alarmAt = null;
  room.alarm();
  expect(ctx.alarmAt).toBeNull();                        // nobody seated: the alarms lapse
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
  expect(room.match.cfg).toEqual({ secs: 90, difficulty: "hard", bots: ["hard", "hard", "hard", "hard"] });
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

test("eviction: couch pairs and rejoins go back to the seats they held, whatever order the sockets wake in", async () => {
  const { ctx, room, join, say, clock } = setup();
  const pair = new FakeSocket(); ctx.sockets.push(pair);
  room.onConnect(pair, "a", "Ada");
  say(pair, { t: "hello", v: PROTO_VERSION, k: 2 });
  join("b", "Bo"); join("c"); join("d");
  expect(join("e").last("hello")!.you).toBe(-1);
  say(pair, { t: "start" });
  clock.advance(1000 * 5);
  await Promise.resolve();
  ctx.sockets.reverse();
  const again = new Room(ctx, { clock: new ManualClock(), seed: 1 });
  await again.restore();
  expect(["a", "a+2", "b", "c", "d", "e"].map((u) => again.match.seatOf(u))).toEqual([0, 1, 2, 3, -1, -1]);
});

test("scores persist at the podium; a round cut short by an eviction replays from its countdown", async () => {
  const { ctx, room, join, say, clock } = setup();
  const a = join("a");
  say(a, { t: "cfg", secs: 30 }); say(a, { t: "start" });
  clock.advance(1000 * 40);
  expect(room.match.phase).toBe("podium");
  await Promise.resolve();
  const scores = room.match.sim.hippos.map((h) => h.score);
  expect(scores.some((x) => x !== 0)).toBe(true);
  const again = new Room(ctx, { clock: new ManualClock() });
  await again.restore();
  expect(again.match.phase).toBe("podium");
  expect(again.match.sim.hippos.map((h) => h.score)).toEqual(scores);
});
